#!/usr/bin/env python3
"""Prepare tim.kahn's CC BY 4.0 Mark II originals (no network download).

Usage: python3 scripts/fetch-rhodes.py --originals ~/mk2
Requires ffmpeg and numpy. Source names, credits and SHA256s are pinned in
samples/rhodes-sources.json; all inputs are verified before any output is written.
Writes mono 44.1 kHz / 16-bit FLAC and samples/rhodes-analysis.json.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SR = 44100
PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
SELECTED = {28: 61828, 31: 61832, 34: 61821, 37: 61824, 40: 65758,
            43: 65762, 46: 65754, 49: 65717, 52: 65725, 55: 65730,
            58: 65714, 61: 65718, 64: 65726, 86: 65657, 89: 65662,
            93: 65651, 96: 65654, 100: 65660}


def decode(path):
    return np.frombuffer(subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(SR),
        '-f', 'f32le', 'pipe:1']), dtype='<f4').copy()


def trim(x):
    if not len(x):
        raise ValueError('empty recording')
    peak = np.max(np.abs(x))
    if peak < 1e-7:
        raise ValueError('silent recording')
    start = int(np.flatnonzero(np.abs(x) > peak * 0.003)[0])
    return x[max(0, start - 32):]


def db(x):
    return float(20 * np.log10(max(float(x), 1e-12)))


def measure(x, midi):
    # Match sampletune.py's settled window and partial weighting.
    seg = x[int(.15 * SR):int(.70 * SR)]
    if len(seg) < SR // 4:
        raise ValueError('recording too short for pitch measurement')
    n = 1 << 20
    spectrum = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n))
    f = np.fft.rfftfreq(n, 1 / SR)
    offsets, weights = [], []
    for h in ((2, 3, 4, 5, 6) if midi < 48 else (1, 2, 3, 4)):
        target = 440 * 2 ** ((midi - 69) / 12) * h
        lo, hi = np.searchsorted(f, [target * 2 ** (-60 / 1200), target * 2 ** (60 / 1200)])
        if hi >= len(f):
            continue
        k = lo + int(np.argmax(spectrum[lo:hi]))
        # Weak high partials of the upper register are mostly noise.
        if spectrum[k] < spectrum.max() * .01:
            continue
        offsets.append(1200 * np.log2(f[k] / target))
        weights.append(spectrum[k] / h)
    if not weights:
        raise ValueError('no measurable harmonic pitch')
    return float(np.average(offsets, weights=weights))


def process(x):
    if len(x) < SR // 20 or np.max(np.abs(x)) < 1e-7:
        raise ValueError('empty, silent or too-short recording')
    w = int(.05 * SR)
    n = len(x) // w
    envelope = 10 * np.log10(np.mean(x[:n * w].reshape(n, w) ** 2, axis=1) + 1e-20)
    top = int(np.argmax(envelope))
    end = next((i for i in range(top, n) if envelope[i] < envelope.max() - 48), n)
    y = x[:min(len(x), (end + 1) * w, 9 * SR)].copy()
    fade = min(int(.6 * SR), len(y) // 3)
    y[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
    # Sub-millisecond ramp prevents clicks in already-trimmed originals.
    ramp = min(22, len(y))
    y[:ramp] *= np.linspace(0, 1, ramp)
    return y * (.5 / np.max(np.abs(y)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--originals', type=Path, required=True)
    args = parser.parse_args()
    metadata = json.loads((ROOT / 'samples/rhodes-sources.json').read_text())
    for sound in metadata['sounds']:
        path = args.originals / f"{sound['id']}.aif"
        if hashlib.sha256(path.read_bytes()).hexdigest() != sound['sha256']:
            raise ValueError(f'SHA256 mismatch: {path}')
    print(f"SHA256: {len(metadata['sounds'])}/{len(metadata['sounds'])} originals verified")
    rows = []
    for sound in metadata['sounds']:
        x = trim(decode(args.originals / f"{sound['id']}.aif"))
        name = re.search(r'([A-G])(#?)(\d)', sound['name'])
        midi = 12 * (int(name[3]) + 2) + PC[name[1]] + bool(name[2])
        cents = measure(x, midi)
        attack = x[:int(.1 * SR)]
        power = np.abs(np.fft.rfft(attack * np.hanning(len(attack)))) ** 2
        freq = np.fft.rfftfreq(len(attack), 1 / SR)
        row = {'id': sound['id'], 'name': sound['name'], 'midi': midi,
               'measured_midi': round(midi + cents / 100, 5), 'cents': round(cents, 2),
               'attack_peak_dbfs': round(db(np.max(np.abs(attack))), 2),
               'attack_rms_dbfs': round(db(np.sqrt(np.mean(attack ** 2))), 2),
               'attack_centroid_hz': round(float(np.sum(freq * power) / np.sum(power)), 1),
               'selected': SELECTED.get(midi) == sound['id']}
        if row['selected']:
            y = process(x)
            target = ROOT / 'samples/live' / f'rhodes_{midi}.flac'
            pcm = (np.clip(y, -1, 1) * 32767).astype('<i2').tobytes()
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR),
                            '-ac', '1', '-i', 'pipe:0', '-map_metadata', '-1', '-c:a', 'flac',
                            '-compression_level', '12', str(target)], input=pcm, check=True)
            row['output'] = target.name
            row['seconds'] = round(len(y) / SR, 4)
            row['bytes'] = target.stat().st_size
        rows.append(row)
    report = {'method': 'Settled 0.15–0.70 s, Hann FFT, weighted harmonic offsets; '
              'attack statistics over first 100 ms after trim; power spectral centroid.',
              'processing': 'Mono sum, 44100 Hz PCM16, 32-frame preroll at 0.003 peak, '
              '0.5 ms fade in, -48 dB decay stop, maximum 9 s, final 0.6 s cosine-squared '
              'fade, peak 0.5 (-6.02 dBFS), no retuning or denoising.',
              'tune': {str(r['midi']): r['cents'] for r in rows if r['selected']},
              'total_bytes': sum(r.get('bytes', 0) for r in rows), 'sounds': rows}
    (ROOT / 'samples/rhodes-analysis.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Selected MIDI:', ' '.join(map(str, SELECTED)))
    print('Tune (cents):', json.dumps(report['tune'], sort_keys=True))
    print(f"Wrote {len(SELECTED)} FLACs, {report['total_bytes']} bytes")


if __name__ == '__main__':
    main()
