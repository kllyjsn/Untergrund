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
from scipy import ndimage, signal

ROOT = Path(__file__).resolve().parent.parent
SR = 48000
EP_COMMIT = '8c3e581acda3594b553948ff0222d4f84a698376'
EP = f'https://raw.githubusercontent.com/sfzinstruments/GregSullivan.E-Pianos/{EP_COMMIT}/'
WIND_COMMIT = '440300901dfe9275fd84e0b7763af1f8443ae62e'
WIND = f'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/{WIND_COMMIT}/'
PC = {'c': 0, 'db': 1, 'd': 2, 'eb': 3, 'e': 4, 'f': 5, 'gb': 6, 'g': 7, 'ab': 8, 'a': 9, 'bb': 10, 'b': 11}


def fetch(url):
    return urllib.request.urlopen(urllib.parse.quote(url, safe=':/%'), timeout=60).read()


def tuning(x, midi, start=.12, seconds=.5):
    a = int(start * SR)
    seg = x[a:a + int(seconds * SR)]
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


def normalization_gain(x, reference_seconds=None):
    if not len(x) or not np.isfinite(x).all():
        raise ValueError('Expected nonempty finite audio')
    if reference_seconds is not None and (not np.isfinite(reference_seconds) or reference_seconds <= 0):
        raise ValueError('Expected a positive normalization reference')
    peak = float(np.max(np.abs(x)))
    if not peak:
        return 1.0
    reference = x if reference_seconds is None else x[:max(1, int(reference_seconds * SR))]
    reference_peak = float(np.max(np.abs(reference)))
    return min(.5 / max(reference_peak, 1e-9), .98 / peak)


def import_sample(job):
    bank, midi, base, original, limit = job[:5]
    reference_seconds = job[5] if len(job) > 5 else None
    data = fetch(base + original)
    pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], input=data)
    x = np.frombuffer(pcm, dtype='<f4').copy()
    threshold = .003 if bank.startswith('jep') else .03
    onset = max(0, int(np.argmax(np.abs(x) > max(np.max(np.abs(x)), 1e-9) * threshold)) - 48)
    x = x[onset:][:int(limit * SR)]
    cents = tuning(x, midi, .035, .16) if bank.startswith('jts') else tuning(x, midi)
    # Keep the recorded decay, fading only the final edge of the stored take.
    fade = min(int(.08 * SR), len(x) // 4)
    x[-fade:] *= np.linspace(1, 0, fade)
    gain = normalization_gain(x, reference_seconds)
    x *= gain
    target = ROOT / 'samples' / 'live' / f'{bank}_{midi}.flac'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', 'pipe:0', '-map_metadata', '-1', '-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', '-compression_level', '12', str(target)], input=x.astype('<f4').tobytes(), check=True)
    sample = dict(bank=bank, midi=midi, source=original, sourceUrl=base + urllib.parse.quote(original), sourceSha256=hashlib.sha256(data).hexdigest(), importedFile=target.name, importedSha256=hashlib.sha256(target.read_bytes()).hexdigest(), measuredCents=cents, onsetTrimSeconds=onset / SR, gainDb=round(float(20 * np.log10(gain)), 3), duration=len(x) / SR, bytes=target.stat().st_size)
    if reference_seconds is not None:
        sample['normalizationReferenceSeconds'] = reference_seconds
    return sample


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


def winds(legacy_levels=False):
    trumpet = ['F2', 'A2', 'C3', 'D#3', 'F3', 'G3', 'A#3', 'D4', 'F4', 'A4', 'C5']
    harmon = ['A#2', 'C3', 'D#3', 'G#3', 'A#3', 'D4', 'F4', 'A4']
    flute = ['C3', 'E3', 'A3', 'C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6']
    def midi(note):
        return {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[note[0]] + ('#' in note) + 12 * (int(note[-1]) + 2)
    jobs = []
    for n in trumpet:
        for v in [1, 2]:
            jobs.append((f'jtv{v}', midi(n), WIND, f'Brass/Trumpet/susvib/Sum_SHTrumpet_susvib_{n}_v{v}_rr1.wav', 3.2))
        for v in [1, 2, 3]:
            for rr in [1, 2]:
                jobs.append((f'jts{v}{rr}', midi(n), WIND, f'Brass/Trumpet/stac/Sum_SHTrumpet_stac_{n}_v{v}_rr{rr}.wav', 1.0))
    for n in harmon:
        for v in [1, 3]:
            jobs.append((f'jhm{v}', midi(n), WIND, f'Brass/Trumpet/harmonM-sus/Sum_SHTrumpet_harmonM-sus_{n}_v{v}_rr1.wav', 3.2))
    for n in flute:
        for bank, articulation in [('jfl', 'susvib'), ('jflb', 'expvib')]:
            jobs.append((bank, midi(n), WIND, f'Woodwinds/Flute/{articulation}/LDFlute_{articulation}_{n}_v1_1.wav', 3.2, 1.4 if bank == 'jflb' and not legacy_levels else None))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        samples = list(pool.map(import_sample, jobs))
    (ROOT / 'samples' / 'JAZZ-WINDS-LICENSE.txt').write_bytes(fetch(WIND + 'LICENSE'))
    provenance = dict(collection='VSCO-2 CE jazz winds', source='https://github.com/sgossner/VSCO-2-CE', commit=WIND_COMMIT, license='CC0-1.0', licenseUrl=WIND + 'LICENSE', attribution='Recorded by Sam Gossner & Simon Dalzell; sample cutting by Elan Hickler/Soundemote.', processing=dict(sampleRate=SR, bits=24, channels=1, format='FLAC', onsetThresholdDb=-30.46, maxSustainSeconds=3.2, maxStaccatoSeconds=1, tailFadeSeconds=.08, peakDbfs=-6.02, denoising=False, synthesis=False, timbralEq=False, tuning='Weighted partials: staccato 35-195 ms, sustains 120-620 ms; offsets applied during playback'), samples=samples)
    if not legacy_levels:
        provenance['processing']['alternateNormalization'] = dict(referenceSeconds=1.4, referencePeakDbfs=-6.02, maxPeakDbfs=-.1755)
    (ROOT / 'samples' / 'jazz-winds-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    banks = {k: sorted(s['midi'] for s in samples if s['bank'] == k) for k in sorted(set(s['bank'] for s in samples))}
    tunes = {k: {s['midi']: s['measuredCents'] for s in samples if s['bank'] == k} for k in banks}
    peaks, measurements = {}, []
    for sample in samples:
        x = np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(ROOT / 'samples' / 'live' / sample['importedFile']), '-f', 'f32le', '-']), dtype='<f4')
        f, power = signal.welch(x, SR, nperseg=min(16384, len(x)))
        db = 10 * np.log10(np.maximum(power, 1e-25))
        median = ndimage.median_filter(db, size=101)
        candidates, _ = signal.find_peaks(db, distance=28, prominence=3)
        minimum = max(2000, 1.1 * 440 * 2 ** ((sample['midi'] - 69) / 12))
        candidates = sorted([i for i in candidates if minimum < f[i] < 4000 and db[i] - median[i] > 14], key=lambda i: db[i], reverse=True)[:2]
        corrections = []
        for i in candidates:
            prominence = float(db[i] - median[i])
            depth = -round(min(33, max(3, prominence - 10)), 1)
            corrections.append([round(float(f[i]), 1), 40, depth])
            measurements.append(dict(file=sample['importedFile'], hz=round(float(f[i]), 2), prominence=round(prominence, 2), q=40, gainDb=depth))
        peaks.setdefault(sample['bank'], {})[sample['midi']] = corrections
    (ROOT / 'samples' / 'jazz-winds-resonances.json').write_text(json.dumps(dict(method='Mono 48kHz; Welch16384 Hann; 101-bin median; two strongest 2-4kHz peaks over 14dB, above 1.1x the fundamental; runtime Q40 cuts scaled to playback rate. Context validated separately with lead-muted native renders.', samples=measurements), indent=2) + '\n')
    (ROOT / 'js' / 'jazz-wind-data.js').write_text('export const WIND_BANKS = ' + json.dumps(banks, indent=2) + ';\nexport const WIND_TUNING = ' + json.dumps(tunes, indent=2) + ';\nexport const WIND_PEAKS = ' + json.dumps(peaks, indent=2) + ';\n')
    print(f'Jazz winds: {len(samples)} recordings; {sum(s["bytes"] for s in samples)} bytes; {len(measurements)} measured narrow bands')


if __name__ == '__main__':
    if sys.argv[1:] == ['--wurli']:
        wurli()
    elif sys.argv[1:] == ['--winds']:
        winds()
    elif sys.argv[1:] == ['--winds-legacy-levels']:
        winds(legacy_levels=True)
    else:
        raise SystemExit('Usage: python3 scripts/fetch-jazz.py --wurli | --winds | --winds-legacy-levels')
