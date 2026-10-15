import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDomain } from '../desktop/domain.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'cutbox-domain-'));
  let domain = createDomain({ directory });
  t.after(() => { domain.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, get domain() { return domain; }, reopen() { domain.close(); domain = createDomain({ directory }); return domain; } };
}
function addMedia(domain, patch = {}) {
  return domain.addMedia({ name: '角色 镜头.mp4', kind: 'video', path: '/tmp/角色 镜头.mp4', sha256: 'a'.repeat(64), size: 123, duration: 10, width: 1920, height: 1080, ...patch });
}
function graph(domain) {
  const media = addMedia(domain);
  const entity = domain.saveEntity({ type: 'character', name: '小林', description: '蓝外套', tags: ['蓝色', '蓝色'], mediaIds: [media.id], coverMediaId: media.id });
  const annotation = domain.saveAnnotation({ mediaId: media.id, entityId: entity.id, start: 1.25, end: 3.75, label: '转身', region: { x: 0.2, y: 0.1, width: 0.3, height: 0.8 } });
  const collection = domain.saveCollection({ name: '动作参考', mediaIds: [media.id], entityIds: [entity.id], annotationIds: [annotation.id] });
  return { media, entity, annotation, collection };
}

test('persists a linked Unicode graph across reopen and snapshots cannot mutate storage', (t) => {
  const f = fixture(t);
  const { entity } = graph(f.domain);
  assert.deepEqual(entity.tags, ['蓝色']);
  const expected = f.domain.snapshot();
  assert.deepEqual(f.reopen().snapshot(), expected);
  const copy = f.domain.snapshot();
  copy.entities[0].name = 'changed outside';
  assert.equal(f.domain.snapshot().entities[0].name, '小林');
});

test('partial edits retain source anchors; entity removal only unlinks references', (t) => {
  const f = fixture(t);
  const file = join(f.directory, '原片.mp4');
  writeFileSync(file, 'original bytes');
  const media = addMedia(f.domain, { path: file });
  const entity = f.domain.saveEntity({ type: 'scene', name: '雨夜', mediaIds: [media.id] });
  const annotation = f.domain.saveAnnotation({ mediaId: media.id, entityId: entity.id, start: 0, end: 10, label: '街道' });
  f.domain.saveCollection({ name: '夜景', entityIds: [entity.id], annotationIds: [annotation.id], mediaIds: [media.id] });
  const edited = f.domain.saveAnnotation({ id: annotation.id, notes: '侧光' });
  assert.equal(edited.start, 0);
  assert.equal(edited.end, 10);
  assert.equal(edited.mediaId, media.id);
  f.domain.deleteEntity(entity.id);
  let snapshot = f.domain.snapshot();
  assert.equal(snapshot.entities.length, 0);
  assert.equal(snapshot.annotations[0].entityId, undefined);
  assert.deepEqual(snapshot.collections[0].entityIds, []);
  assert.deepEqual(snapshot.collections[0].annotationIds, [annotation.id]);
  f.domain.deleteAnnotation(annotation.id);
  snapshot = f.domain.snapshot();
  assert.deepEqual(snapshot.collections[0].annotationIds, []);
  assert.equal(snapshot.media.length, 1);
  assert.equal(readFileSync(file, 'utf8'), 'original bytes');
});

test('rejects invalid values and unknown updates without changing existing graph', (t) => {
  const { domain } = fixture(t);
  const { media, entity, annotation, collection } = graph(domain);
  const before = domain.snapshot();
  const invalid = [
    () => domain.saveEntity({ id: 'unknown', name: 'x' }),
    () => domain.saveAnnotation({ id: 'unknown' }),
    () => domain.saveCollection({ id: 'unknown' }),
    () => domain.saveEntity({ id: entity.id, mediaIds: [] }),
    () => domain.saveEntity({ id: entity.id, mediaIds: ['missing'] }),
    () => domain.saveEntity({ id: entity.id, type: 'bad' }),
    () => domain.saveAnnotation({ id: annotation.id, end: 11 }),
    () => domain.saveAnnotation({ id: annotation.id, start: 8 }),
    () => domain.saveAnnotation({ id: annotation.id, end: Infinity }),
    () => domain.saveAnnotation({ id: annotation.id, region: { x: 0.9, y: 0, width: 0.2, height: 1 } }),
    () => domain.saveAnnotation({ id: annotation.id, region: { x: 0, y: 0, width: 0, height: 1 } }),
    () => domain.saveAnnotation({ id: annotation.id, reviewState: 'magic' }),
    () => domain.saveCollection({ id: collection.id, annotationIds: ['missing'] }),
    () => addMedia(domain, { sha256: 'invalid' }),
    () => addMedia(domain, { path: '../relative.mp4' }),
    () => addMedia(domain, { size: 1.5 }),
    () => domain.deleteEntity('missing'),
  ];
  for (const operation of invalid) { assert.throws(operation); assert.deepEqual(domain.snapshot(), before); }
  assert.equal(addMedia(domain).id, media.id);
});

test('audio/image anchors and optional links can be cleared', (t) => {
  const { domain } = fixture(t);
  const audio = addMedia(domain, { kind: 'audio' });
  assert.throws(() => domain.saveAnnotation({ mediaId: audio.id, start: 0, end: 1, label: '声', region: { x: 0, y: 0, width: 1, height: 1 } }));
  const image = addMedia(domain, { kind: 'image', sha256: 'b'.repeat(64), duration: 0 });
  const entity = domain.saveEntity({ type: 'prop', name: '杯子', mediaIds: [image.id], coverMediaId: image.id });
  const mark = domain.saveAnnotation({ mediaId: image.id, entityId: entity.id, start: 0, end: 0, label: '杯子', region: { x: 0, y: 0, width: 1, height: 1 } });
  assert.equal(domain.saveEntity({ id: entity.id, coverMediaId: null, mediaIds: [] }).coverMediaId, undefined);
  const cleared = domain.saveAnnotation({ id: mark.id, entityId: null, region: null });
  assert.equal(cleared.entityId, undefined);
  assert.equal(cleared.region, undefined);
});

test('import remaps all references, deduplicates media and never overwrites existing entities', (t) => {
  const { domain } = fixture(t);
  const original = graph(domain);
  const input = domain.snapshot();
  input.entities[0].name = '另一个角色';
  const snapshot = domain.importSnapshot(input);
  assert.equal(snapshot.media.length, 1);
  assert.equal(snapshot.entities.length, 2);
  const imported = snapshot.entities[1];
  assert.notEqual(imported.id, original.entity.id);
  assert.equal(snapshot.entities[0].name, '小林');
  assert.equal(imported.coverMediaId, original.media.id);
  assert.equal(snapshot.annotations[1].entityId, imported.id);
  assert.deepEqual(snapshot.collections[1].entityIds, [imported.id]);
  assert.deepEqual(snapshot.collections[1].annotationIds, [snapshot.annotations[1].id]);
  assert.equal(snapshot.annotations[1].start, 1.25);
  assert.equal(snapshot.annotations[1].label, '转身');
});

test('late import failure rolls back every newly added record', (t) => {
  const { domain } = fixture(t);
  graph(domain);
  const before = domain.snapshot();
  const input = structuredClone(before);
  input.media[0].sha256 = 'c'.repeat(64);
  input.collections[0].annotationIds = ['missing'];
  assert.throws(() => domain.importSnapshot(input), /Missing import annotations reference/);
  assert.deepEqual(domain.snapshot(), before);
  input.collections[0].annotationIds = before.collections[0].annotationIds;
  input.media.push({ ...input.media[0] });
  assert.throws(() => domain.importSnapshot(input), /Duplicate import media id/);
  assert.deepEqual(domain.snapshot(), before);
});
