#!/usr/bin/env python3
"""Importer safety tests; no network or original recordings required."""
import contextlib
import importlib.util
import io
import json
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from scipy.signal import lfilter

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('vocals', ROOT / 'scripts/fetch-vocals.py')
vocals = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vocals)


class Vocals(unittest.TestCase):
    def test_runtime_sustains_keep_pitch_and_quiet_wraps(self):
        with tempfile.TemporaryDirectory() as directory:
            subprocess.check_call(['node', 'test/vowel-loop.mjs', directory], cwd=ROOT)
            eq = json.loads((Path(directory) / 'hook-eq.json').read_text())['deephouse']
            for vowel in ['ahh', 'eh', 'ooh']:
                pcm = np.fromfile(Path(directory) / f'vowel-sustain-{vowel}.f32', dtype='<f4')
                self.assertLess(abs(vocals.pitch(pcm, 53)['cents']), 5, vowel)
                loop = pcm[:len(pcm) // 10]
                steps = []
                for midi in range(48, 60):
                    rate = 2 ** ((midi - 53) / 12)
                    positions = np.arange(96000) * rate * vocals.SR / 48000 % len(loop)
                    x = np.interp(positions, np.arange(len(loop) + 1), np.r_[loop, loop[0]])
                    for hz, q, db in eq:
                        a = 10 ** (db / 40)
                        w = 2 * np.pi * hz / 48000
                        alpha = np.sin(w) / (2 * q)
                        b = [1 + alpha * a, -2 * np.cos(w), 1 - alpha * a]
                        den = [1 + alpha / a, -2 * np.cos(w), 1 - alpha / a]
                        x = lfilter(np.array(b) / den[0], np.array(den) / den[0], x)
                    w = 2 * np.pi * 5000 / 48000
                    alpha = np.sin(w)
                    b = [(1 - np.cos(w)) / 2, 1 - np.cos(w), (1 - np.cos(w)) / 2]
                    den = [1 + alpha, -2 * np.cos(w), 1 - alpha]
                    x = lfilter(np.array(b) / den[0], np.array(den) / den[0], x)
                    boundary = round(4 * len(loop) / (vocals.SR * rate) * 48000)
                    step = 10 * np.log10(np.mean(x[boundary:boundary + 1200] ** 2) / np.mean(x[boundary - 1200:boundary] ** 2))
                    self.assertLess(abs(step), 1, f'{vowel}/{midi} after hook EQ')
                    steps.append(abs(step))
                print(f'{vowel}: post-hook-EQ wrap max {max(steps):.3f} dB across MIDI 48–59')

    def test_pitch_and_octave_evidence(self):
        t = np.arange(round(.5 * vocals.SR)) / vocals.SR
        f0 = 440 * 2 ** ((53 - 69) / 12) * 2 ** (23 / 1200)
        x = sum(np.sin(2 * np.pi * f0 * h * t) / h for h in [1, 2, 3, 4])
        pitch = vocals.pitch(x, 53)
        self.assertAlmostEqual(pitch['cents'], 23, delta=.02)
        self.assertGreater(pitch['fundamental_over_suboctave_db'], 60)
        self.assertLess(vocals.stability(x, 53)['range_cents'], .01)

    def test_missing_token_is_actionable(self):
        with patch.dict(os.environ, {}, clear=True), patch('sys.argv', ['fetch-vocals.py', '--report', 'unused.json']), contextlib.redirect_stderr(io.StringIO()) as error:
            with self.assertRaises(SystemExit):
                vocals.main()
            self.assertIn('use --from DIR or set FREESOUND_TOKEN', error.getvalue())

    def test_hash_mismatch_aborts_before_processing_or_writing(self):
        manifest = json.loads((ROOT / 'scripts/vocal-samples.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            (directory / manifest[0]['local_filename']).write_bytes(b'not the original')
            report, output = directory / 'report.json', directory / 'outputs'
            with patch('sys.argv', ['fetch-vocals.py', '--from', str(directory), '--report', str(report), '--output-dir', str(output)]), patch.object(vocals, 'decode') as decode:
                with self.assertRaisesRegex(ValueError, 'original sha256 mismatch for Freesound 763909'):
                    vocals.main()
                decode.assert_not_called()
            self.assertFalse(report.exists())
            self.assertFalse(output.exists())

    def test_api_uses_original_download_and_bearer(self):
        with tempfile.TemporaryDirectory() as directory:
            report = str(Path(directory) / 'report.json')
            with patch.dict(os.environ, {'FREESOUND_TOKEN': 'test-access-token'}), patch('sys.argv', ['fetch-vocals.py', '--report', report]), patch.object(vocals.urllib.request, 'urlopen') as urlopen:
                urlopen.return_value.__enter__.return_value.read.return_value = b'not the original'
                with self.assertRaisesRegex(ValueError, 'original sha256 mismatch'):
                    vocals.main()
                request = urlopen.call_args.args[0]
                self.assertEqual(request.full_url, 'https://freesound.org/apiv2/sounds/763909/download/')
                self.assertEqual(request.get_header('Authorization'), 'Bearer test-access-token')
                self.assertFalse(Path(report).exists())


if __name__ == '__main__':
    unittest.main()
