import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location('fetch_jazz', Path(__file__).resolve().parents[1] / 'scripts' / 'fetch-jazz.py')
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)


class FluteNormalization(unittest.TestCase):
    def test_reference_does_not_follow_the_late_swell(self):
        x = np.full(3 * fetch.SR, .1)
        x[2 * fetch.SR:] = .15
        self.assertAlmostEqual(fetch.normalization_gain(x, 1.4), 5)
        self.assertAlmostEqual(fetch.normalization_gain(x), .5 / .15)

    def test_late_peak_stays_below_full_scale(self):
        x = np.full(3 * fetch.SR, .1)
        x[2 * fetch.SR:] = .3
        self.assertAlmostEqual(fetch.normalization_gain(x, 1.4) * x.max(), .98)

    def test_silent_reference_is_finite(self):
        self.assertEqual(fetch.normalization_gain(np.zeros(fetch.SR), 1.4), 1)

    def test_invalid_audio_and_reference(self):
        for x in [np.array([]), np.array([np.nan]), np.array([np.inf])]:
            with self.assertRaises(ValueError):
                fetch.normalization_gain(x, 1.4)
        for reference in [0, -1, np.nan, np.inf]:
            with self.assertRaises(ValueError):
                fetch.normalization_gain(np.ones(16), reference)


if __name__ == '__main__':
    unittest.main()
