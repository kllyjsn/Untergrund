"""Measured pitch of every pitched recording vs the MIDI note it is mapped to (cents; partials 1-4, 2-6 below C3).

usage: python3 test/sampletune.py   — a recording more than ~5 cents off its center sounds sour when repitched
against the band; put the measured value in the center (BASS_NOTES in js/livekit.js) rather than the name.
"""
import os, re, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from listen import load

ROOT = os.path.join(os.path.dirname(__file__), '..', 'samples', 'live')
NOTE = {'c': 0, 'db': 1, 'd': 2, 'eb': 3, 'e': 4, 'f': 5, 'gb': 6, 'g': 7, 'ab': 8, 'a': 9, 'bb': 10, 'b': 11}


def cents(path, m):
    # Skip the attack (plucked strings start sharp and settle) and, for low notes, read the upper partials:
    # a 0.55 s window cannot place a 50 Hz fundamental to a few cents.
    x, sr = load(path); a, n = int(0.15 * sr), int(0.55 * sr); seg = x[a:a + n]; seg = seg * np.hanning(len(seg))
    S = np.abs(np.fft.rfft(seg, 1 << 20)); f = np.fft.rfftfreq(1 << 20, 1 / sr); d, w = [], []
    for h in ((2, 3, 4, 5, 6) if m < 48 else (1, 2, 3, 4)):
        t = 440 * 2 ** ((m - 69) / 12) * h; lo, hi = np.searchsorted(f, [t * 2 ** (-60 / 1200), t * 2 ** (60 / 1200)]); k = lo + np.argmax(S[lo:hi])
        d.append(1200 * np.log2(f[k] / t)); w.append(S[k] / h)
    return np.average(d, weights=w)


for name in sorted(os.listdir(ROOT)):
    mb = re.match(r'bass_([a-g]b?)(\d)_[ab]\.wav$', name); mn = re.match(r'([a-z]+)_(\d+)\.wav$', name)
    m = NOTE[mb.group(1)] + 12 * (int(mb.group(2)) + 1) if mb else int(mn.group(2)) if mn else None
    if m is None: continue
    c = cents(os.path.join(ROOT, name), m)
    print(f"{name:24s} {m:3d} {c:+6.1f} c{'  <-- off' if abs(c) > 8 else ''}")
