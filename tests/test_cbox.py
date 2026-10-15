import copy
import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('cbox', Path(__file__).parents[1] / 'scripts/cbox.py')
cbox = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cbox)
PASSWORD = 'test-only-passphrase-not-a-secret'


class CBoxTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.manifest = cbox.demo(self.root / 'demo')
        self.media = self.root / 'demo/media'

    def test_roundtrip_after_media_relocation(self):
        payload = cbox.seal(self.manifest, self.media, PASSWORD)
        relocated = self.root / 'relocated'
        shutil.copytree(self.media, relocated)
        shutil.rmtree(self.media)
        self.assertEqual(cbox.open_box(payload, relocated, PASSWORD), self.manifest)
        self.assertNotIn(b'sound.description', payload)

    def test_randomized_encryption(self):
        self.assertNotEqual(cbox.seal(self.manifest, self.media, PASSWORD),
                            cbox.seal(self.manifest, self.media, PASSWORD))

    def test_wrong_password_and_tampering_rejected(self):
        payload = cbox.seal(self.manifest, self.media, PASSWORD)
        with self.assertRaisesRegex(ValueError, 'authentication failed'):
            cbox.open_box(payload, self.media, PASSWORD + 'wrong')
        for offset in (8, 24, 40, len(payload) - 1):
            changed = bytearray(payload)
            changed[offset] ^= 1
            with self.subTest(offset=offset), self.assertRaisesRegex(ValueError, 'authentication failed'):
                cbox.open_box(bytes(changed), self.media, PASSWORD)

    def test_media_tampering_and_missing_media_rejected(self):
        payload = cbox.seal(self.manifest, self.media, PASSWORD)
        audio = self.media / 'tone.wav'
        data = bytearray(audio.read_bytes()); data[-1] ^= 1
        audio.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
            cbox.open_box(payload, self.media, PASSWORD)
        audio.unlink()
        with self.assertRaisesRegex(ValueError, 'missing media'):
            cbox.open_box(payload, self.media, PASSWORD)

    def test_traversal_and_symlinks_rejected(self):
        for path in ('../tone.wav', '/tmp/tone.wav', 'a/../tone.wav', 'a\\tone.wav', 'C:/tone.wav', './tone.wav'):
            changed = copy.deepcopy(self.manifest); changed['assets'][0]['path'] = path
            with self.subTest(path=path), self.assertRaises(ValueError):
                cbox.validate(changed, self.media)
        (self.media / 'alias.wav').symlink_to(self.media / 'tone.wav')
        self.manifest['assets'][0]['path'] = 'alias.wav'
        with self.assertRaisesRegex(ValueError, 'symlink'):
            cbox.validate(self.manifest, self.media)

    def test_unknown_schema_and_selector(self):
        changed = copy.deepcopy(self.manifest); changed['schema'] = 'future/9'
        with self.assertRaisesRegex(ValueError, 'schema'):
            cbox.validate(changed, self.media)
        changed = copy.deepcopy(self.manifest); changed['annotations'][0]['selector']['type'] = 'video'
        with self.assertRaisesRegex(ValueError, 'unsupported prototype selector'):
            cbox.validate(changed, self.media)

    def test_invalid_sample_boundaries(self):
        for overrides in ({'end': 16001}, {'start': -1}, {'end': 0}, {'sample_rate': 48000}, {'start': True}):
            changed = copy.deepcopy(self.manifest)
            changed['annotations'][0]['selector'].update(overrides)
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                cbox.validate(changed, self.media)

    def test_duplicate_ids_and_unknown_assets(self):
        changed = copy.deepcopy(self.manifest); changed['assets'] *= 2
        with self.assertRaisesRegex(ValueError, 'duplicate asset'):
            cbox.validate(changed, self.media)
        self.manifest['annotations'][0]['asset_id'] = 'missing'
        with self.assertRaisesRegex(ValueError, 'unknown annotation asset'):
            cbox.validate(self.manifest, self.media)

    def test_malformed_asset_reference_rejected(self):
        self.manifest['annotations'][0]['asset_id'] = ['not-an-id']
        with self.assertRaisesRegex(ValueError, 'unknown annotation asset'):
            cbox.validate(self.manifest, self.media)

    def test_json_limits_and_duplicate_keys(self):
        with self.assertRaisesRegex(ValueError, 'duplicate JSON key'):
            cbox.parse_json(b'{"a":1,"a":2}')
        with self.assertRaisesRegex(ValueError, 'non-finite'):
            cbox.parse_json(b'{"a":NaN}')
        with self.assertRaisesRegex(ValueError, 'too large'):
            cbox.parse_json(b' ' * (cbox.MAX_JSON + 1))
        with self.assertRaisesRegex(ValueError, 'envelope size'):
            cbox.open_box(b'CBOX', self.media, PASSWORD)

    def test_write_never_overwrites_existing_file(self):
        target = self.root / 'existing.cbox'; target.write_bytes(b'keep')
        with self.assertRaises(FileExistsError):
            cbox.write_new(target, b'replace')
        self.assertEqual(target.read_bytes(), b'keep')
        self.assertFalse(list(self.root.glob('.cbox-*')))
