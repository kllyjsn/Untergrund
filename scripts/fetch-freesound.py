#!/usr/bin/env python3
"""Fetch the CC0 Freesound multisamples (tonewheel organ, analog synth bass) into samples/live/.

Sources (all CC0 1.0 Universal, see samples/live/LICENSE.md), original uploads, never the lossy previews:
  Freesound pack 18844 "tonewheel organ sound samples" by hammondman: one sustained note per white key, B2-B5 (org_)
  Freesound pack 17593 "Roland SH-2 - Filter Vel Bass" by modularsamples, brightest of each note's 4 velocity takes (abass_)
  Pages: https://freesound.org/people/hammondman/packs/18844/ and https://freesound.org/people/modularsamples/packs/17593/;
  each sound is https://freesound.org/s/<id>/. Every original is pinned by SHA-256 below and checked before processing;
  processing these originals reproduces the committed FLACs byte for byte.
Freesound serves originals only to a signed-in app: set FREESOUND_ACCESS_TOKEN (an OAuth2 access token), or pass
--raw DIR holding <sound id>.<ext> files already downloaded.
Processing: as scripts/fetch-orchestra.py (leading silence removed, mono, 44.1 kHz 16-bit, trimmed, 80 ms fade, peak -6 dBFS).
Usage: python3 scripts/fetch-freesound.py [--raw DIR] [--only org|abass]
"""
import hashlib, os, subprocess, sys, time, urllib.error, urllib.request
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
# SHA-256 of each original upload as Freesound serves it from /download/; a changed or substituted file stops the fetch.
SHA256 = {333769: 'a5f04533c7e3be1b652ca7742092c19d22e4c92b623762e7e35395ef359ef6d0',
          333747: 'dbed651893be6e02e2b81f2c6b8353b21df2c9cc03ddea4c1169a5e947d32f47',
          333751: '87f7ced0bea9486fae3cc2adef11473dcdae04fd86dbc6d344ff0729c35ec872',
          333764: '5cc25044f9321c0de14a75c33e771535435473155638ea1cc92282fc67c7f9f6',
          333761: '9dd3074c74563ab2e8a772d2d6dec55f915c3834dae0b4414be08d32438165e2',
          333766: 'e5db0d26f666a164567d92f666abf5606d40707a2203ffd1d8c395f00798ada2',
          333759: 'a2c9d00960b8e341fd422754bfdc00b62ce45173464bd8aa06809ee2bdbd1313',
          333750: '0c142e332be9a2321308d3f332a75cb26901bfb449eff592ee96f069babd28d1',
          333754: '7c8b51cada917fc1bbc9febe4c2250bee30f5d48ae7b2b0a8c011e20ce073d18',
          333756: '7c5c465c213c7eb67df4aa00f99290928fbf002e7567a33b4b98d7025e70f2ee',
          333763: 'cb69e49a10ea5a7599117d2901984048a539097a8979e957174226a9e1c56312',
          333768: 'cf7c90710ebcfb41791eb3e8ef699458eb4a81ff8cd4cb816932c405d9759e17',
          333765: '7153093d040650de399b3222d498f62c1cb82960bc0fa2876b092860becdbfb0',
          333760: '618abef1f429e0bd6d25bbee254699fcd4d1353ed7e3270cc14e89429599ac98',
          333749: '14b2659bda8183e432971b6293698d994606f4a84c5bb73deb284e4b245878c5',
          333753: 'e01981be9fa35afe9c86c22ecc848c37e51ed4c4ca5f3181c139f275adbddffe',
          333755: 'a87e620664cb5a08e9d21f59e558ae6e72892c1bc1ce159cd6cc3b798ee5def9',
          333762: 'efb2860188d86a9a4c9aef0771d00afc38d3222246beca4a3cee41602e02437e',
          333767: '8c316bdbb369eb922a837820170ab88eb10879f919d8e4d8e3dad4e32bbd64f9',
          333770: '8931b273f70cd4a41858a26565502cfa1fb420e3eea9f97b82d3e7a8013626ac',
          333758: 'a039b02df72c8f235474b230d404196a9728995e9d6dc923b140a373c52695cd',
          333748: '446d45bd60b544c48f1bc20456807c62e5e729722563673f79d5c9056b4e2aa6',
          333752: '5ea9ceaabeb70b3c668307e8eb620f4aeb41d05ec10d5fb6158119188616d749',
          310235: 'b816bc29f85d9d915481c4f299e6dbffb866ced495f7e2baf3f280ab88fdf5a5',
          310247: 'fcf8987705f9bffd40936d88a98a6ecb1e5cf17d20da1bc4ca7d20ca02f786fe',
          310259: '82864147fd70ec393f4ff1751aa0857b3899fd70063ef8239569c177d984678f',
          310271: '9044e4a5c34c8b7b07d59a8a59aee452e3ae7aa71426ba110994d48433dfd9a1',
          310282: 'a5be7fa35be6700f7dd0436d8a9bec902295178a39f52cbd763e2e697b235a00',
          310294: '4a4e3cbf091e56114272c9372517cbe500a653944112ab2e7532b70eb917487f',
          310306: '98b9a01744007dc6ce7bb872a9132f6fa99a693d837ec705b510f23dfa14d04f',
          310318: 'b70b98fbb3e0c71b8d6dc7a389c4dcb28399913cf255cc324163f4e0083d50a7',
          310330: '0946f311951e7cbdf0a53b085208d006bedb3f4bd6fdaf7b91a6cff4e391f60f'}
# prefix -> (notes, seconds kept)
SETS = {'org': (ORGAN, 2.2), 'abass': (BASS, 2.4)}


def original(sid, raw):
    data = fetch(sid, raw)
    got = hashlib.sha256(data).hexdigest()
    if got != SHA256[sid]: raise RuntimeError(f'Freesound sound {sid}: sha256 {got}, pinned {SHA256[sid]}')
    return data


def fetch(sid, raw):
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
