#!/usr/bin/env python3
"""Fetch the CC0 band samples used by the SONGS genres (POP, R&B, ROCK, FOLK, COUNTRY) into samples/live/.

Sources (all CC0 1.0 Universal, see samples/live/LICENSE.md):
  sfzinstruments/karoryfer.shinyguitar @ 57243cca85277dbcc120ce17c6178032f93c80f3 (steel-string acoustic guitar)
  sfzinstruments/karoryfer.black-and-blue-basses @ 6e7d674cdb41be7a54dbccb15472401ad01099b9 (Dark Black electric bass)
  sfzinstruments/virtuosity_drums @ 9f04cf9a734527edfbb0a4eee1f674e45bbf71bc (crash and toms of the kit we already ship)
  freepats/electric-guitar-FSBS-clean @ 192cf0d9bf2c4ba6ead8e3524ba3f78818e4fe91 (Fender electric, clean, bridge pickup)
  sgossner/VCSL @ c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e (Hohner Special 20 diatonic harmonica in C)
The acoustic guitar names notes in scientific pitch (A2 = MIDI 45); the bass names them one octave up (its E2 is the
open low E, MIDI 28), both checked by measuring the recordings' pitch.
Processing: leading silence removed, mono (drum mics summed), 44.1 kHz 16-bit, trimmed, 80 ms fade, peak -6 dBFS.
Guitar takes (--takes): a second round-robin take of every guitar note (gtrb_, gtrsoftb_, agtrb_) and the Hofner's staccato (fretting hand lifted, the palm-mute chug;
gtrmute_, gtrmuteb_), each matched to the loudness of the take it alternates with.
Requires ffmpeg and numpy.  Usage: python3 scripts/fetch-band.py [--takes]   (--takes fetches only the guitar takes, --guitars only JAZZ GTR, TWANG GTR and BANJO)
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location('orch', os.path.join(os.path.dirname(__file__), 'fetch-orchestra.py'))
orch = importlib.util.module_from_spec(spec); spec.loader.exec_module(orch)
decode, process, write = orch.decode, orch.process, orch.write

SHINY = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.shinyguitar/57243cca85277dbcc120ce17c6178032f93c80f3/Samples/'
BASSES = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.black-and-blue-basses/6e7d674cdb41be7a54dbccb15472401ad01099b9/Samples/'
TELE = 'https://raw.githubusercontent.com/freepats/electric-guitar-FSBS-clean/192cf0d9bf2c4ba6ead8e3524ba3f78818e4fe91/samples/bridge/'
VCSL = 'https://raw.githubusercontent.com/sgossner/VCSL/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/'
HCA_DIR = 'Aerophones/Free Aerophones/Harmonica-Hohner-Special20-C/Sustains/Vib/'
VD = 'https://raw.githubusercontent.com/sfzinstruments/virtuosity_drums/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/'

# MIDI note -> source note name.
AGTR = {40: 'e2', 42: 'gb2', 45: 'a2', 48: 'c3', 51: 'eb3', 54: 'gb3', 57: 'a3', 60: 'c4', 63: 'eb4', 66: 'gb4', 69: 'a4', 72: 'c5'}
EBASS = {28: 'e2', 31: 'g2', 34: 'bb2', 37: 'db3', 40: 'e3', 43: 'g3', 46: 'bb3', 49: 'db4', 52: 'e4', 55: 'g4'}
# Country's lead guitar (scientific pitch, C4 = MIDI 60): first round robin of each string/fret take.
TELE_NOTES = {52: 'E3_s3', 55: 'G3_s4', 59: 'B3_s5', 61: 'C#4_s5', 64: 'E4_s6', 67: 'G4_s6', 71: 'B4_s6', 72: 'C5_s6', 74: 'D5_s6', 77: 'F5_s6', 80: 'G#5_s6', 82: 'A#5_s6', 85: 'C#6_s6'}
# The harmonica in C, with vibrato: the blow and draw notes the library recorded (C, E, G in three octaves and top C).
HCA = {48: 'C3', 52: 'E3', 55: 'G3', 60: 'C4', 64: 'E4', 67: 'G4', 72: 'C5', 76: 'E5', 79: 'G5', 84: 'C6'}
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
    for m, n in AGTR.items():
        write(f'agtr_{m}', process(decode(f'{SHINY}acoustic/{n}_vl3_rr1_1.wav'), 3.4)); print('agtr', n, m)
    for m, n in EBASS.items():
        write(f'ebass_{m}', process(decode(f'{BASSES}darkblack/reg/darkblack_{n}_mf_rr1.wav'), 3.0)); print('ebass', n, m)
    for m, n in TELE_NOTES.items():
        write(f'tele_{m}', process(decode(f'{TELE}{n}_01.flac'), 3.0)); print('tele', n, m)
    for m, n in HCA.items():
        write(f'hca_{m}', process(decode(f'{VCSL}{HCA_DIR}Hohner-Special20_Vib_{n}.wav'), 3.0)); print('hca', n, m)
    for name, (files, secs) in DRUMS.items():
        xs = [decode(VD + f) for f in files]
        L = min(len(x) for x in xs)
        write(name, process(sum(x[:L] for x in xs), secs)); print(name)
    takes()
