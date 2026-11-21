#!/usr/bin/env python3
"""Fetch the CC0 Freesound multisamples (tonewheel organ, analog synth bass) into samples/live/.

Sources (all CC0 1.0 Universal, see samples/live/LICENSE.md), original uploads, never the lossy previews:
  Freesound pack 18844 "tonewheel organ sound samples" by hammondman: one sustained note per white key, B2-B5 (org_)
  Freesound pack 17593 "Roland SH-2 - Filter Vel Bass" by modularsamples, brightest of each note's 4 velocity takes (abass_)
Freesound serves originals only to a signed-in app: set FREESOUND_ACCESS_TOKEN (an OAuth2 access token), or pass
--raw DIR holding <sound id>.<ext> files already downloaded.
Processing: as scripts/fetch-orchestra.py (leading silence removed, mono, 44.1 kHz 16-bit, trimmed, 80 ms fade, peak -6 dBFS).
Usage: python3 scripts/fetch-freesound.py [--raw DIR] [--only org|abass]
"""
import os, subprocess, sys, time, urllib.error, urllib.request
import importlib.util
spec = importlib.util.spec_from_file_location('orch', os.path.join(os.path.dirname(__file__), 'fetch-orchestra.py'))
orch = importlib.util.module_from_spec(spec); spec.loader.exec_module(orch)
process, write, np, SR = orch.process, orch.write, orch.np, orch.SR

# MIDI note -> Freesound sound id. hammondman names notes in scientific pitch (c4 = MIDI 60), checked by measuring.
ORGAN = {43: 333769, 47: 333747, 48: 333751, 50: 333764, 52: 333761, 53: 333766, 55: 333759, 57: 333750, 59: 333754,
         60: 333756, 62: 333763, 64: 333768, 65: 333765, 67: 333760, 69: 333749, 71: 333753, 72: 333755, 74: 333762,
         76: 333767, 77: 333770, 79: 333758, 81: 333748, 83: 333752}
# modularsamples names each note by MIDI number ("36C1" is MIDI 36, C2), checked by measuring. The SH-2 sub oscillator
# adds the octave below. Each note's top velocity take (the most open filter); the engine's low-pass closes it per note.
BASS = {36: 310235, 39: 310247, 42: 310259, 45: 310271, 48: 310282, 51: 310294, 54: 310306, 57: 310318, 60: 310330}
# prefix -> (notes, seconds kept)
SETS = {'org': (ORGAN, 2.2), 'abass': (BASS, 2.4)}


def original(sid, raw):
    if raw:
        f = next(os.path.join(d, n) for d, _, ns in os.walk(raw) for n in ns if n.split('.')[0] == str(sid))
        return open(f, 'rb').read()
    req = urllib.request.Request(f'https://freesound.org/apiv2/sounds/{sid}/download/',
                                 headers={'Authorization': 'Bearer ' + os.environ['FREESOUND_ACCESS_TOKEN']})
    for k in range(10):
        try:
            data = urllib.request.urlopen(req, timeout=60).read(); time.sleep(5); return data
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            time.sleep(15 * (k + 1))
    raise RuntimeError(f'Freesound kept rate-limiting sound {sid}')


def decode(data):
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', str(SR), '-f', 'f32le', 'pipe:1'],
                         input=data, capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.float32).copy()


if __name__ == '__main__':
    raw = sys.argv[sys.argv.index('--raw') + 1] if '--raw' in sys.argv else None
    only = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
    for prefix, (notes, secs) in SETS.items():
        if only and prefix != only: continue
        for m, sid in notes.items():
            write(f'{prefix}_{m}', process(decode(original(sid, raw)), secs)); print(prefix, m, sid)
