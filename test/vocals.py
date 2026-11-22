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

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('vocals', ROOT / 'scripts/fetch-vocals.py')
vocals = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vocals)


class Vocals(unittest.TestCase):
    def test_runtime_sustains_keep_pitch_and_quiet_wraps(self):
        with tempfile.TemporaryDirectory() as directory:
            subprocess.check_call(['node', 'test/vowel-loop.mjs', directory], cwd=ROOT)
            for vowel in ['ahh', 'eh', 'ooh']:
                pcm = np.fromfile(Path(directory) / f'vowel-sustain-{vowel}.f32', dtype='<f4')
                self.assertLess(abs(vocals.pitch(pcm, 53)['cents']), 5, vowel)

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
