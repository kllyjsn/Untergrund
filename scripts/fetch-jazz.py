#!/usr/bin/env python3
"""Import pinned, licensed jazz recordings; requires ffmpeg, numpy and scipy."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import urllib.parse
import urllib.request

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SR = 48000
EP_COMMIT = '8c3e581acda3594b553948ff0222d4f84a698376'
EP = f'https://raw.githubusercontent.com/sfzinstruments/GregSullivan.E-Pianos/{EP_COMMIT}/'
PC = {'c': 0, 'db': 1, 'd': 2, 'eb': 3, 'e': 4, 'f': 5, 'gb': 6, 'g': 7, 'ab': 8, 'a': 9, 'bb': 10, 'b': 11}


def fetch(url):
    return urllib.request.urlopen(urllib.parse.quote(url, safe=':/%'), timeout=60).read()


def tuning(x, midi):
    a = int(.12 * SR)
    seg = x[a:a + int(.5 * SR)]
    spectrum = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), 1 << 19))
    f = np.fft.rfftfreq(1 << 19, 1 / SR)
    offsets, weights = [], []
    for h in ([2, 3, 4, 5, 6] if midi < 48 else [1, 2, 3, 4]):
        target = 440 * 2 ** ((midi - 69) / 12) * h
        lo, hi = np.searchsorted(f, [target * 2 ** (-60 / 1200), target * 2 ** (60 / 1200)])
        k = lo + np.argmax(spectrum[lo:hi])
        offsets.append(1200 * np.log2(f[k] / target))
        weights.append(spectrum[k] / h)
    return round(float(np.average(offsets, weights=weights)), 2)


def import_sample(job):
    bank, midi, base, original, limit = job
    data = fetch(base + original)
    pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], input=data)
    x = np.frombuffer(pcm, dtype='<f4').copy()
    onset = max(0, int(np.argmax(np.abs(x) > max(np.max(np.abs(x)), 1e-9) * .003)) - 48)
    x = x[onset:][:int(limit * SR)]
    cents = tuning(x, midi)
    # Keep the recorded decay, fading only the final edge of the stored take.
    fade = min(int(.08 * SR), len(x) // 4)
    x[-fade:] *= np.linspace(1, 0, fade)
    gain = .5 / max(float(np.max(np.abs(x))), 1e-9)
    x *= gain
    target = ROOT / 'samples' / 'live' / f'{bank}_{midi}.flac'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', 'pipe:0', '-map_metadata', '-1', '-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', '-compression_level', '12', str(target)], input=x.astype('<f4').tobytes(), check=True)
    return dict(bank=bank, midi=midi, source=original, sourceUrl=base + urllib.parse.quote(original), sourceSha256=hashlib.sha256(data).hexdigest(), importedFile=target.name, importedSha256=hashlib.sha256(target.read_bytes()).hexdigest(), measuredCents=cents, onsetTrimSeconds=onset / SR, gainDb=round(float(20 * np.log10(gain)), 3), duration=len(x) / SR, bytes=target.stat().st_size)


def wurli():
    sfz = fetch(EP + 'Wurlitzer%20EP200/Wurlitzer%20EP200.sfz').decode()
    files = sorted(set(re.findall(r'sample=([^\s]+)\.\$EXT', sfz)))
    jobs = []
    for name in files:
        match = re.fullmatch(r'([a-g](?:b)?)(\d)(pp|mp|ff|f)', name)
        pitch, octave, dynamic = match.groups()
        midi = PC[pitch] + 12 * (int(octave) + 1)
        jobs.append((f'jep{["pp", "mp", "f", "ff"].index(dynamic) + 1}', midi, EP, f'Wurlitzer EP200/Samples/{name}.flac', 6))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        samples = list(pool.map(import_sample, jobs))
    license_text = fetch(EP + 'LICENSE').decode()
    (ROOT / 'samples' / 'WURLITZER-LICENSE.txt').write_text(license_text)
    provenance = dict(collection='Greg Sullivan Wurlitzer EP200', source='https://github.com/sfzinstruments/GregSullivan.E-Pianos', commit=EP_COMMIT, license='CC-BY-3.0', licenseUrl=EP + 'LICENSE', attribution='Wurlitzer EP200 recordings by Greg Sullivan; SFZ mapping by kinwie. Mono conversion, resampling, trimming, level normalization and tuning measurements by Untergrund.', processing=dict(sampleRate=SR, bits=24, channels=1, format='FLAC', onsetThresholdDb=-50.46, maxSeconds=6, tailFadeSeconds=.08, peakDbfs=-6.02, denoising=False, synthesis=False, timbralEq=False, tuning='Weighted partials over 120-620 ms; offsets applied during playback'), samples=samples)
    (ROOT / 'samples' / 'wurlitzer-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    banks = {k: sorted(s['midi'] for s in samples if s['bank'] == k) for k in sorted(set(s['bank'] for s in samples))}
    tunes = {k: {s['midi']: s['measuredCents'] for s in samples if s['bank'] == k} for k in banks}
    (ROOT / 'js' / 'jazz-sample-data.js').write_text('export const JAZZ_BANKS = ' + json.dumps(banks, indent=2) + ';\nexport const JAZZ_TUNING = ' + json.dumps(tunes, indent=2) + ';\n')
    print(f'Wurlitzer: {len(samples)} recordings; {sum(s["bytes"] for s in samples)} bytes; four dynamics')


if __name__ == '__main__':
    if sys.argv[1:] == ['--wurli']:
        wurli()
    else:
        raise SystemExit('Usage: python3 scripts/fetch-jazz.py --wurli')
