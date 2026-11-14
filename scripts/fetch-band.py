#!/usr/bin/env python3
"""Fetch the CC0 band samples used by the SONGS genres (POP, R&B, ROCK, FOLK, COUNTRY) into samples/live/.

Sources (all CC0 1.0 Universal, see samples/live/LICENSE.md):
  sfzinstruments/karoryfer.shinyguitar @ 57243cca85277dbcc120ce17c6178032f93c80f3 (steel-string acoustic guitar)
  sfzinstruments/karoryfer.black-and-blue-basses @ 6e7d674cdb41be7a54dbccb15472401ad01099b9 (Dark Black electric bass)
  sfzinstruments/virtuosity_drums @ 9f04cf9a734527edfbb0a4eee1f674e45bbf71bc (crash and toms of the kit we already ship)
The acoustic guitar names notes in scientific pitch (A2 = MIDI 45); the bass names them one octave up (its E2 is the
open low E, MIDI 28), both checked by measuring the recordings' pitch.
Processing: leading silence removed, mono (drum mics summed), 44.1 kHz 16-bit, trimmed, 80 ms fade, peak -6 dBFS.
Guitar takes (--takes): a second round-robin take of every guitar note (gtrb_, gtrsoftb_, agtrb_) and the Hofner's staccato (fretting hand lifted, the palm-mute chug;
gtrmute_, gtrmuteb_), each matched to the loudness of the take it alternates with.
Requires ffmpeg and numpy.  Usage: python3 scripts/fetch-band.py [--takes]   (--takes fetches only the guitar takes, --guitars only JAZZ GTR, TWANG GTR and BANJO, --kit only the extra kit takes)
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location('orch', os.path.join(os.path.dirname(__file__), 'fetch-orchestra.py'))
orch = importlib.util.module_from_spec(spec); spec.loader.exec_module(orch)
decode, process, write = orch.decode, orch.process, orch.write

SHINY = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.shinyguitar/57243cca85277dbcc120ce17c6178032f93c80f3/Samples/'
BASSES = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.black-and-blue-basses/6e7d674cdb41be7a54dbccb15472401ad01099b9/Samples/'
VD = 'https://raw.githubusercontent.com/sfzinstruments/virtuosity_drums/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/'

# MIDI note -> source note name.
AGTR = {40: 'e2', 42: 'gb2', 45: 'a2', 48: 'c3', 51: 'eb3', 54: 'gb3', 57: 'a3', 60: 'c4', 63: 'eb4', 66: 'gb4', 69: 'a4', 72: 'c5'}
EBASS = {28: 'e2', 31: 'g2', 34: 'bb2', 37: 'db3', 40: 'e3', 43: 'g3', 46: 'bb3', 49: 'db4', 52: 'e4', 55: 'g4'}
KARORYFER = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.black-and-green-guitars/b3b3249d37dc977a1a297bd2dc053e6d9b6b805c/Samples/black/'
# The Hofner names sit an octave above MIDI (twang_e3 is MIDI 40).
HOFNER = {40: 'e3', 42: 'gb3', 45: 'a3', 48: 'c4', 51: 'eb4', 54: 'gb4', 57: 'a4', 60: 'c5', 63: 'eb5', 66: 'gb5', 69: 'a5', 72: 'c6'}
# new prefix -> (url template, seconds, reference prefix, seconds of the reference to match loudness over)
TAKES = {
    'gtrb': (KARORYFER + 'ord/twang_{h}_mf_rr2.wav', 2.0, 'gtr', 1.0),
    'gtrsoftb': (KARORYFER + 'ord/twang_{h}_p_rr2.wav', 2.0, 'gtrsoft', 1.0),
    'gtrmute': (KARORYFER + 'stac/staccato_{h}_rr1.wav', 0.8, 'gtr', 0.15),
    'gtrmuteb': (KARORYFER + 'stac/staccato_{h}_rr2.wav', 0.8, 'gtr', 0.15),
    'agtrb': (SHINY + 'acoustic/{a}_vl3_rr2_1.wav', 3.4, 'agtr', 1.0),
}
GREEN = KARORYFER.replace('/black/', '/green/')
GANJO = 'https://raw.githubusercontent.com/sfzinstruments/ganjo/ccff5cd5cd3b513873a48994c07724d9d3c39e1c/Common/Banjo_Common - '
# ganjo.sfz maps each sample an octave below its name (E3 is MIDI 40), like the Hofner.
BANJO = {40: 'E3', 42: 'F#3', 45: 'A3', 49: 'C#4', 51: 'D#4', 54: 'F#4', 57: 'A4', 60: 'C5', 63: 'D#5', 68: 'G#5', 71: 'B5'}
# More guitars (--guitars): the archtop's magnetic pickup (JAZZ GTR), the green Gretsch Anniversary (TWANG GTR) and
# the SX six-string guitar banjo (BANJO). prefix -> (notes, url template, seconds)
GUITARS = {
    'jazz': (AGTR, SHINY + 'electric/{n}_vl3_rr1_2.wav', 3.0),
    'gretsch': (HOFNER, GREEN + 'ord/twang_{n}_mf_rr1.wav', 2.4),
    'banjo': (BANJO, GANJO + '{n}.wav', 2.4),
}
GUITAR_TAKES = {
    'jazzb': (AGTR, SHINY + 'electric/{n}_vl3_rr2_2.wav', 3.0, 'jazz'),
    'gretschb': (HOFNER, GREEN + 'ord/twang_{n}_mf_rr2.wav', 2.4, 'gretsch'),
}
# name -> (mic files summed, seconds)
DRUMS = {
    'crash_v2': (['oh/crash/oh_crash_crash_vl2_rr1.flac', 'mid/crash/mid_crash_crash_vl2_rr1.flac'], 3.2),
    'crash_v3': (['oh/crash/oh_crash_crash_vl3_rr1.flac', 'mid/crash/mid_crash_crash_vl3_rr1.flac'], 3.2),
    'htom_v8': (['mid/htom/mid_htom_center_vl8.flac', 'oh/htom/oh_htom_center_vl8.flac'], 1.4),
    'htom_v14': (['mid/htom/mid_htom_center_vl14.flac', 'oh/htom/oh_htom_center_vl14.flac'], 1.4),
    'ltom_v8': (['mid/ltom/mid_ltom_center_vl8.flac', 'oh/ltom/oh_ltom_center_vl8.flac'], 1.6),
    'ltom_v14': (['mid/ltom/mid_ltom_center_vl14.flac', 'oh/ltom/oh_ltom_center_vl14.flac'], 1.6),
}

# More kit takes (--kit): round robins and in-between velocity layers of the kick, snare and hats we already ship, so
# repeated hits and ghost notes don't machine-gun. Snare has no round robins upstream; an adjacent velocity layer is
# the alternate take. Normalized like the shipped kit files (peak -1 dBFS).
def _kick(v, r): return (['kickmic/kick/kickmic_kick_snoff_vl%d_rr%d.flac' % (v, r), 'oh/kick/oh_kick_snoff_vl%d_rr%d.flac' % (v, r)], 0.7)
def _snare(v): return (['snaremic/snare/snaremic_snare_center_vl%d.flac' % v, 'oh/snare/oh_snare_center_vl%d.flac' % v], 0.8)
KIT = {
    **{f'kick_v{v}_{r}': _kick(v, r) for v, r in [(2, 3), (2, 4), (4, 3), (4, 4), (3, 1), (3, 2)]},
    **{f'snare_v{v}': _snare(v) for v in (2, 5, 13, 23, 33)},
    **{f'hh_v{v}_{r}': ([f'oh/hh/oh_hh_closed_vl{v}_rr{r}.flac'], 0.35) for v in range(1, 5) for r in (3, 4)},
    'hh_half_2': (['oh/hh/oh_hh_half_vl2_rr2.flac'], 0.7),
    'hh_open_2': (['oh/hh/oh_hh_open_vl3_rr2.flac'], 1.2),
}

def onset(x, frac=0.1):
    import numpy as np
    return int(np.argmax(np.abs(x) > frac * np.max(np.abs(x))))

def drum(files, secs, ref=None, peak=10 ** (-1 / 20)):
    import numpy as np
    xs = [decode(VD + f) for f in files]
    L = min(len(x) for x in xs)
    x = process(sum(x[:L] for x in xs), secs + 0.05)
    if ref is not None:  # land the attack on the same sample as the shipped take it alternates with
        d = onset(x) - onset(ref)
        x = x[d:] if d > 0 else np.concatenate([np.zeros(-d, np.float32), x])
    x = x[: int(secs * orch.SR)].copy()
    fade = int(0.08 * orch.SR)
    x[-fade:] *= np.linspace(1, 0, fade)
    return x * (peak / max(1e-9, float(np.max(np.abs(x)))))

def load(name):
    import subprocess, numpy as np
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(orch.OUT, f'{name}.flac'), '-f', 'f32le', 'pipe:1'], capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.float32)

def takes():
    import numpy as np
    for prefix, (tpl, secs, ref, win) in TAKES.items():
        for m in AGTR:
            x = process(decode(tpl.format(h=HOFNER[m], a=AGTR[m])), secs)
            y, n = load(f'{ref}_{m}'), int(win * orch.SR)
            rms = lambda z: np.sqrt(np.mean(z[:n] ** 2))
            write(f'{prefix}_{m}', x * min(rms(y) / rms(x), 0.98 / np.max(np.abs(x)))); print(prefix, m)

def guitars():
    import numpy as np
    for prefix, (notes, tpl, secs) in GUITARS.items():
        for m, n in notes.items(): write(f'{prefix}_{m}', process(decode(tpl.format(n=n)), secs)); print(prefix, m)
    for prefix, (notes, tpl, secs, ref) in GUITAR_TAKES.items():
        for m, n in notes.items():
            x, y, k = process(decode(tpl.format(n=n)), secs), load(f'{ref}_{m}'), orch.SR
            rms = lambda z: np.sqrt(np.mean(z[:k] ** 2))
            write(f'{prefix}_{m}', x * min(rms(y) / rms(x), 0.98 / np.max(np.abs(x)))); print(prefix, m)

if __name__ == '__main__':
    if '--takes' in sys.argv: takes(); sys.exit()
    if '--guitars' in sys.argv: guitars(); sys.exit()
    if '--kit' in sys.argv:
        ref = lambda n: load({'kick': 'kick_v2_1', 'snare': 'snare_v6', 'hh_v': 'hh_v1_1', 'hh_half': 'hh_half', 'hh_open': 'hh_open'}[next(k for k in ('kick', 'snare', 'hh_v', 'hh_half', 'hh_open') if n.startswith(k))])
        for name, (files, secs) in KIT.items(): write(name, drum(files, secs, ref(name))); print(name)
        sys.exit()
    for m, n in AGTR.items():
        write(f'agtr_{m}', process(decode(f'{SHINY}acoustic/{n}_vl3_rr1_1.wav'), 3.4)); print('agtr', n, m)
    for m, n in EBASS.items():
        write(f'ebass_{m}', process(decode(f'{BASSES}darkblack/reg/darkblack_{n}_mf_rr1.wav'), 3.0)); print('ebass', n, m)
    for name, (files, secs) in DRUMS.items():
        xs = [decode(VD + f) for f in files]
        L = min(len(x) for x in xs)
        write(name, process(sum(x[:L] for x in xs), secs)); print(name)
    takes()
