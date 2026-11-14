"""Untergrund's self-hosted neural singer: sings an `untergrund-sing/1` request (js/sing-score.js) with Scylla's Band v4.

One entry point for every host (docs/singer.md):
  python singer/singer.py render request.json -o vocal.wav    # local CPU (LiteRT), one file
  python singer/singer.py serve --port 8765                   # local CPU HTTP server, the API Modal serves
  modal deploy singer/modal_app.py                            # the same `Singer.render` on an L4 GPU (ONNX Runtime CUDA)

Only Scylla's Band's fourteen built-in voices can be asked for: there is no reference-voice input. The model is pinned to
an exact Hugging Face revision and verified against its SHA256SUMS.json before first use; it never ships with the web app.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import numpy as np

# Pins (docs/singer.md#licenses): weights spybyscript/scyllasband tag v4-20261106, runtime lowkeytea/scyllasband
# commit "Release v4-20261106". Both Apache-2.0.
MODEL_REPO = "spybyscript/scyllasband"
MODEL_REVISION = "de0d1d9dd9ddb23ba8c7cd8b3ec6ea842f250868"
RUNTIME_REPO = "https://github.com/lowkeytea/scyllasband"
RUNTIME_COMMIT = "57271a01f793ec0ed0baa1fd47eb2383518b9e79"

FORMAT = "untergrund-sing/1"
VOICES = ("ariadne", "felix", "gwen", "ink", "kincade", "max", "orpheus", "poppy", "priya", "rex", "scylla", "stone", "thistle", "tuesday")
AUDIO = {"opus": ("OGG", "OPUS", "audio/ogg"), "mp3": ("MP3", "MPEG_LAYER_III", "audio/mpeg"), "wav": ("WAV", "PCM_16", "audio/wav")}
# The same limits as SING_LIMITS in js/sing-score.js.
LIMITS = {"notes": 1500, "beats": 1600, "seconds": 420, "text": 4000, "bpm": (40, 240), "midi": (36, 91), "seed": 2**31 - 1, "body": 256 * 1024}
NOTE = re.compile(r"^([A-G])(#?)(-?[0-9])$")
LABEL = re.compile(r"^[a-z0-9']{1,40}(~[1-9][0-9]?)?$")
NAMES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SAMPLE_RATE = 24000
# The stem's loudness on delivery: sung notes at -20 dBFS RMS, peaks under -1 dBFS. The app sets the level in the mix.
TARGET_RMS_DB, PEAK_DB = -20.0, -1.0


class BadRequest(ValueError):
    pass


def validate(raw: Any) -> dict:
    """A clean copy of a sing request, or BadRequest. Mirrors validateSing() in js/sing-score.js."""
    if not isinstance(raw, dict) or raw.get("format") != FORMAT:
        raise BadRequest("not an untergrund-sing/1 request")
    score = raw.get("score")
    if not isinstance(score, dict) or not isinstance(score.get("notes"), list):
        raise BadRequest("score needs notes")
    bpm = score.get("bpm")
    if not isinstance(bpm, (int, float)) or not LIMITS["bpm"][0] <= bpm <= LIMITS["bpm"][1]:
        raise BadRequest("bpm out of range")
    if score.get("style") not in ("pop", "ballad"):
        raise BadRequest("style must be pop or ballad")
    notes, text = score["notes"], score.get("text")
    if not notes or len(notes) > LIMITS["notes"]:
        raise BadRequest("too many notes")
    if not isinstance(text, str) or len(text) > LIMITS["text"]:
        raise BadRequest("text too long")
    beats, words, out = 0.0, [], []
    for row in notes:
        if not isinstance(row, list) or len(row) != 3:
            raise BadRequest("a note is [label, note, beats]")
        label, name, b = row
        if not isinstance(label, str) or not isinstance(name, str) or isinstance(b, bool) or not isinstance(b, (int, float)) or not 0 < b <= 64:
            raise BadRequest("bad note")
        beats += b
        if label == "-":
            if name != "rest":
                raise BadRequest("a rest is ['-', 'rest', beats]")
        else:
            m = NOTE.match(name)
            if not LABEL.match(label) or not m:
                raise BadRequest("bad label or pitch")
            midi = NAMES[m.group(1)] + (1 if m.group(2) else 0) + 12 * (int(m.group(3)) + 1)
            if not LIMITS["midi"][0] <= midi <= LIMITS["midi"][1]:
                raise BadRequest("pitch out of range")
            base, _, part = label.partition("~")
            if not part or part == "1":
                words.append(base)
        out.append([label, name, float(b)])
    if beats > LIMITS["beats"] or beats * 60.0 / bpm > LIMITS["seconds"]:
        raise BadRequest("score too long")
    if " ".join(words) != text:
        raise BadRequest("text must be the words of the notes")
    voice, seed = raw.get("voice"), raw.get("seed")
    if voice not in VOICES:
        raise BadRequest("voice must be one of Scylla's Band's built-in voices")
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= LIMITS["seed"]:
        raise BadRequest("bad seed")
    audio = raw.get("audio") if raw.get("audio") in AUDIO else "opus"
    return {"format": FORMAT, "voice": voice, "seed": seed, "audio": audio, "score": {"text": text, "bpm": float(bpm), "style": score["style"], "notes": out}}


def request_hash(req: dict) -> str:
    """Content hash of a (validated) request plus the model pin, reported in X-Sing-Meta (api/_lib/sing.js keys its cache with its own)."""
    body = json.dumps({"pin": MODEL_REVISION, **req}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def fetch_model(models_dir: Path, bundle: str) -> Path:
    """Download one bundle at the pinned revision (once) and verify every file against SHA256SUMS.json."""
    target = models_dir / bundle
    stamp = models_dir / f".verified-{bundle}-{MODEL_REVISION[:12]}"
    if stamp.exists():
        return target
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id=MODEL_REPO, revision=MODEL_REVISION, local_dir=str(models_dir),
                      allow_patterns=[f"{bundle}/**", "LICENSE", "THIRD_PARTY_NOTICES.md", "SHA256SUMS.json"])
    sums = json.loads((models_dir / "SHA256SUMS.json").read_text())
    checked = 0
    for name, info in sums.items():
        if not name.startswith(bundle + "/"):
            continue
        h = hashlib.sha256()
        with open(models_dir / name, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        if h.hexdigest() != info["sha256"]:
            raise RuntimeError(f"checksum mismatch: {name}")
        checked += 1
    if not checked:
        raise RuntimeError(f"no {bundle} files in SHA256SUMS.json")
    stamp.write_text(str(checked))
    return target


def master(audio: np.ndarray, seconds: float) -> np.ndarray:
    """The stem on the song's timeline (sample 0 = the first downbeat), sung notes at TARGET_RMS_DB, peaks under PEAK_DB."""
    n = int(round((seconds + 1.0) * SAMPLE_RATE))
    out = np.zeros(n, np.float32)
    out[: min(n, audio.size)] = audio[:n]
    w = SAMPLE_RATE // 20
    frames = out[: out.size // w * w].reshape(-1, w)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1) + 1e-20)
    voiced = rms[rms > 10 ** (-50 / 20)]
    if voiced.size:
        gain = 10 ** (TARGET_RMS_DB / 20) / float(np.sqrt(np.mean(voiced**2)))
        peak = float(np.max(np.abs(out))) or 1.0
        out *= min(gain, 10 ** (PEAK_DB / 20) / peak)
    return out


def encode(audio: np.ndarray, kind: str) -> bytes:
    import soundfile as sf
    fmt, sub, _ = AUDIO[kind]
    buf = io.BytesIO()
    # Opus and MP3 at 48 kHz play everywhere the app runs; the WAV stays at the model's 24 kHz.
    sr = SAMPLE_RATE
    if kind != "wav":
        audio, sr = resample2x(audio), SAMPLE_RATE * 2
    sf.write(buf, audio, sr, format=fmt, subtype=sub)
    return buf.getvalue()


def resample2x(x: np.ndarray) -> np.ndarray:
    """24 -> 48 kHz: zero-stuff and a windowed-sinc low-pass at 11 kHz."""
    up = np.zeros(x.size * 2, np.float32)
    up[::2] = x * 2
    t = np.arange(-32, 33)
    h = np.sinc(t * 11000 / 24000) * (11000 / 24000) * np.kaiser(t.size, 8.0)
    return np.convolve(up, h.astype(np.float32), mode="same").astype(np.float32)


class ScyllasBand:
    """Scylla's Band v4, loaded once. backend 'litert' runs on the CPU; 'onnx-gpu' runs the webgpu bundle on CUDA."""

    def __init__(self, models_dir: Path, backend: str, threads: int | None):
        self.models_dir, self.backend, self.threads, self.rt = models_dir, backend, threads, None

    def load(self):
        if self.rt is None:
            from scyllasband.runtime import ScyllasBandRuntime
            if self.backend == "onnx-gpu":
                bundle = fetch_model(self.models_dir, "webgpu")
                self.rt = ScyllasBandRuntime.from_bundle(bundle, backend="onnx", compute_units="gpu", threads=self.threads)
            elif self.backend in ("litert", "onnx"):
                bundle = fetch_model(self.models_dir, self.backend)
                self.rt = ScyllasBandRuntime.from_bundle(bundle, backend=self.backend, threads=self.threads)
            else:
                raise ValueError(f"unknown SINGER_BACKEND {self.backend!r}")
        return self

    def sing(self, score: dict, voice: str, seed: int) -> np.ndarray:
        return np.asarray(self.load().rt.sing(score, voice, seed=seed).audio, np.float32).reshape(-1)


class SoulXSinger:
    """Reserved slot: SoulX-Singer (Apache-2.0, zero-shot) once the owner provides a voice clip he has the rights to."""

    def __init__(self, *_args, **_kw):
        raise NotImplementedError("SoulX-Singer is not implemented; only Scylla's Band's built-in voices are approved")


# Singing engines behind one interface: Engine(models_dir, backend, threads).load(); .sing(score, voice, seed) -> mono
# float32 at SAMPLE_RATE, sample 0 on the score's first beat.
BACKENDS = {"scyllasband": ScyllasBand, "soulx-singer": SoulXSinger}


class Singer:
    """The one entry point every host calls: validate, sing with the configured engine, master, encode."""

    def __init__(self, models_dir: str | Path | None = None, backend: str | None = None, threads: int | None = None, engine: str | None = None):
        models = Path(models_dir or os.environ.get("SINGER_MODELS") or Path.home() / ".cache" / "untergrund-singer")
        self.backend = backend or os.environ.get("SINGER_BACKEND", "litert")
        self.engine = BACKENDS[engine or os.environ.get("SINGER_ENGINE", "scyllasband")](models, self.backend, threads)
        self.lock = threading.Lock()

    def load(self):
        self.engine.load()
        return self

    def render(self, raw: dict) -> tuple[bytes, str, dict]:
        req = validate(raw)
        with self.lock:
            t0 = time.time()
            sung = self.engine.sing(req["score"], req["voice"], req["seed"])
        score = req["score"]
        seconds = sum(r[2] for r in score["notes"]) * 60.0 / score["bpm"]
        audio = master(sung, seconds)
        meta = {"hash": request_hash(req), "voice": req["voice"], "seed": req["seed"], "seconds": round(audio.size / SAMPLE_RATE, 3),
                "render_s": round(time.time() - t0, 2), "backend": self.backend, "model": f"{MODEL_REPO}@{MODEL_REVISION}"}
        return encode(audio, req["audio"]), AUDIO[req["audio"]][2], meta


# --- HTTP: the API that api/_lib/sing.js calls, served locally here and on Modal by modal_app.py -------------------
def authorized(header: str | None, secret: str) -> bool:
    import hmac
    return bool(secret) and hmac.compare_digest(str(header or ""), f"Bearer {secret}")


def serve(port: int, singer: Singer, secret: str):
    pool, jobs = ThreadPoolExecutor(max_workers=1), {}

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status: int, body: bytes = b"", kind: str = "application/json", headers: dict | None = None):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def json(self, status: int, obj: dict):
            self.reply(status, json.dumps(obj).encode())

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == "/health":
                return self.json(200, {"ok": True, "model": f"{MODEL_REPO}@{MODEL_REVISION}"})
            if not authorized(self.headers.get("Authorization"), secret):
                return self.json(401, {"error": "unauthorized"})
            if url.path != "/result":
                return self.json(404, {"error": "not_found"})
            job = jobs.get((parse_qs(url.query).get("id") or [""])[0])
            if not job:
                return self.json(404, {"error": "unknown_job"})
            if not job.done():
                return self.json(202, {"status": "pending"})
            jobs.pop((parse_qs(url.query).get("id") or [""])[0], None)
            try:
                audio, kind, meta = job.result()
            except BadRequest as err:
                return self.json(400, {"error": "bad_request", "detail": str(err)})
            except Exception as err:  # noqa: BLE001 - reported to the caller, logged here
                print("sing failed:", err, file=sys.stderr)
                return self.json(500, {"error": "sing_failed"})
            self.reply(200, audio, kind, {"X-Sing-Meta": json.dumps(meta)})

        def do_POST(self):
            if not authorized(self.headers.get("Authorization"), secret):
                return self.json(401, {"error": "unauthorized"})
            size = int(self.headers.get("Content-Length") or 0)
            if size > LIMITS["body"]:
                return self.json(413, {"error": "too_large"})
            try:
                req = validate(json.loads(self.rfile.read(size) or b"{}"))
            except (BadRequest, ValueError) as err:
                return self.json(400, {"error": "bad_request", "detail": str(err)})
            if self.path == "/submit":
                if sum(not j.done() for j in jobs.values()) >= 4:
                    return self.json(429, {"error": "busy"})
                for old in [k for k, j in jobs.items() if j.done()][:-8]:
                    jobs.pop(old, None)
                jid = uuid.uuid4().hex
                jobs[jid] = pool.submit(singer.render, req)
                return self.json(202, {"id": jid})
            if self.path == "/sing":
                audio, kind, meta = singer.render(req)
                return self.reply(200, audio, kind, {"X-Sing-Meta": json.dumps(meta)})
            self.json(404, {"error": "not_found"})

        def log_message(self, fmt, *args):
            print("singer:", fmt % args, file=sys.stderr)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"singer listening on http://127.0.0.1:{port} ({singer.backend})", file=sys.stderr)
    server.serve_forever()


def main(argv: list[str] | None = None):
    ap = argparse.ArgumentParser(prog="singer", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("render", help="sing one request JSON to a file")
    r.add_argument("request")
    r.add_argument("-o", "--output", required=True)
    s = sub.add_parser("serve", help="the singer API on localhost (CPU)")
    s.add_argument("--port", type=int, default=8765)
    for p in (r, s):
        p.add_argument("--models", default=None, help="model cache directory (SINGER_MODELS)")
        p.add_argument("--backend", default=None, choices=["litert", "onnx", "onnx-gpu"])
        p.add_argument("--threads", type=int, default=None)
    a = ap.parse_args(argv)
    singer = Singer(a.models, a.backend, a.threads)
    if a.cmd == "render":
        raw = json.loads(Path(a.request).read_text())
        ext = Path(a.output).suffix.lstrip(".").lower()
        if ext in AUDIO:
            raw["audio"] = ext
        audio, _, meta = singer.render(raw)
        Path(a.output).write_bytes(audio)
        print(json.dumps(meta))
    else:
        secret = os.environ.get("SINGER_SECRET", "")
        if not secret:
            sys.exit("set SINGER_SECRET (the shared secret api/sing sends)")
        singer.load()
        serve(a.port, singer, secret)


if __name__ == "__main__":
    main()
