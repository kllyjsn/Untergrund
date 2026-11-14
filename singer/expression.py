"""Score-level expression for Scylla's Band v4: the same phrase plan the runtime's own ``sing()`` builds, with the melody
input bent and the phone timing moved before each phrase is rendered, then breaths, stress and per-phrase timing.

Everything here goes in through inputs the v4 singing contract already takes: the per-frame melody (``note_phase_presence``:
pitch, phase in the note, presence) and the per-phone frame durations. Nothing is fed to the model that it was not trained on.
One request is deterministic: the model noise is drawn from ``seed + phrase`` exactly as ``scyllasband.singing.sing`` does,
the breath noise from ``seed + BREATH_SEED + phrase``.

Knobs (``expr`` in an untergrund-sing/1 request; js/sing.js sends one set per genre, documented in docs/singer.md):
    scoop      semitones a phrase's first note, or a note leapt up to, is approached from below (0 = off)
    scoop_ms   how long that approach takes
    glide_ms   portamento into a note from the one before it inside a phrase (0 = steps)
    vib_cents  vibrato depth (+/-) on held notes; it starts after vib_delay and grows to full depth over vib_ramp
    vib_rate   vibrato rate, Hz
    vib_delay  seconds into a note before vibrato starts; notes shorter than vib_delay + vib_ramp / 2 get none
    vib_ramp   seconds the vibrato takes to grow to full depth (about 0.4 s)
    breath     level of a short breath before a phrase that follows a rest of at least BREATH_REST, dB under the phrase
               (0 = off; e.g. 24 means 24 dB under the sung level)
    lead       share (0..1) of a word's leading consonants moved before its note, so the vowel starts on the beat
    stress_db  boost on stressed syllables (on beats 1 and 3, or a beat or longer)
    stress_vowel  share of a stressed word's consonant frames handed to its vowel (longer vowels)
    guidance   the runtime's melody/mode guidance (1 = the bundle's default; above 1 contrasts against melody and mode off)
    align      put each phrase's first vowel onset on its note (within ALIGN_MAX), measured on the rendered audio
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np

KNOBS = {  # name: (default = off / runtime behaviour, lowest, highest)
    "scoop": (0.0, 0.0, 3.0), "scoop_ms": (80.0, 20.0, 250.0), "glide_ms": (0.0, 0.0, 150.0),
    "vib_cents": (0.0, 0.0, 80.0), "vib_rate": (5.5, 3.5, 8.0), "vib_delay": (0.25, 0.0, 1.0), "vib_ramp": (0.4, 0.05, 1.5),
    "breath": (0.0, 0.0, 40.0), "lead": (0.0, 0.0, 1.0), "stress_db": (0.0, 0.0, 4.0), "stress_vowel": (0.0, 0.0, 0.6),
    "guidance": (1.0, 1.0, 2.0), "align": (0, 0, 1),
}
BREATH_REST = 0.5     # seconds of rest before a phrase that leave room for a breath
BREATH_SEED = 7919
ALIGN_MAX = 0.08      # seconds a phrase may be moved to put its first vowel on the beat
LEAP = 3              # semitones up that count as a leap (scooped)


def clean_expr(raw: Any) -> dict:
    """Known knobs only, each a finite number clamped to its range; anything else is dropped. ``{}`` -> runtime defaults."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for k, (_, lo, hi) in KNOBS.items():
        v = raw.get(k)
        if k == "align" and isinstance(v, bool):
            v = int(v)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            continue
        out[k] = int(bool(v)) if k == "align" else round(min(hi, max(lo, float(v))), 4)
    return out


def knobs(expr: dict) -> dict:
    return {k: expr.get(k, d) for k, (d, _, _) in KNOBS.items()}


def is_off(expr: dict) -> bool:
    k = knobs(expr)
    return all(k[n] == KNOBS[n][0] for n in ("scoop", "glide_ms", "vib_cents", "breath", "lead", "stress_db", "stress_vowel", "guidance", "align"))


# --- the melody input --------------------------------------------------------------------------------------------------
def bend(melody: np.ndarray, notes, k: dict, *, hop: int, sr: int, scale: float) -> np.ndarray:
    """Add scoops, glides and vibrato (in semitones) to a phrase's melody input, only where a note sounds."""
    out = melody.copy()
    centres = (np.arange(len(out), dtype=np.float64) * hop + hop // 2) / sr
    delta = np.zeros(len(out))
    prev = None
    for n in notes:
        if n.midi is None or n.end <= n.start:
            prev = None
            continue
        inside = (centres >= n.start) & (centres < n.end)
        t = centres[inside] - n.start
        d = np.zeros(t.size)
        joined = prev is not None and abs(prev.end - n.start) < 1e-6
        if k["glide_ms"] > 0 and joined and prev.midi != n.midi and abs(n.midi - prev.midi) <= 7:
            g = k["glide_ms"] / 1000
            x = np.clip(t / g, 0, 1)
            d += (prev.midi - n.midi) * (1 - x * x * (3 - 2 * x))
        elif k["scoop"] > 0 and (not joined or n.midi - prev.midi >= LEAP):
            g = k["scoop_ms"] / 1000
            x = np.clip(t / g, 0, 1)
            d -= k["scoop"] * (1 - x) ** 2
        dur = n.end - n.start
        if k["vib_cents"] > 0 and dur >= k["vib_delay"] + k["vib_ramp"] / 2:
            u = t - k["vib_delay"]
            env = np.clip(u / k["vib_ramp"], 0, 1)
            env = env * env * (3 - 2 * env)
            tail = np.clip((n.end - n.start - t) / 0.06, 0, 1)
            d += k["vib_cents"] / 100 * env * tail * np.sin(2 * np.pi * k["vib_rate"] * np.maximum(u, 0))
        delta[inside] = d
        prev = n
    sounding = out[:, 2] > 0
    out[sounding, 0] += (delta[sounding] / scale).astype(np.float32)
    return out


# --- phone timing ------------------------------------------------------------------------------------------------------
def word_groups(phones, word_starts):
    from scyllasband.singing import SILENCE, is_vowel, is_non_acoustic_phone_modifier, is_punctuation_pause_phone
    first = next((i for i, p in enumerate(phones) if p != SILENCE), len(phones))
    starts = [first, *word_starts, len(phones)]
    groups = []
    for g0, g1 in zip(starts[:-1], starts[1:]):
        acoustic = [i for i in range(g0, g1) if phones[i] != SILENCE and not is_punctuation_pause_phone(phones[i])
                    and not is_non_acoustic_phone_modifier(phones[i])]
        vowels = [i for i in acoustic if is_vowel(phones[i])]
        lead = [i for i in acoustic if not vowels or i < vowels[0]]
        groups.append(dict(start=g0, end=g1, acoustic=acoustic, vowels=vowels, lead=lead if vowels else []))
    return groups


def retime(durations, phones, word_starts, stressed, k: dict) -> tuple[list[int], list[int]]:
    """Longer vowels on stressed words, then each word's leading consonants moved ``lead`` of the way before its note (taken
    from the phone before it, the rest or the previous word's tail). Returns the durations and the frames each word moved."""
    d = list(durations)
    groups = word_groups(phones, word_starts)
    moved = []
    for gi, g in enumerate(groups):
        if stressed[gi] and k["stress_vowel"] > 0 and g["vowels"]:
            cons = [i for i in g["acoustic"] if i not in g["vowels"]]
            for i in cons:
                take = int(d[i] * k["stress_vowel"])
                take = min(take, d[i] - 1)
                d[i] -= take
                d[g["vowels"][0]] += take
        shift = 0
        if k["lead"] > 0 and g["lead"]:
            want = int(round(sum(d[i] for i in g["lead"]) * k["lead"]))
            p = g["start"] - 1
            while p >= 0 and d[p] == 0:
                p -= 1
            if p >= 0:
                floor = 0 if phones[p] == "<sil>" else max(1, d[p] // 2)
                shift = max(0, min(want, d[p] - floor))
                d[p] -= shift
                d[g["vowels"][0]] += shift
        moved.append(shift)
    return d, moved


def lift_lead_ins(melody: np.ndarray, durations, word_starts, phones, moved) -> np.ndarray:
    """Frames a word's consonants moved into a rest carry the coming note's pitch (presence on, phase 0), so voiced
    consonants are sung, not dropped."""
    out = melody.copy()
    starts = np.cumsum([0, *durations])
    groups = word_groups(phones, word_starts)
    for g, m in zip(groups, moved):
        if not m or not g["vowels"]:
            continue
        v = int(starts[g["vowels"][0]])
        f0 = int(starts[g["lead"][0]]) if g["lead"] else v
        note = v
        while note < len(out) and out[note, 2] == 0:
            note += 1
        if note >= len(out):
            continue
        for f in range(f0, note):
            if out[f, 2] == 0:
                out[f] = (out[note, 0], 0.0, 1.0)
    return out


# --- audio -------------------------------------------------------------------------------------------------------------
def vowel_onset(audio: np.ndarray, sr: int, near: float, span: float = 0.15) -> float | None:
    """Seconds of the phrase's sung onset near ``near``: the first two voiced 10 ms frames within 15 dB of its loud
    voiced level (vocal_metrics' phrase-start measure, so what this aligns is what the report measures)."""
    from vocal_metrics import track
    f0, per, rms = track(np.asarray(audio, np.float64), sr)
    voiced = (per > 0.5) & (f0 > 0)
    if not voiced.any():
        return None
    db = 20 * np.log10(rms + 1e-9)
    ref = np.percentile(db[voiced], 90)
    for i in range(max(0, int((near - span) * 100)), min(f0.size - 1, int((near + span) * 100))):
        if voiced[i] and voiced[i + 1] and db[i] > ref - 15:
            return i * 0.01 + 0.02
    return None


def breath(rng: np.random.Generator, seconds: float, sr: int) -> np.ndarray:
    """A soft inhale: noise shaped to 0.5-6 kHz with a tilt toward 1-2 kHz, swelling in and cut short, peak 1."""
    n = max(1, int(seconds * sr))
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / sr)
    shape = np.exp(-((np.log(np.maximum(f, 1) / 1500)) ** 2) / 1.2) * (f > 400)
    x = np.fft.irfft(spec * shape, n)
    t = np.linspace(0, 1, n)
    env = np.sin(np.pi * np.minimum(1, t / 0.75) / 2) ** 2 * np.clip((1 - t) / 0.08, 0, 1)
    x = x * env
    return (x / (np.abs(x).max() + 1e-9)).astype(np.float32)


def stressed_words(phrase, bpm: float) -> list[bool]:
    """A word is stressed if its first note starts on beat 1 or 3 of a bar, or lasts a beat or more."""
    out = []
    beat = 60.0 / bpm
    for w in phrase.words:
        b = (phrase.start + w.start) / beat
        on = abs(b - 2 * round(b / 2)) < 0.06
        first = next((n for n in phrase.notes if n.midi is not None and n.start >= w.start - 1e-6), None)
        out.append(bool(on or (first is not None and first.end - first.start >= beat * 0.99)))
    return out


# --- the render --------------------------------------------------------------------------------------------------------
def sing(engine, score: dict, voice: str, seed: int, expr: dict, language: str = "en_us", report: dict | None = None) -> np.ndarray:
    """``scyllasband.singing.sing`` with expression: a mono float32 song, sample 0 on the score's first beat."""
    from scyllasband import singing as S
    k = knobs(expr)
    plan = S.plan_song(score, engine, voice, language)
    singing = engine.singing
    steps = int(singing.get("steps") or 8)
    sampler = str(singing.get("sampler") or "heun").lower()
    preferred = str(singing.get("decoder") or "vocos")
    decoder = preferred if engine.decoder_graphs.get(preferred) else "vocos"
    guidance = float(singing.get("guidance", 1.0)) * k["guidance"]
    sr = int(engine.manifest.get("audio", {}).get("sample_rate", S.SAMPLE_RATE))
    hop = int(engine.manifest.get("audio", {}).get("latent_hop_length", S.HOP))
    scale = float((singing.get("melody") or {}).get("midi_scale", S.MIDI_SCALE))
    delivery = (np.zeros((1, 5), np.float32), np.zeros((1, 5), bool))
    total = int(math.ceil(plan.seconds * sr))
    song = np.zeros(total + sr, np.float32)
    beat = 60.0 / plan.score.bpm
    gain = np.ones(song.size, np.float32)
    shifts, prev_end = [], 0.0
    for item in plan.phrases:
        ph = item.phrase
        stressed = stressed_words(ph, plan.score.bpm)
        durations, moved = retime(item.durations, item.sentence.phones, item.sentence.word_starts, stressed, k)
        melody = S.frame_melody(ph.notes, sum(durations), hop=hop, sample_rate=sr,
                                midi_center=float((singing.get("melody") or {}).get("midi_center", S.MIDI_CENTER)), midi_scale=scale)
        if any(moved):
            melody = lift_lead_ins(melody, durations, item.sentence.word_starts, item.sentence.phones, moved)
        melody = bend(melody, ph.notes, k, hop=hop, sr=sr, scale=scale)
        rng = np.random.default_rng(int(seed) + item.index)
        result = engine.synthesize_sentence(item.sentence, voice=voice, language=language, delivery=delivery, steps=steps, sampler=sampler,
                                            rng=rng, durations=durations, melody=melody, delivery_mode=plan.mode_id, guidance=guidance)
        first = ph.notes[0].start
        lead_s = (moved[0] if moved else 0) * hop / sr
        audio = S.gate_phrase(engine.decode(result.latents, voice=voice, language=language, decoder=decoder), sr,
                              first=first - lead_s, last=max(n.end for n in ph.notes if n.midi is not None))
        shift = 0.0
        if k["align"]:
            got = vowel_onset(audio, sr, first)
            if got is not None:
                shift = float(np.clip(first - got, -ALIGN_MAX, ALIGN_MAX))
        shifts.append(round(shift * 1000, 1))
        offset = int(round((ph.start + shift) * sr))
        if offset < 0:
            audio, offset = audio[-offset:], 0
        count = min(audio.size, song.size - offset)
        if k["breath"] > 0 and ph.start + first - prev_end >= BREATH_REST:
            level = np.sqrt(np.mean(audio[audio != 0] ** 2)) if np.any(audio) else 0.0
            dur = min(0.32, 0.45 * (ph.start + first - prev_end))
            end = ph.start + first - lead_s - 0.03
            b = breath(np.random.default_rng(int(seed) + BREATH_SEED + item.index), dur, sr) * level * 10 ** (-k["breath"] / 20) * 2.5
            b0 = int(round((end - dur) * sr))
            if b0 >= 0:
                song[b0:b0 + b.size] += b[: max(0, song.size - b0)]
        song[offset:offset + count] += audio[:count]
        prev_end = ph.start + max(n.end for n in ph.notes if n.midi is not None)
        if k["stress_db"] > 0:
            up = 10 ** (k["stress_db"] / 20) - 1
            ramp = int(0.03 * sr)
            for w, s in zip(ph.words, stressed):
                if not s:
                    continue
                a = max(0, int((ph.start + shift + w.start) * sr))
                z = int((ph.start + shift + min(w.end, w.start + 2 * beat)) * sr)
                if z - a <= 2 * ramp:
                    continue
                env = np.ones(z - a, np.float32)
                r = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, ramp, dtype=np.float32))
                env[:ramp], env[-ramp:] = r, r[::-1]
                gain[a:z] = np.maximum(gain[a:z], 1 + up * env[: max(0, min(z, gain.size) - a)])
    song *= gain
    if report is not None:
        report.update(phrase_shift_ms=shifts, guidance=guidance, phrases=len(plan.phrases), mode=plan.mode)
    return np.clip(song[:total], -1.0, 1.0)
