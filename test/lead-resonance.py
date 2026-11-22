"""Screen 48 kHz stereo lead stems; requires NumPy, SciPy and FFmpeg."""

import argparse
import subprocess

import numpy as np
from scipy import ndimage, signal

RATE = 48000
FFT_SIZE = 16384
NEIGHBORS = 81
LIMIT_DB = 10


def peaks(audio, low=2000, high=6000):
    bins, psd = signal.welch(
        audio, RATE, window='hann', nperseg=FFT_SIZE, noverlap=FFT_SIZE // 2, axis=0,
    )
    # Average power rather than audio, so opposite-phase resonances still count.
    power = psd.mean(axis=1)
    level = 10 * np.log10(np.maximum(power, 1e-30))
    prominence = level - ndimage.median_filter(level, size=NEIGHBORS, mode='nearest')
    maxima, _ = signal.find_peaks(power)
    return sorted(
        ((bins[i], prominence[i], level[i]) for i in maxima if low <= bins[i] <= high),
        key=lambda peak: -peak[1],
    )


def load(path):
    pcm = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(RATE), '-',
    ])
    return np.frombuffer(pcm, '<f4').reshape(-1, 2).astype(float)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pair', action='store_true', help='screen A and B separately (one-second gap)')
    parser.add_argument('--band', nargs=2, type=float, default=(2000, 6000), metavar=('LOW', 'HIGH'))
    parser.add_argument('stem', nargs='+')
    args = parser.parse_args()
    low, high = args.band
    if not 0 <= low < high <= RATE / 2:
        parser.error('band must be ordered and within 0–24000 Hz')
    failed = False
    for path in args.stem:
        audio = load(path)
        clips = [(path, audio)]
        if args.pair:
            if len(audio) < RATE or (len(audio) - RATE) % 2:
                parser.error(f'{path}: expected equal-length halves with a one-second gap')
            half = (len(audio) - RATE) // 2
            if np.any(audio[half:half + RATE]):
                parser.error(f'{path}: the one-second gap is not silent')
            clips = [(f'{path} [A]', audio[:half]), (f'{path} [B]', audio[half + RATE:])]
        for label, clip in clips:
            if len(clip) < FFT_SIZE or not np.isfinite(clip).all() or not np.any(clip):
                parser.error(f'{label}: expected finite, non-silent audio of at least {FFT_SIZE} frames')
            measured = peaks(clip, low, high)
            hits = [peak for peak in measured if peak[1] >= LIMIT_DB]
            failed |= bool(hits)
            print(f'{label}: {"FAIL" if hits else "PASS"} ({len(hits)} peaks at or above {LIMIT_DB} dB)')
            for hz, prominence, level in hits or measured[:1]:
                print(f'  {hz:.1f} Hz: {prominence:+.2f} dB above median ({level:.1f} dBFS/Hz)')
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
