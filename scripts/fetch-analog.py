#!/usr/bin/env python3
"""Reproduce the CC0 analog recordings (numpy and ffmpeg required).

python3 scripts/fetch-analog.py --source-dir ~/s2-raw --offline --output-dir ~/analog-reproduced
python3 scripts/fetch-analog.py --verify

Missing originals require FREESOUND_ACCESS_TOKEN. Tokens are never refreshed.
The manifest pins the encoder/numpy versions used for byte-identical FLACs.
--verify needs only Python's standard library and the committed FLACs.
"""
import argparse
import email.utils
import hashlib
import json
import math
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'scripts/analog-samples.json'
DEST = ROOT / 'samples/live'
PREFIXES = 'juno|jpad|dpad|jxstr|jxbr|jbr'


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def expect_hash(path, expected, label):
    actual = sha256(path)
    if actual != expected:
        raise ValueError(f'{label} SHA-256 mismatch: {path.name}: expected {expected}, got {actual}')
    return actual


def load_manifest(path):
    rows = json.loads(path.read_text())
    if not isinstance(rows, list) or not rows:
        raise ValueError('manifest must be a non-empty array')
    seen = set()
    for row in rows:
        name = row['file']
        if not re.fullmatch(rf'({PREFIXES})_\d+\.flac', name) or name in seen:
            raise ValueError(f'invalid or duplicate output filename: {name}')
        seen.add(name)
        prefix = name.split('_')[0]
        if name != f"{prefix}_{row['midi']}.flac" or row['source_file'] != f"{prefix}/{int(row['sound_id'])}.aif":
            raise ValueError(f'invalid source path or MIDI center: {name}')
        for key in ['source_sha256', 'sha256', 'pcm_s16le_sha256']:
            if not re.fullmatch('[0-9a-f]{64}', row[key]):
                raise ValueError(f'invalid {key}: {name}')
        if row['uploader'] != 'modularsamples' or row['license'] not in [
            'http://creativecommons.org/publicdomain/zero/1.0/',
            'https://creativecommons.org/publicdomain/zero/1.0/'
        ]:
            raise ValueError(f'unexpected attribution/license: {name}')
        p = row['processing']
        supported = dict(decode_sample_format='f32le', working_dtype='float32', channel_policy='preserve',
                         fade_in_frames=0, fade_curve='linear-inclusive-1-to-0', output_codec='flac', output_sample_format='s16')
        if any(p[key] != value for key, value in supported.items()):
            raise ValueError(f'unsupported processing: {name}')
        if any(type(p[key]) is not int for key in ['window_start_frame', 'window_frames', 'fade_out_frames']):
            raise ValueError(f'non-integer frame count: {name}')
        if p['sample_rate'] != 44100 or p['channels'] != row['source_channels'] or p['channels'] not in [1, 2]:
            raise ValueError(f'unsupported rate/channels: {name}')
        if not 0 <= p['window_start_frame'] < row['source_frames'] or not 1 <= p['fade_out_frames'] <= p['window_frames']:
            raise ValueError(f'invalid trim/fade window: {name}')
        if p['window_start_frame'] + p['window_frames'] > row['source_frames'] or p['pitch_shift_cents'] != 0:
            raise ValueError(f'invalid window or pitch processing: {name}')
    return rows


class Downloader:
    def __init__(self):
        self.last_request = None

    def fetch(self, row, path):
        token = os.environ.get('FREESOUND_ACCESS_TOKEN')
        if not token:
            raise RuntimeError('FREESOUND_ACCESS_TOKEN is required for missing originals; use --offline for a local cache')
        url = f"https://freesound.org/apiv2/sounds/{int(row['sound_id'])}/download/"
        for attempt in range(6):
            if self.last_request is not None:
                time.sleep(max(0, self.last_request + 5 - time.monotonic()))
            request = urllib.request.Request(url, headers={'User-Agent': 'Untergrund analog sample reproduction'})
            request.add_unredirected_header('Authorization', f'Bearer {token}')
            self.last_request = time.monotonic()
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    data = response.read()
                break
            except urllib.error.HTTPError as error:
                code = error.code
                retry = error.headers.get('Retry-After', '')
                error.close()
                if code == 401:
                    raise RuntimeError('Freesound returned 401; stopping without refreshing the access token') from None
                if code != 429 or attempt == 5:
                    raise RuntimeError(f'Freesound download failed: HTTP {code}') from None
                try:
                    seconds = float(retry)
                except ValueError:
                    try:
                        seconds = email.utils.parsedate_to_datetime(retry).timestamp() - time.time()
                    except (TypeError, ValueError, OverflowError):
                        seconds = 0
                delay = max(30 * 2 ** attempt, seconds if math.isfinite(seconds) else 0)
                print(f"Freesound 429 for {row['sound_id']}; retrying in {delay:.0f}s", file=sys.stderr)
                time.sleep(delay)
        if hashlib.sha256(data).hexdigest() != row['source_sha256']:
            raise ValueError(f"original SHA-256 mismatch: sound {row['sound_id']}")
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
            temporary = pathlib.Path(handle.name)
            try:
                handle.write(data)
                handle.close()
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)


def original(row, source_dir, offline, downloader):
    path = source_dir / row['source_file']
    if not path.exists():
        if offline:
            raise RuntimeError(f'offline original missing: {path}')
        downloader.fetch(row, path)
    expect_hash(path, row['source_sha256'], 'original')
    return path


def reproduce(row, source, output_dir):
    import numpy as np

    p = row['processing']
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(source), '-f', 'f32le', '-ar', str(p['sample_rate']), '-'])
    x = np.frombuffer(raw, dtype='<f4').reshape(-1, p['channels'])
    start = p['window_start_frame']
    x = x[start:start + p['window_frames']].copy()
    if len(x) != p['window_frames']:
        raise ValueError(f"short source window: {row['file']}")
    peak = float(np.max(abs(x)))
    if not peak > 0 or peak != p['window_peak_linear']:
        raise ValueError(f"normalization peak mismatch: {row['file']}")
    gain = 10 ** (p['normalize_peak_dbfs'] / 20) / peak
    if gain != p['normalization_gain_linear']:
        raise ValueError(f"normalization gain mismatch: {row['file']}")
    x *= gain
    fade = p['fade_out_frames']
    x[-fade:] *= np.linspace(1, 0, fade)[:, None]
    output = output_dir / row['file']
    with tempfile.NamedTemporaryFile(dir=output_dir, suffix='.flac', delete=False) as handle:
        temporary = pathlib.Path(handle.name)
    try:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(p['sample_rate']), '-ac', str(p['channels']),
                        '-i', 'pipe:0', '-c:a', 'flac', '-sample_fmt', 's16', '-compression_level', str(p['compression_level']), str(temporary)],
                       input=x.astype('<f4').tobytes(), check=True)
        expect_hash(temporary, row['sha256'], f"output {row['file']}")
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return dict(file=row['file'], source_sha256=row['source_sha256'], sha256=row['sha256'], bytes=output.stat().st_size)


def verify(rows, output_dir):
    for row in rows:
        expect_hash(output_dir / row['file'], row['sha256'], 'committed FLAC')
    total = sum((output_dir / row['file']).stat().st_size for row in rows)
    print('ANALOG FLAC HASHES VERIFIED', len(rows), total, 'bytes')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=pathlib.Path, default=pathlib.Path.home() / 's2-raw')
    parser.add_argument('--output-dir', type=pathlib.Path, default=DEST)
    parser.add_argument('--manifest', type=pathlib.Path, default=MANIFEST)
    parser.add_argument('--report', type=pathlib.Path)
    parser.add_argument('--offline', action='store_true', help='fail rather than download any missing original')
    parser.add_argument('--verify', action='store_true', help='only hash the committed FLACs; no decoding/downloads')
    args = parser.parse_args()
    try:
        rows = load_manifest(args.manifest)
        if args.verify:
            verify(rows, args.output_dir)
            return 0
        args.output_dir.mkdir(parents=True, exist_ok=True)
        downloader = Downloader()
        report = []
        for row in rows:
            source = original(row, args.source_dir, args.offline, downloader)
            result = reproduce(row, source, args.output_dir)
            report.append(result)
            if args.report:
                args.report.write_text(json.dumps(report, indent=2) + '\n')
            print(row['file'], 'original + output SHA-256 verified', flush=True)
        print('ANALOG ASSETS REPRODUCED', len(report), sum(r['bytes'] for r in report), 'bytes (byte-identical FLAC SHA-256)')
        return 0
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, ImportError, subprocess.CalledProcessError) as error:
        print(f'fetch-analog: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
