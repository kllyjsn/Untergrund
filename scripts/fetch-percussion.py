#!/usr/bin/env python3
"""Fetch the recorded marimba and hand percussion (AMAPIANO, AFROBEATS, REGGAETON, BAILE FUNK) into samples/live/.

Sources (see samples/live/LICENSE.md), each original pinned by commit or Freesound sound ID plus the SHA-256 of its bytes:
  sgossner/VSCO-2-CE @ 440300901dfe9275fd84e0b7763af1f8443ae62e (marimba, shaker, conga; CC0 1.0)
  sfzinstruments/karoryfer.swirly-drums @ c40dafe0011cb2e54c0c220ff0fa308a11fc60f5 (cowbell; CC0 1.0)
  Freesound pack 5890 "Metal Timbales" by Suicidity (timbales; CC0 1.0)
  Freesound 21715 "cuica (1).wav" by reinsamba (cuica; CC BY 4.0, credited in LICENSE.md)
Processing: mono, 44.1 kHz, 2nd-order Butterworth high-pass, trimmed 2 ms before the attack, 1 ms fade in, linear fade
out, peak -6 dBFS, 16-bit FLAC. The cuica strokes are fixed windows cut from one performance (see CUICA).

Freesound originals need a logged-in OAuth2 download: set FREESOUND_TOKEN to an access token, or pass
--sources DIR holding fs<ID>.wav files. Every original is checked against its SHA-256 before it is used.
Usage: python3 scripts/fetch-percussion.py [--sources DIR] [--check]
  --check writes to a temporary folder and compares each file byte for byte with samples/live/ instead of overwriting it.
Requires ffmpeg (4.4, the encoder of the committed files), numpy and scipy.
"""
import argparse, hashlib, os, subprocess, sys, tempfile, urllib.parse, urllib.request
import numpy as np
from scipy.signal import butter, sosfilt

VSCO = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/440300901dfe9275fd84e0b7763af1f8443ae62e/'
SWIRLY = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.swirly-drums/c40dafe0011cb2e54c0c220ff0fa308a11fc60f5/'
FREESOUND = 'https://freesound.org/apiv2/sounds/{id}/download/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'samples', 'live')
SR = 44100

# output name -> (source: URL or Freesound ID, source SHA-256, seconds kept, fade-out seconds, high-pass Hz)
HITS = {
    'marimba_48': (VSCO + 'Percussion/Marimba/Marimba_hit_Outrigger_C2_loud_01.wav', 'bfad3b0e57d04c31e6079aba11fb0a6c5c84627fd4bc46e4e0923663586c460c', 1.1, .08, 38),
    'marimba_55': (VSCO + 'Percussion/Marimba/Marimba_hit_Outrigger_G2_loud_01.wav', '3bd173f56481e537c3489a94d1e4dd59c304f9f98679c7c90890fc9f5795c25d', 1.1, .08, 38),
    'marimba_59': (VSCO + 'Percussion/Marimba/Marimba_hit_Outrigger_B2_loud_01.wav', 'a329138008daae1c03652822d7079c0e1e9941071b8c22195e1985f0c685fdeb', 1.1, .08, 38),
    'marimba_65': (VSCO + 'Percussion/Marimba/Marimba_hit_Outrigger_F3_loud_01.wav', '379e749add43b12959fae06cc272f1871899cc05460faf41ead77b93e5d01843', 1.1, .08, 38),
    'marimba_72': (VSCO + 'Percussion/Marimba/Marimba_hit_Outrigger_C4_loud_01.wav', '4af539d47a452d7fad26e171b1c8adcca272cee97191f040d192680462c880b8', 1.1, .08, 38),
    'marimba_79': (VSCO + 'Percussion/Marimba/Marimba_hit_Outrigger_G4_loud_01.wav', '36f39f9f24789001add2b4c440defb7641178b0e8449c5cb7f1960bccaf0aaaf', 1.1, .08, 38),
    'marimba_83': (VSCO + 'Percussion/Marimba/Marimba_hit_Outrigger_B4_loud_01.wav', 'd04aed26222822d14435fa61b88cdcce95606a5e94bb5e7167d266875343a39c', 1.1, .08, 38),
    'shaker_1': (VSCO + "VSCO 1 Percussion/varWood/Camo's Shaker/shake1.wav", '025ee4e9e80349cf1d593b02c39e14f17f643fd7f078da49e9b33989c53c0878', .22, .045, 520),
    'shaker_2': (VSCO + "VSCO 1 Percussion/varWood/Camo's Shaker/shake2.wav", 'cf6d10905a343c3c5229e0f82a8a3312af7636bb271b792d5ae272b248719af4', .22, .045, 520),
    'shaker_4': (VSCO + "VSCO 1 Percussion/varWood/Camo's Shaker/shake4.wav", 'aeb6f7647dd967ccb04402c293db1381e1e04bfe9b76e4a43d4f1484e505d927', .22, .045, 520),
    'shaker_7': (VSCO + "VSCO 1 Percussion/varWood/Camo's Shaker/shake7.wav", '316b248bf66c10cceeb32d90d11e38702b68b11758a7e5660a32434697981e33', .22, .045, 520),
    'conga_tap_1': (VSCO + 'Percussion/Conga-Tap1_v1_rr1_Sum.wav', '2be9975136b25de9280cb4bef273ff4234d3f61068912f795e3b58b05384d3b9', .25, .055, 135),
    'conga_tap_2': (VSCO + 'Percussion/Conga-Tap1_v1_rr2_Sum.wav', 'e5252adde5a145459b5dfad24bd0d55221c115c2b88f23a8e4fd8d04b434a47d', .25, .055, 135),
    'conga_open_1': (VSCO + 'Percussion/Conga-HitN_v2_rr1_Sum.wav', '13d322c0e7a830cdbcbdc5a6e05566dfe3f5a073b7b82a3262d3f6fc10f96764', .40, .055, 135),
    'conga_open_2': (VSCO + 'Percussion/Conga-HitN_v2_rr2_Sum.wav', '4f52f6619fd12d1d0e1e942e67cdf77fcad06fef6de44eba8bab6df99ade4acd', .40, .055, 135),
    'cowbell_1': (SWIRLY + 'Samples/cowbell/cowbell_vl3_rr1.wav', '69a2a9c212807d354a56647fe7098e4768f63573022a70c2778a5d24ea5e114c', .34, .07, 220),
    'cowbell_2': (SWIRLY + 'Samples/cowbell/cowbell_vl3_rr2.wav', 'd3cf4b168ec9ca2b2fbb79b8c4336ea2bdeae3d1fa892fe0321f534ca163d9c2', .34, .07, 220),
    'timbale_closed_1': (90524, '9ab4b09bf76caebf0584a92a6ea706dfa4db46bb5c42aa15022a9fe9cfd400a2', .34, .065, 225),
    'timbale_closed_2': (90529, '084063bebfe7559024dda4502f9d68e4fa650460b125f3906c627e8a51cb38c8', .34, .065, 225),
    'timbale_low_1': (90471, '5048c42392c72f1d44cc194f335d5c137bb1c0f5634ed1adaed7d6f3d8ff4c3b', .34, .065, 225),
    'timbale_low_2': (90474, 'a2f5f93b790a76dd6a198af45bab0b45ee5a1ce7a80b982503ac6dde4946f94b', .34, .065, 225),
    'timbale_high_1': (90506, '629b1df222b648765aaa2f49859a9ae3217349d21635e058073668cb818d0aca', .34, .065, 225),
    'timbale_high_2': (90509, 'eed660738744cec07784c29eaea264e4ca692c330f94a23dfb9f803ca04250fd', .34, .065, 225),
}
# Two single strokes cut from reinsamba's acoustic performance: (start s, end s) windows of the source.
CUICA = (21715, '2aca632b38d903f9430bb1cdb09a1bf5b1facc22f56168aaed76ec039100e6af', 230, ((.55, .77), (1.415, 1.615)))


def original(src, sha, sources):
    if isinstance(src, int):
        local = os.path.join(sources, f'fs{src}.wav') if sources else None
        if local and os.path.exists(local):
            data = open(local, 'rb').read()
        elif os.environ.get('FREESOUND_TOKEN'):
            req = urllib.request.Request(FREESOUND.format(id=src), headers={'Authorization': 'Bearer ' + os.environ['FREESOUND_TOKEN']})
            data = urllib.request.urlopen(req, timeout=60).read()
        else:
            sys.exit(f'Freesound {src}: set FREESOUND_TOKEN (OAuth2 access token) or pass --sources with fs{src}.wav')
    else:
        data = urllib.request.urlopen(urllib.parse.quote(src, safe=':/'), timeout=60).read()
    got = hashlib.sha256(data).hexdigest()
    if got != sha:
        sys.exit(f'{src}: sha256 {got} does not match the pinned {sha}')
    return data


def decode(data):
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', str(SR), '-f', 'f32le', 'pipe:1'],
                         input=data, capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype='<f4')


def highpass(x, hz):
    return sosfilt(butter(2, hz, 'highpass', fs=SR, output='sos'), x)


def hit(x, secs, fade, hz):
    x = highpass(x, hz)
    attack = np.flatnonzero(abs(x) > max(abs(x)) * .012)[0]
    x = x[max(0, attack - round(.002 * SR)):][:round(SR * secs)].copy()
    x[:44] *= np.linspace(0, 1, 44)
    n = round(fade * SR)
    x[-n:] *= np.linspace(1, 0, n)
    return x * (.5 / max(abs(x)))


def stroke(x, hz):
    x = highpass(x, hz)
    x[:132] *= np.linspace(0, 1, 132)
    x[-2205:] *= np.linspace(1, 0, 2205)
    return x * (.5 / max(abs(x)))


def write(path, x):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-', '-map_metadata', '-1',
                    '-c:a', 'flac', '-compression_level', '12', path], input=np.rint(x * 32767).astype('<i2').tobytes(), check=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--sources', help='folder with Freesound originals named fs<ID>.wav')
    ap.add_argument('--check', action='store_true', help='compare with samples/live/ instead of writing there')
    args = ap.parse_args()
    out = tempfile.mkdtemp() if args.check else OUT
    names = []
    for name, (src, sha, secs, fade, hz) in HITS.items():
        write(os.path.join(out, name + '.flac'), hit(decode(original(src, sha, args.sources)), secs, fade, hz)); names.append(name)
    src, sha, hz, windows = CUICA
    raw = decode(original(src, sha, args.sources))
    for i, (a, b) in enumerate(windows, 1):
        write(os.path.join(out, f'cuica_{i}.flac'), stroke(raw[round(a * SR):round(b * SR)], hz)); names.append(f'cuica_{i}')
    bad = 0
    for name in names:
        made = open(os.path.join(out, name + '.flac'), 'rb').read()
        if args.check:
            same = made == open(os.path.join(OUT, name + '.flac'), 'rb').read()
            bad += not same
            print(name, 'identical' if same else 'DIFFERS')
        else:
            print(name, hashlib.sha256(made).hexdigest())
    if bad:
        sys.exit(f'{bad} of {len(names)} files differ from samples/live/')
