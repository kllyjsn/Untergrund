#!/usr/bin/env python3
"""Fetch the CC0 orchestra + full-range piano used by the CLASSICAL genres into samples/live/.

Sources (both CC0 1.0 Universal, see samples/live/LICENSE.md):
  sgossner/VSCO-2-CE @ 440300901dfe9275fd84e0b7763af1f8443ae62e
  sfzinstruments/Osiris_Piano @ 18c6afccb60cff458edbf7c394571783e074e1e9
  sfzinstruments/karoryfer.black-and-green-guitars @ b3b3249d37dc977a1a297bd2dc053e6d9b6b805c (soft guitar layer only)
Both name notes one octave up from scientific pitch (their C3 = MIDI 60), so MIDI = 12 * (octave + 2) + pc.
Processing: leading silence removed, mono, 44.1 kHz 16-bit, trimmed, 80 ms fade, peak -6 dBFS
(the piano instead rings out to -48 dB, at most 9 s, with a 0.6 s fade; see ring()).
Usage: python3 scripts/fetch-orchestra.py [--piano]   (--piano refetches only the piano)
Requires ffmpeg and numpy.
"""
import os, subprocess, urllib.parse, urllib.request
import numpy as np

VSCO = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/440300901dfe9275fd84e0b7763af1f8443ae62e/'
OSIRIS = 'https://raw.githubusercontent.com/sfzinstruments/Osiris_Piano/18c6afccb60cff458edbf7c394571783e074e1e9/'
KARORYFER = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.black-and-green-guitars/b3b3249d37dc977a1a297bd2dc053e6d9b6b805c/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'samples', 'live')
SR = 44100
PC = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}

def midi(name):
    n, o = (name[:2], name[2:]) if len(name) > 2 and name[1] == '#' else (name[:1], name[1:])
    return 12 * (int(o) + 2) + PC[n]

# prefix: (base url, path template, note names, seconds)
SETS = {
    'cello': (VSCO, 'Strings/Cello Section/susvib/susvib_{n}_v3_1.wav', ['C1', 'E1', 'G1', 'B1', 'D2', 'F2', 'A2', 'C3', 'E3', 'G3'], 3.2),
    'cb': (VSCO, 'Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_{n}_v3_rr1.wav', ['G0', 'A#0', 'D1', 'F#1', 'A1'], 3.2),
    'fl': (VSCO, 'Woodwinds/Flute/susvib/LDFlute_susvib_{n}_v1_1.wav', ['C3', 'E3', 'A3', 'C4', 'E4', 'A4', 'C5'], 3.0),
    'ob': (VSCO, 'Woodwinds/Oboe/Vib/Oboe_Vib_{n}_v1_Main.wav', ['A#2', 'D3', 'F3', 'A#3', 'D4', 'F4', 'A#4'], 3.0),
    'cl': (VSCO, 'Woodwinds/Clarinet/susLong/DCClar_susLong_{n}_v2_rr1_sum.wav', ['D2', 'F2', 'A#2', 'D3', 'F3', 'A#3', 'D4'], 3.0),
    'fh': (VSCO, 'Brass/F Horn/sus/MOHorn_sus_{n}_v2_1.wav', ['G1', 'A#1', 'D2', 'F2', 'A2', 'C3'], 3.0),
    'tpt': (VSCO, 'Brass/Trumpet/susvib/Sum_SHTrumpet_susvib_{n}_v1_rr1.wav', ['A2', 'C3', 'D#3', 'G3', 'A#3', 'D4', 'F4', 'A4'], 3.0),
    'harp': (VSCO, 'Strings/Harp/KSHarp_{n}_mf.wav', ['B1', 'F2', 'C3', 'E3', 'B3', 'F4', 'A4', 'C5', 'G5'], 3.0),
}
# The piano rings out: each note is kept until it has decayed RING_FLOOR dB under its loudest 50 ms (at most RING_MAX s),
# then faded over its last RING_FADE s, so a held chord dies away on its own instead of stopping mid-ring.
PIANO_MID = ['C2', 'E2', 'A2', 'C3', 'E3', 'G3', 'B3', 'D4', 'F4', 'A4', 'C5', 'E5']
PIANO_EXT = ['C0', 'E0', 'A0', 'C1', 'E1', 'G1', 'A5', 'C6']
PIANO = {
    'piano': (PIANO_MID, 'vl2'), 'pianosoft': (PIANO_MID, 'vl1'),
    'pianoext': (PIANO_EXT, 'vl2'), 'pianoextsoft': (PIANO_EXT, 'vl1'),
}
RING_FLOOR, RING_MAX, RING_FADE = -48, 9.0, 0.6
# The softly plucked guitar layer (gtrsoft_*), to match the mf layer in gtr_*. Karoryfer names sit an octave above MIDI.
GUITAR_SOFT = {40: 'e3', 42: 'gb3', 45: 'a3', 48: 'c4', 51: 'eb4', 54: 'gb4', 57: 'a4', 60: 'c5', 63: 'eb5', 66: 'gb5', 69: 'a5', 72: 'c6'}
# Drum -> principal pitch, read off each hit's 1 : 1.5 : 2 partial series (drums are numbered large to small).
TIMP = {1: 42, 2: 47, 3: 50, 4: 52, 5: 55}
TIMPANI = [(f'Percussion/Timpani/Timpani{k}_Hit_v3_rr1_Sum.wav', f'timp_{m}', 2.6) for k, m in TIMP.items()] + \
          [(f'Percussion/Timpani/Rolls/Timpani{k}_Roll_v3_rr1_Sum.wav', f'timproll_{TIMP[k]}', 3.0) for k in (2, 4)]

def decode(url):
    data = urllib.request.urlopen(urllib.parse.quote(url, safe=':/')).read()
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', str(SR), '-f', 'f32le', 'pipe:1'],
                         input=data, capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.float32).copy()

def process(x, secs):
    peak = np.max(np.abs(x)) or 1.0
    start = int(np.argmax(np.abs(x) > peak * 0.003))
    x = x[max(0, start - 32):][: int(secs * SR)]
    fade = int(0.08 * SR)
    x[-fade:] *= np.linspace(1, 0, fade)
    return x * (0.5 / (np.max(np.abs(x)) or 1.0))

def ring(x):
    peak = np.max(np.abs(x)) or 1.0
    start = int(np.argmax(np.abs(x) > peak * 0.003))
    x = x[max(0, start - 32):]
    w = int(0.05 * SR); n = len(x) // w
    db = 10 * np.log10(np.mean(x[:n * w].reshape(n, w) ** 2, axis=1) + 1e-20)
    db -= db.max()
    top = int(np.argmax(db))
    end = next((i for i in range(top, n) if db[i] < RING_FLOOR), n)
    x = x[: min(len(x), (end + 1) * w, int(RING_MAX * SR))].copy()
    fade = min(int(RING_FADE * SR), len(x) // 3)
    x[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
    return x * (0.5 / (np.max(np.abs(x)) or 1.0))

def write(name, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', 'pipe:0', '-map_metadata', '-1',
                    '-c:a', 'flac', '-compression_level', '12', os.path.join(OUT, f'{name}.flac')], input=pcm, check=True)

if __name__ == '__main__':
    import sys
    only_piano = '--piano' in sys.argv
    for prefix, (base, tpl, notes, secs) in ({} if only_piano else SETS).items():
        for n in notes:
            write(f'{prefix}_{midi(n)}', process(decode(base + tpl.format(n=n)), secs)); print(prefix, n, midi(n))
    for prefix, (notes, layer) in PIANO.items():
        for n in notes:
            write(f'{prefix}_{midi(n)}', ring(decode(OSIRIS + f'UC-Sus/A/Piano_UC-Sus_MicA_{n}_{layer}.flac'))); print(prefix, n, midi(n))
    for m, n in ({} if only_piano else GUITAR_SOFT).items():
        # Matched to the mf take's loudness over the first second, so the engine's velocity curve still sets the level.
        soft, mf = (process(decode(KARORYFER + f'Samples/black/ord/twang_{n}_{v}_rr1.wav'), 2.0) for v in ('p', 'mf'))
        rms = lambda x: np.sqrt(np.mean(x[:SR] ** 2))
        write(f'gtrsoft_{m}', soft * min(rms(mf) / rms(soft), 0.5 / np.max(np.abs(soft)))); print('gtrsoft', n, m)
    for path, name, secs in ([] if only_piano else TIMPANI):
        write(name, process(decode(VSCO + path), secs)); print(path, '->', name)
