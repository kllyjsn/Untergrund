import contextlib
import copy
import email.message
import hashlib
import importlib.util
import io
import json
import pathlib
import struct
import tempfile
import unittest
import urllib.error
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fetch_analog', ROOT / 'scripts/fetch-analog.py')
analog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analog)


class AnalogFetchTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name)
        self.row = copy.deepcopy(json.loads(analog.MANIFEST.read_text())[0])

    def cache(self, data):
        path = self.root / self.row['source_file']
        path.parent.mkdir(parents=True)
        path.write_bytes(data)
        self.row['source_sha256'] = hashlib.sha256(data).hexdigest()
        return path

    def manifest(self, data):
        path = self.root / 'manifest.json'
        path.write_text(json.dumps(data))
        return path

    def test_manifest_inventory(self):
        rows = analog.load_manifest(analog.MANIFEST)
        self.assertEqual(len(rows), 58)
        self.assertEqual(len({r['sound_id'] for r in rows}), 58)
        self.assertEqual(len({r['pack_id'] for r in rows}), 6)

    def test_empty_manifest_rejected(self):
        with self.assertRaisesRegex(ValueError, 'non-empty'):
            analog.load_manifest(self.manifest([]))

    def test_duplicate_manifest_rejected(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            analog.load_manifest(self.manifest([self.row, self.row]))

    def test_unsafe_source_path_rejected(self):
        self.row['source_file'] = '../original.aif'
        with self.assertRaisesRegex(ValueError, 'source path'):
            analog.load_manifest(self.manifest([self.row]))

    def test_offline_cache_hit_never_downloads(self):
        expected = self.cache(b'original')
        downloader = mock.Mock()
        self.assertEqual(analog.original(self.row, self.root, True, downloader), expected)
        downloader.fetch.assert_not_called()

    def test_offline_missing_original_fails(self):
        downloader = mock.Mock()
        with self.assertRaisesRegex(RuntimeError, 'offline original missing'):
            analog.original(self.row, self.root, True, downloader)
        downloader.fetch.assert_not_called()

    def test_bad_cached_hash_is_not_redownloaded(self):
        path = self.cache(b'original')
        path.write_bytes(b'corrupt')
        downloader = mock.Mock()
        with self.assertRaisesRegex(ValueError, 'original SHA-256 mismatch'):
            analog.original(self.row, self.root, False, downloader)
        downloader.fetch.assert_not_called()

    def test_missing_token_fails_without_network(self):
        with mock.patch.dict(analog.os.environ, {}, clear=True), mock.patch.object(analog.urllib.request, 'urlopen') as opened:
            with self.assertRaisesRegex(RuntimeError, 'FREESOUND_ACCESS_TOKEN is required'):
                analog.original(self.row, self.root, False, analog.Downloader())
        opened.assert_not_called()

    def test_401_stops_without_refresh(self):
        error = urllib.error.HTTPError('https://freesound.org/', 401, 'unauthorized', email.message.Message(), None)
        with mock.patch.dict(analog.os.environ, {'FREESOUND_ACCESS_TOKEN': 'test-token'}), mock.patch.object(analog.urllib.request, 'urlopen', side_effect=error) as opened:
            with self.assertRaisesRegex(RuntimeError, '401; stopping without refreshing'):
                analog.original(self.row, self.root, False, analog.Downloader())
        self.assertEqual(opened.call_count, 1)
        self.assertEqual(opened.call_args.args[0].full_url, f"https://freesound.org/apiv2/sounds/{self.row['sound_id']}/download/")

    def test_429_backoff_bearer_header_and_verified_download(self):
        data = b'original'
        self.row['source_sha256'] = hashlib.sha256(data).hexdigest()
        headers = email.message.Message()
        headers['Retry-After'] = '61'
        error = urllib.error.HTTPError('https://freesound.org/', 429, 'rate limited', headers, None)
        with mock.patch.dict(analog.os.environ, {'FREESOUND_ACCESS_TOKEN': 'test-token'}), mock.patch.object(analog.urllib.request, 'urlopen', side_effect=[error, io.BytesIO(data)]) as opened, mock.patch.object(analog.time, 'sleep') as sleep, contextlib.redirect_stderr(io.StringIO()):
            path = analog.original(self.row, self.root, False, analog.Downloader())
        self.assertEqual(path.read_bytes(), data)
        self.assertEqual(opened.call_count, 2)
        self.assertIn(mock.call(61.0), sleep.call_args_list)
        request = opened.call_args.args[0]
        self.assertEqual(request.unredirected_hdrs['Authorization'], 'Bearer test-token')
        self.assertNotIn('Authorization', request.headers)

    def test_bad_download_hash_is_not_cached(self):
        with mock.patch.dict(analog.os.environ, {'FREESOUND_ACCESS_TOKEN': 'test-token'}), mock.patch.object(analog.urllib.request, 'urlopen', return_value=io.BytesIO(b'corrupt')):
            with self.assertRaisesRegex(ValueError, 'original SHA-256 mismatch'):
                analog.original(self.row, self.root, False, analog.Downloader())
        self.assertFalse((self.root / self.row['source_file']).exists())

    def test_output_mismatch_preserves_existing_flac(self):
        p = self.row['processing']
        p.update(window_start_frame=0, window_frames=4, fade_out_frames=2, window_peak_linear=.5,
                 normalization_gain_linear=10 ** (-1 / 20) / .5)
        output = self.root / self.row['file']
        output.write_bytes(b'keep existing output')

        def encode(command, **kwargs):
            pathlib.Path(command[-1]).write_bytes(b'wrong output')

        with mock.patch.object(analog.subprocess, 'check_output', return_value=struct.pack('<4f', 0, .5, .25, -.25)), mock.patch.object(analog.subprocess, 'run', side_effect=encode):
            with self.assertRaisesRegex(ValueError, 'output .* SHA-256 mismatch'):
                analog.reproduce(self.row, self.root / 'original.aif', self.root)
        self.assertEqual(output.read_bytes(), b'keep existing output')
        self.assertEqual(list(self.root.glob('*.flac')), [output])

    def test_verify_hashes_only(self):
        data = b'FLAC'
        (self.root / self.row['file']).write_bytes(data)
        self.row['sha256'] = hashlib.sha256(data).hexdigest()
        with mock.patch.object(analog.subprocess, 'check_output', side_effect=AssertionError('must not decode')), mock.patch.object(analog.urllib.request, 'urlopen', side_effect=AssertionError('must not download')), contextlib.redirect_stdout(io.StringIO()) as output:
            analog.verify([self.row], self.root)
        self.assertIn('ANALOG FLAC HASHES VERIFIED 1 4 bytes', output.getvalue())

    def test_verify_rejects_hash_mismatch(self):
        (self.root / self.row['file']).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'committed FLAC SHA-256 mismatch'):
            analog.verify([self.row], self.root)


if __name__ == '__main__':
    unittest.main()
