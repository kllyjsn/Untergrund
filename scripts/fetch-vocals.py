#!/usr/bin/env python3
"""Build the CC0 S8 vowels. Requires numpy, scipy and ffmpeg.

python3 scripts/fetch-vocals.py --from ~/s8src --report ~/s8-vocals-report.json
Without --from, fetch lossless originals using FREESOUND_TOKEN (OAuth Bearer).
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request

import numpy as np
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parents[1]
SR = 44100


def decode(data):
    pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', str(SR), '-f', 'f32le', 'pipe:1'], input=data)
    return np.frombuffer(pcm, dtype='<f4').astype(float)


def pitch(x, midi):
    y = x * np.hanning(len(x))
    spectrum = abs(np.fft.rfft(y, 1 << 20))
    frequencies = np.fft.rfftfreq(1 << 20, 1 / SR)
    center = 440 * 2 ** ((midi - 69) / 12)
    values, weights, levels = [], [], []
    for harmonic in [1, 2, 3, 4]:
        target = center * harmonic
        lo, hi = np.searchsorted(frequencies, [target * 2 ** (-100 / 1200), target * 2 ** (100 / 1200)])
        i = lo + np.argmax(spectrum[lo:hi])
        assert lo < i < hi - 1, 'pitch outside concert-F search'
        a, b, c = np.log(spectrum[i - 1:i + 2] + 1e-15)
        delta = .5 * (a - c) / (a - 2 * b + c)
        values.append(1200 * np.log2((i + delta) * SR / (1 << 20) / target))
        weights.append(spectrum[i] / harmonic)
        levels.append(float(spectrum[i]))
    cents = float(np.average(values, weights=weights))
    sub = (frequencies > center / 2 * .97) & (frequencies < center / 2 * 1.03)
    return dict(f0=center * 2 ** (cents / 1200), cents=cents,
                partial_cents=values, partial_levels=levels,
                fundamental_over_suboctave_db=float(20 * np.log10(levels[0] / max(1e-15, spectrum[sub].max()))))


def stability(x, midi):
    n = round(.3 * SR)
    values = [pitch(x[i:i + n], midi)['cents'] for i in range(0, len(x) - n + 1, round(.025 * SR))]
    return dict(min_cents=min(values), max_cents=max(values), range_cents=max(values) - min(values))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--from', dest='source_dir', type=Path)
    ap.add_argument('--report', required=True, type=Path)
    ap.add_argument('--output-dir', type=Path, default=ROOT / 'samples/live')
    args = ap.parse_args()
    manifest = json.loads((ROOT / 'scripts/vocal-samples.json').read_text())
    token = os.environ.get('FREESOUND_TOKEN')
    if not args.source_dir and not token:
        ap.error('use --from DIR or set FREESOUND_TOKEN to an OAuth access token')
    rows, outputs = [], []
    for entry in manifest:
        if args.source_dir:
            path = args.source_dir / entry['local_filename']
            if not path.exists():
                path = args.source_dir / entry['original_filename']
            data = path.read_bytes()
        else:
            request = urllib.request.Request(entry['download_url'], headers={'Authorization': 'Bearer ' + token})
            with urllib.request.urlopen(request, timeout=90) as response:
                data = response.read()
        original_hash = hashlib.sha256(data).hexdigest()
        if original_hash != entry['source_sha256']:
            raise ValueError(f"original sha256 mismatch for Freesound {entry['id']}")
        x = decode(data)
        start, end = entry['sustain_window_seconds']
        x = x[round(start * SR):round(end * SR)]
        midi = entry['midi']
        before = pitch(x, midi)
        assert abs(before['cents']) < 50, 'manifest MIDI must be nearest semitone'
        assert before['fundamental_over_suboctave_db'] > 6, 'possible octave error'
        assert before['partial_levels'][2] > before['partial_levels'][0] * .05, 'missing odd harmonic: check octave'
        factor = 2 ** (-before['cents'] / 1200)
        x = resample_poly(x, round(SR / factor), SR)
        fade_in = round(entry['processing']['fade_in_seconds'] * SR)
        fade_out = round(entry['processing']['fade_out_seconds'] * SR)
        x[:fade_in] *= np.linspace(0, 1, fade_in)
        x[-fade_out:] *= np.linspace(1, 0, fade_out)
        x *= 10 ** (entry['processing']['peak_dbfs'] / 20) / max(1e-15, abs(x).max())
        encoded = subprocess.check_output(['ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', 'pipe:0', '-c:a', 'flac', '-sample_fmt', 's16', '-compression_level', '8', '-f', 'flac', 'pipe:1'], input=x.astype('<f4').tobytes())
        decoded = decode(encoded)
        after = pitch(decoded, midi)
        steady = stability(decoded, midi)
        assert abs(after['cents']) < 5, (entry['vowel'], after)
        assert max(abs(steady['min_cents']), abs(steady['max_cents'])) < 5, (entry['vowel'], steady)
        filename = f"vox_{entry['vowel']}_{midi}.flac"
        rows.append(dict(file=filename, source=entry['source_url'], source_sha256=original_hash,
                         midi=midi, before=before, after=after, stability=steady,
                         sha256=hashlib.sha256(encoded).hexdigest(), bytes=len(encoded), seconds=len(decoded) / SR))
        outputs.append((filename, encoded))
        print(f"{filename}: {before['f0']:.4f} Hz {before['cents']:+.3f} c -> {after['f0']:.4f} Hz {after['cents']:+.3f} c; frames {steady['min_cents']:+.2f}..{steady['max_cents']:+.2f} c", flush=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for filename, encoded in outputs:
        (args.output_dir / filename).write_bytes(encoded)
    args.report.write_text(json.dumps(rows, indent=2) + '\n')
    print('VOCALS ASSETS VERIFIED', len(rows), sum(r['bytes'] for r in rows), 'bytes')


if __name__ == '__main__':
    main()
