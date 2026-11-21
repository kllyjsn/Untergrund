import hashlib
import importlib.util
import io
import pathlib
import struct
import tempfile
import unittest
import wave
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('drums', pathlib.Path(__file__).resolve().parents[1] / 'scripts/fetch-drum-machines.py')
drums = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drums)


def wav(samples, rate=44100):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as out:
        out.setparams((1, 2, rate, len(samples), 'NONE', 'not compressed'))
        out.writeframes(struct.pack(f'<{len(samples)}h', *samples))
    return buffer.getvalue()


class DrumMachines(unittest.TestCase):
    def test_preserves_attack_and_quiet_tail(self):
        pcm, processing = drums.process(wav([0, 0, 1, 20000, -100, 0]))
        self.assertEqual(struct.unpack('<4h', pcm), (1, 20000, -100, 0))
        self.assertEqual(processing['leading_trim_frames'], 2)
        self.assertEqual(processing['tail_fade_frames'], 0)
        self.assertEqual(processing['gain_db'], 0)

    def test_fades_only_tail_when_needed(self):
        samples = [20000] + [100] * 999
        pcm, processing = drums.process(wav(samples))
        result = struct.unpack('<1000h', pcm)
        self.assertEqual(result[:-221], tuple(samples[:-221]))
        self.assertEqual(result[-1], 0)
        self.assertEqual(processing['tail_fade_frames'], 221)

    def test_empty_silent_and_wrong_rate(self):
        for data, message in [(wav([]), 'empty'), (wav([0, 0]), 'silent'), (wav([1], 48000), '44.1 kHz')]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                drums.process(data)

    def test_raw_and_mirror_hash_checks(self):
        data = wav([0, 20000, 0])
        row = dict(freesound_id=26486, original_filename='26486__altemark__bd01.wav',
                   mirror_url='https://example.invalid/pinned.wav', source_sha256=hashlib.sha256(data).hexdigest())
        with tempfile.TemporaryDirectory() as directory:
            raw = pathlib.Path(directory)
            with self.assertRaisesRegex(ValueError, 'ID 26486: cannot read source'):
                drums.source(row, raw)
            (raw / row['original_filename']).write_bytes(data)
            self.assertEqual(drums.source(row, raw), data)
            with patch.object(drums.urllib.request, 'urlopen', return_value=io.BytesIO(data)):
                self.assertEqual(drums.source(row, None), data)
            (raw / row['original_filename']).write_bytes(b'')
            with self.assertRaisesRegex(ValueError, 'ID 26486: source SHA-256 mismatch'):
                drums.source(row, raw)
            with patch.object(drums.urllib.request, 'urlopen', return_value=io.BytesIO(b'corrupt')):
                with self.assertRaisesRegex(ValueError, 'ID 26486: source SHA-256 mismatch'):
                    drums.source(row, None)


if __name__ == '__main__':
    unittest.main()
