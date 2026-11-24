"""Focused processing and shipped-asset checks: python3 test/rhodes-preparation.py."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('rhodes', ROOT / 'scripts/fetch-rhodes.py')
rhodes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rhodes)


class Preparation(unittest.TestCase):
    def test_synthetic_pitch_trim_and_processing(self):
        sr = rhodes.SR
        t = np.arange(11 * sr) / sr
        x = .8 * np.sin(2 * np.pi * 440 * t) * np.exp(-t / 3)
        trimmed = rhodes.trim(np.r_[np.zeros(sr), x])
        self.assertLess(np.flatnonzero(abs(trimmed) > .003 * max(abs(trimmed)))[0], 89)
        self.assertLess(abs(rhodes.measure(trimmed, 69)), .2)
        y = rhodes.process(trimmed)
        self.assertEqual(len(y), 9 * sr)
        self.assertAlmostEqual(max(abs(y)), .5)
        self.assertEqual(y[0], 0)
        self.assertLess(abs(y[-1]), 1e-10)

    def test_empty_silent_and_short(self):
        for x in (np.array([]), np.zeros(rhodes.SR)):
            with self.assertRaises(ValueError):
                rhodes.trim(x)
            with self.assertRaises(ValueError):
                rhodes.process(x)
        with self.assertRaises(ValueError):
            rhodes.measure(np.ones(100), 60)

    def test_bad_inputs_fail_before_output(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(sys, 'argv', ['fetch-rhodes.py', '--originals', directory]):
                with self.assertRaises(FileNotFoundError):
                    rhodes.main()
                (Path(directory) / '61821.aif').write_bytes(b'corrupt')
                with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
                    rhodes.main()

    def test_shipped_assets(self):
        report = json.loads((ROOT / 'samples/rhodes-analysis.json').read_text())
        self.assertEqual(len(report['sounds']), 53)
        self.assertEqual(len(report['tune']), len(rhodes.SELECTED))
        total = 0
        for midi in rhodes.SELECTED:
            path = ROOT / 'samples/live' / f'rhodes_{midi}.flac'
            probe = json.loads(subprocess.check_output([
                'ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(path)]))['streams'][0]
            self.assertEqual((probe['codec_name'], probe['sample_rate'], probe['channels'],
                              probe['bits_per_raw_sample']), ('flac', '44100', 1, '16'))
            x = rhodes.decode(path)
            self.assertLessEqual(len(x), 9 * rhodes.SR)
            self.assertAlmostEqual(max(abs(x)), .5, delta=1 / 32768)
            self.assertLessEqual(np.flatnonzero(abs(x) > max(abs(x)) * .003)[0] / rhodes.SR, .002)
            self.assertLess(abs(x[-1]), 1 / 32768)
            self.assertAlmostEqual(rhodes.measure(x, midi), report['tune'][str(midi)], delta=.1)
            total += path.stat().st_size
        self.assertEqual(total, report['total_bytes'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
