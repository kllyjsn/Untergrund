#!/usr/bin/env python3
"""Fetch the S10 JGB TR-909 assets; requires ffmpeg.

python3 scripts/fetch-drum-machines.py [--raw /path/to/freesound/downloads]
Both inputs must match the pinned source hashes. No playback wiring is changed.
"""
import argparse
import hashlib
import io
import json
import pathlib
import struct
import subprocess
import sys
import urllib.request
import wave

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'scripts/drum-machine-samples.json'
SR = 44100


def source(row, raw):
    sound_id = row['freesound_id']
    try:
        if raw is not None:
            data = (raw / row['original_filename']).read_bytes()
        else:
            data = urllib.request.urlopen(row['mirror_url'], timeout=60).read()
    except (OSError, ValueError) as exc:
        raise ValueError(f'Freesound ID {sound_id}: cannot read source: {exc}') from exc
    actual = hashlib.sha256(data).hexdigest()
    if actual != row['source_sha256']:
        raise ValueError(f'Freesound ID {sound_id}: source SHA-256 mismatch; expected '
                         f'{row["source_sha256"]}, got {actual}. Original and mirror bytes must match.')
    return data


def process(data):
    with wave.open(io.BytesIO(data)) as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, SR, 'NONE'):
            raise ValueError('expected 44.1 kHz / 16-bit mono PCM WAV')
        frames = wav.getnframes()
        pcm = wav.readframes(frames)
    if not frames or len(pcm) != frames * 2:
        raise ValueError('empty or truncated WAV')
    samples = list(struct.unpack(f'<{frames}h', pcm))
    start = next((i for i, value in enumerate(samples) if value), None)
    if start is None:
        raise ValueError('silent WAV')
    samples = samples[start:]
    fade = min(221, len(samples)) if abs(samples[-1]) > 32 else 0
    if fade > 1:
        for i in range(fade):
            samples[len(samples) - fade + i] = round(samples[len(samples) - fade + i] * (fade - 1 - i) / (fade - 1))
    elif fade:
        raise ValueError('WAV too short for tail fade')
    processing = dict(leading_trim_frames=start, tail_fade_frames=fade,
                      gain_db=0, eq=False, pitch_change=False,
                      method='Trim exact leading zero samples only; linear 221-frame tail fade only if final magnitude exceeds 32 PCM units; no attack fade or tail truncation.')
    return struct.pack(f'<{len(samples)}h', *samples), processing


def encode(pcm, output):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR),
                    '-ac', '1', '-i', 'pipe:0', '-map_metadata', '-1', '-fflags', '+bitexact',
                    '-flags:a', '+bitexact', '-c:a', 'flac', '-sample_fmt', 's16',
                    '-compression_level', '8', '-frame_size', '4096', str(output)],
                   input=pcm, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=pathlib.Path, help='Freesound original WAV directory; no download fallback')
    args = parser.parse_args()
    rows = json.loads(MANIFEST.read_text())
    sources = [source(row, args.raw) for row in rows]
    for row, data in zip(rows, sources):
        try:
            pcm, processing = process(data)
        except (ValueError, wave.Error, EOFError) as exc:
            raise ValueError(f'Freesound ID {row["freesound_id"]}: {exc}') from exc
        output = ROOT / 'samples/live' / row['file']
        encode(pcm, output)
        result = output.read_bytes()
        row.update(processing=processing, sample_rate=SR, bits=16, channels=1,
                   frames=len(pcm) // 2, seconds=len(pcm) / (2 * SR),
                   bytes=len(result), sha256=hashlib.sha256(result).hexdigest())
        print(f'{row["file"]}: ID {row["freesound_id"]}, source SHA-256 OK, '
              f'{row["frames"]} frames, trim {processing["leading_trim_frames"]}, '
              f'fade {processing["tail_fade_frames"]}, gain 0 dB, {len(result)} bytes', flush=True)
    MANIFEST.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + '\n')
    print(f'TR-909 ASSETS VERIFIED: {len(rows)} files, {sum(row["bytes"] for row in rows)} bytes')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        sys.exit(str(exc))
