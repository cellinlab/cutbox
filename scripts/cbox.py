#!/usr/bin/env python3
"""Experimental CBox metadata envelope. Not a desktop app or stable format."""
from __future__ import annotations
import argparse
import getpass
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import struct
import tempfile
import wave

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b'CBOX\x00\x01\x00\x00'
HEADER_SIZE = 36  # magic + 16-byte salt + 12-byte nonce
MAX_JSON = 8 * 1024 * 1024
SCHEMA = 'cutbox.prototype/0.1'


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def parse_json(data):
    require(len(data) <= MAX_JSON, 'manifest too large')
    def invalid_constant(_):
        raise ValueError('non-finite JSON number')
    return json.loads(data, object_pairs_hook=unique_object, parse_constant=invalid_constant)


def media_path(root, value):
    require(isinstance(value, str) and bool(value), 'invalid media path')
    path = PurePosixPath(value)
    require(not path.is_absolute() and '\\' not in value and ':' not in value
            and all(p not in ('', '.', '..') for p in value.split('/')),
            'unsafe media path')
    current = Path(root).resolve(strict=True)
    for part in path.parts:
        current = current / part
        require(not current.is_symlink(), 'media symlink rejected')
    require(current.is_file(), 'missing media file')
    return current


def validate(manifest, root):
    require(isinstance(manifest, dict) and manifest.get('schema') == SCHEMA,
            'unsupported manifest schema')
    require(isinstance(manifest.get('collection_id'), str) and manifest['collection_id'],
            'missing collection ID')
    assets = manifest.get('assets')
    annotations = manifest.get('annotations')
    require(isinstance(assets, list) and 0 < len(assets) <= 10000, 'invalid assets')
    require(isinstance(annotations, list) and len(annotations) <= 100000, 'invalid annotations')
    known = {}
    paths = set()
    for asset in assets:
        require(isinstance(asset, dict), 'invalid asset')
        asset_id = asset.get('id')
        require(isinstance(asset_id, str) and asset_id and asset_id not in known, 'invalid/duplicate asset ID')
        path = media_path(root, asset.get('path'))
        key = asset['path'].casefold()
        require(key not in paths, 'duplicate/case-conflicting media path')
        paths.add(key)
        require(type(asset.get('size')) is int and asset['size'] >= 0, 'invalid media size')
        require(isinstance(asset.get('sha256'), str) and
                re.fullmatch('[a-f0-9]{64}', asset['sha256']), 'invalid SHA-256')
        require(path.stat().st_size == asset['size'] and digest(path) == asset['sha256'],
                'media integrity mismatch')
        known[asset_id] = path
    ids = set()
    for annotation in annotations:
        require(isinstance(annotation, dict), 'invalid annotation')
        annotation_id = annotation.get('id')
        require(isinstance(annotation_id, str) and annotation_id and annotation_id not in ids,
                'invalid/duplicate annotation ID')
        ids.add(annotation_id)
        require(isinstance(annotation.get('asset_id'), str) and annotation['asset_id'] in known,
                'unknown annotation asset')
        require(annotation.get('review_state') in ('suggested', 'accepted', 'rejected', 'needs_review'),
                'invalid review state')
        require(isinstance(annotation.get('predicate'), str) and annotation['predicate']
                and 'value' in annotation, 'missing annotation predicate/value')
        selector = annotation.get('selector')
        require(isinstance(selector, dict), 'missing selector')
        if selector.get('type') == 'asset':
            continue
        require(selector.get('type') == 'audio_samples', 'unsupported prototype selector')
        start, end, rate = (selector.get(k) for k in ('start', 'end', 'sample_rate'))
        require(all(type(n) is int for n in (start, end, rate)) and 0 <= start < end and rate > 0,
                'invalid audio sample range')
        with wave.open(str(known[annotation['asset_id']]), 'rb') as source:
            require(source.getframerate() == rate and end <= source.getnframes(),
                    'sample range does not match source WAV')
    return manifest


def key(password, salt):
    require(isinstance(password, str) and len(password) >= 12,
            'use a passphrase of at least 12 characters')
    return Scrypt(salt=salt, length=32, n=32768, r=8, p=1).derive(password.encode('utf-8'))


def seal(manifest, root, password):
    validate(manifest, root)
    plaintext = json.dumps(manifest, ensure_ascii=False, sort_keys=True,
                           separators=(',', ':'), allow_nan=False).encode('utf-8')
    require(len(plaintext) <= MAX_JSON, 'manifest too large')
    salt, nonce = os.urandom(16), os.urandom(12)
    header = MAGIC + salt + nonce
    return header + AESGCM(key(password, salt)).encrypt(nonce, plaintext, header)


def open_box(data, root, password):
    require(HEADER_SIZE + 16 <= len(data) <= HEADER_SIZE + MAX_JSON + 16,
            'invalid envelope size')
    require(data[:8] == MAGIC, 'unsupported CBox version')
    try:
        plaintext = AESGCM(key(password, data[8:24])).decrypt(data[24:36], data[36:], data[:36])
    except InvalidTag as exc:
        raise ValueError('authentication failed: wrong passphrase or modified envelope') from exc
    return validate(parse_json(plaintext), root)


def read_bounded(path, limit):
    with Path(path).open('rb') as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, 'file exceeds prototype limit')
    return data


def write_new(path, data):
    """Atomic publication without overwriting an existing output, permissions 0600."""
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix='.cbox-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
    finally:
        os.unlink(temporary)


def demo(directory):
    directory = Path(directory)
    directory.mkdir()  # explicit refusal to reuse/overwrite
    media = directory / 'media'
    media.mkdir()
    audio = media / 'tone.wav'
    rate = 16000
    with wave.open(str(audio), 'wb') as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(rate)
        target.writeframes(b''.join(struct.pack('<h', int(4000 * math.sin(2 * math.pi * 440 * i / rate)))
                                  for i in range(rate)))
    manifest = {
        'schema': SCHEMA, 'collection_id': 'synthetic-tone-example',
        'assets': [{'id': 'tone', 'path': 'tone.wav', 'size': audio.stat().st_size,
                    'sha256': digest(audio), 'origin': 'CutBox mathematical test signal'}],
        'annotations': [{'id': 'a1', 'asset_id': 'tone', 'predicate': 'sound.description',
                         'value': 'Synthetic 440 Hz sine tone; not speech', 'review_state': 'accepted',
                         'selector': {'type': 'audio_samples', 'start': 0, 'end': rate,
                                      'sample_rate': rate}}],
    }
    write_new(directory / 'manifest.json', json.dumps(manifest, indent=2).encode())
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('demo').add_argument('directory')
    pack = sub.add_parser('pack')
    pack.add_argument('manifest')
    pack.add_argument('media_root')
    pack.add_argument('output')
    verify = sub.add_parser('verify')
    verify.add_argument('box')
    verify.add_argument('media_root')
    args = parser.parse_args()
    try:
        if args.command == 'demo':
            demo(args.directory)
            print('Synthetic WAV and plaintext example manifest created.')
        elif args.command == 'pack':
            manifest = parse_json(read_bounded(args.manifest, MAX_JSON))
            password = getpass.getpass('Passphrase (12+ characters): ')
            require(password == getpass.getpass('Confirm passphrase: '), 'passphrases differ')
            write_new(args.output, seal(manifest, args.media_root, password))
            print('Encrypted metadata written; external media remains unencrypted.')
        else:
            password = getpass.getpass('Passphrase: ')
            manifest = open_box(read_bounded(args.box, HEADER_SIZE + MAX_JSON + 16), args.media_root, password)
            print(f"Verified {len(manifest['assets'])} assets and {len(manifest['annotations'])} annotations.")
    except (ValueError, OSError, EOFError, RecursionError, wave.Error) as exc:
        parser.exit(1, f'CBox error: {exc}\n')


if __name__ == '__main__':
    main()
