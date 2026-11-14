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
Requires ffmpeg and numpy.  Usage: python3 scripts/fetch-band.py [--takes]   (--takes fetches only the guitar takes)
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
# name -> (mic files summed, seconds)
DRUMS = {
    'crash_v2': (['oh/crash/oh_crash_crash_vl2_rr1.flac', 'mid/crash/mid_crash_crash_vl2_rr1.flac'], 3.2),
    'crash_v3': (['oh/crash/oh_crash_crash_vl3_rr1.flac', 'mid/crash/mid_crash_crash_vl3_rr1.flac'], 3.2),
    'htom_v8': (['mid/htom/mid_htom_center_vl8.flac', 'oh/htom/oh_htom_center_vl8.flac'], 1.4),
    'htom_v14': (['mid/htom/mid_htom_center_vl14.flac', 'oh/htom/oh_htom_center_vl14.flac'], 1.4),
    'ltom_v8': (['mid/ltom/mid_ltom_center_vl8.flac', 'oh/ltom/oh_ltom_center_vl8.flac'], 1.6),
    'ltom_v14': (['mid/ltom/mid_ltom_center_vl14.flac', 'oh/ltom/oh_ltom_center_vl14.flac'], 1.6),
}

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

if __name__ == '__main__':
    if '--takes' in sys.argv: takes(); sys.exit()
    for m, n in AGTR.items():
        write(f'agtr_{m}', process(decode(f'{SHINY}acoustic/{n}_vl3_rr1_1.wav'), 3.4)); print('agtr', n, m)
    for m, n in EBASS.items():
        write(f'ebass_{m}', process(decode(f'{BASSES}darkblack/reg/darkblack_{n}_mf_rr1.wav'), 3.0)); print('ebass', n, m)
    for name, (files, secs) in DRUMS.items():
        xs = [decode(VD + f) for f in files]
        L = min(len(x) for x in xs)
        write(name, process(sum(x[:L] for x in xs), secs)); print(name)
    takes()
