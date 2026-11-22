#!/usr/bin/env python3
"""Build the CC0 S9 fiddle/upright recordings. Requires numpy, scipy and ffmpeg.

python3 scripts/fetch-roots.py --source-dir /path/to/VSCO-2-CE --report /path/to/report.json
Missing originals are fetched from the pinned source. SFZ centers, not filenames, define pitch.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import urllib.parse
import urllib.request
import numpy as np
from scipy.signal import resample_poly

PIN = '440300901dfe9275fd84e0b7763af1f8443ae62e'
SFZ_PIN = '6dd651d55dde97fd4028699be9d4481f26917891'
BASE = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/'
NOTES = [55, 57, 60, 64, 67, 69, 72, 76, 79]
PIANO = list(range(41, 86, 4))
SR = 44100


def decode(path):
    return np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(SR), '-f', 'f32le', 'pipe:1']), dtype='<f4').astype(float)


def pitch(x, midi):
    a = min(int(.15 * SR), len(x) // 4)
    y = x[a:a + int(.55 * SR)]
    spec = abs(np.fft.rfft(y * np.hanning(len(y)), 1 << 20))
    fs = np.fft.rfftfreq(1 << 20, 1 / SR)
    values, weights = [], []
    for h in ([2, 3, 4, 5, 6] if midi < 48 else [1, 2, 3, 4]):
        target = 440 * 2 ** ((midi - 69) / 12) * h
        lo, hi = np.searchsorted(fs, [target * 2 ** (-70 / 1200), target * 2 ** (70 / 1200)])
        i = lo + np.argmax(spec[lo:hi])
        assert i not in [lo, hi - 1], f'pitch outside SFZ center search: {midi}'
        values.append(1200 * np.log2(fs[i] / target))
        weights.append(spec[i] / h)
    return float(np.average(values, weights=weights))


def regions(sfz):
    text = urllib.request.urlopen(BASE + SFZ_PIN + '/' + sfz, timeout=60).read().decode()
    return [dict(re.findall(r'(\w+)\s*=\s*([^\s<>]+)', block)) for block in text.split('<region>')[1:]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source-dir', required=True, type=pathlib.Path)
    ap.add_argument('--report', required=True, type=pathlib.Path)
    args = ap.parse_args()
    dest = pathlib.Path(__file__).resolve().parents[1] / 'samples/live'
    sources = {}
    for p in args.source_dir.rglob('*.wav'):
        sources[p.name] = p
    rows = []
    for sfz in ['SViolinVib.sfz', 'SViolinSpic.sfz', 'UprightPiano.sfz']:
        for r in regions(sfz):
            midi = int(r['pitch_keycenter'])
            if midi not in (PIANO if sfz == 'UprightPiano.sfz' else NOTES):
                continue
            name = pathlib.PureWindowsPath(r['sample']).name
            if sfz == 'SViolinVib.sfz':
                prefix = 'fiddlesoft' if int(r.get('hivel', 127)) < 63 else 'fiddle'
                folder, cap, fade = 'Strings/Solo Violin/Arco Vib', 3., .16
            elif sfz == 'SViolinSpic.sfz':
                rr = int(re.search(r'_rr(\d)', name)[1])
                prefix = 'fiddlestac' + ('soft' if int(r.get('hivel', 127)) < 63 else '') + ('b' if rr == 2 else '')
                folder, cap, fade = 'Strings/Solo Violin/spic', 1., .08
            else:
                layer = int(re.search(r'dyn(\d)', name)[1])
                prefix = {1: 'uprightsoft', 2: 'upright', 3: 'uprighthard'}[layer]
                folder, cap, fade = 'Keys/Upright Piano', 6., .5
            path = sources.get(name, args.source_dir / folder / name)
            relative = folder + '/' + name
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(urllib.request.urlopen(BASE + PIN + '/' + urllib.parse.quote(relative), timeout=90).read())
            x = decode(path)
            block = int(SR * .001)
            env = np.sqrt(np.mean(x[:len(x) // block * block].reshape(-1, block) ** 2, axis=1))
            hot = env > env.max() * 10 ** (-35 / 20)
            onset = next(i for i in range(len(hot) - 4) if hot[i:i + 5].all()) * block
            x = x[max(0, onset - int(.002 * SR)):]
            before = pitch(x, midi)
            factor = 2 ** (-before / 1200)
            x = resample_poly(x, int(round(SR / factor)), SR)
            x = x[:int(cap * SR)]
            rms = np.sqrt(np.mean(x[int(.02 * SR):int(.35 * SR)] ** 2))
            target = -13.6 if prefix.startswith('upright') else -16
            gain = min(10 ** (target / 20) / rms, 10 ** (-6 / 20) / abs(x).max())
            x *= gain
            x[:44] *= np.linspace(0, 1, 44)
            n = min(int(fade * SR), len(x) // 2)
            x[-n:] *= np.linspace(1, 0, n)
            output = dest / f'{prefix}_{midi}.flac'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', 'pipe:0', '-c:a', 'flac', '-sample_fmt', 's16', '-compression_level', '8', '-frame_size', '4096', str(output)], input=x.astype('<f4').tobytes(), check=True)
            streamed = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-f', 's16le', 'pipe:1'], input=output.read_bytes(), capture_output=True, check=True)
            assert not streamed.stderr and len(streamed.stdout) == len(x) * 2, output.name
            after = pitch(decode(output), midi)
            assert abs(after) < 5, (output.name, before, after)
            row = dict(file=output.name, midi=midi, sfz=BASE + SFZ_PIN + '/' + sfz, source=BASE + PIN + '/' + urllib.parse.quote(relative), source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), cents_before=before, cents_after=after, leading_trim_seconds=max(0, onset / SR - .002), gain_db=20 * np.log10(gain), seconds=len(x) / SR, bytes=output.stat().st_size, sha256=hashlib.sha256(output.read_bytes()).hexdigest())
            rows.append(row)
            args.report.write_text(json.dumps(rows, indent=2))
            print(output.name, 'SFZ', midi, 'cents', round(before, 2), '->', round(after, 2), flush=True)
    assert len(rows) == 90 and len({r['file'] for r in rows}) == 90
    print('ROOTS ASSETS VERIFIED', len(rows), sum(r['bytes'] for r in rows), 'bytes', flush=True)


if __name__ == '__main__':
    main()
