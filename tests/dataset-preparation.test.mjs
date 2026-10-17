import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectDataset, splitDataset, exportTrainingDataset } from '../desktop/dataset-preparation.mjs';

const run = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const media = (id, extra = {}) => ({ id, name: `${id}.wav`, path: path.resolve(os.tmpdir(), `${id}.wav`), kind: 'audio', size: 100, duration: 20, sha256: hash(id), ...extra });
const annotation = (id, mediaId, extra = {}) => ({ id, mediaId, start: 1, end: 2, label: `Caption ${id}`, reviewState: 'accepted', epistemic: 'observed', confidence: .9, tags: ['test'], notes: 'production notes', ...extra });
const snapshot = (extra = {}) => ({ media: [media('m')], annotations: [annotation('a', 'm')], entities: [], collections: [], templates: [], events: [], relations: [], stories: [], ...extra });

test('audit filters unknown confidence and bad metadata without mutating the snapshot', () => {
  const input = snapshot({ media: [media('m'), media('bad', { sha256: 123 })], annotations: [
    annotation('accepted', 'm'), annotation('suggested', 'm', { reviewState: 'suggested' }), annotation('review', 'm', { reviewState: 'needs_review' }),
    annotation('unknown', 'm', { confidence: null }), annotation('low', 'm', { confidence: .2 }), annotation('invented', 'm', { epistemic: 'invented' }),
    annotation('caption', 'm', { label: '', notes: 'not a caption' }), annotation('bad', 'bad'), annotation('missing', 'gone'), annotation('point', 'm', { end: 1 }),
  ] });
  const before = structuredClone(input);
  const result = inspectDataset(input, { minConfidence: .7, requireObserved: true });
  assert.deepEqual(result.summary, { total: 10, eligible: 1, excluded: 9, media: 1, entities: 0 });
  assert.ok(['not_accepted', 'unknown_confidence', 'low_confidence', 'not_observed', 'missing_caption', 'invalid_source_metadata', 'missing_media', 'invalid_interval'].every(code => result.issues.some(issue => issue.code === code)));
  assert.deepEqual(input, before);
  assert.ok(inspectDataset(input, { acceptedOnly: false }).samples.some(sample => sample.annotationId === 'suggested'));
  assert.throws(() => inspectDataset(input, { minConfidence: null }), /confidence/);
});

test('collection scope includes explicit annotations and selected media/entities', () => {
  const input = snapshot({ media: [media('m1'), media('m2'), media('m3'), media('m4')], entities: [{ id: 'character', mediaIds: [] }], annotations: [annotation('a1', 'm1'), annotation('a2', 'm2'), annotation('a3', 'm3', { entityId: 'character' }), annotation('a4', 'm4')], collections: [{ id: 'c', mediaIds: ['m1'], entityIds: ['character'], annotationIds: ['a2'] }] });
  assert.deepEqual(inspectDataset(input, { collectionId: 'c' }).samples.map(sample => sample.annotationId), ['a1', 'a2', 'a3']);
  assert.throws(() => inspectDataset(input, { collectionId: 'missing' }), /Unknown collection/);
});

test('known duplicate/ancestor sources stay together across all grouping options and input order', () => {
  const original = media('original', { series: 'Series A', episode: '1' });
  const trimmed = media('trimmed', { duration: 10, series: 'Series B', episode: '2', sourceAnchor: { mediaId: original.id, sha256: original.sha256, start: 5, end: 15, duration: 20 } });
  const trimAgain = media('again', { duration: 5, sourceAnchor: { mediaId: trimmed.id, sha256: trimmed.sha256, start: 2, end: 7, duration: 10 } });
  const duplicate = media('duplicate', { sha256: trimmed.sha256 });
  const input = snapshot({ media: [original, trimmed, trimAgain, duplicate, ...Array.from({ length: 30 }, (_, i) => media(`independent-${i}`))], annotations: [annotation('original-a', original.id, { start: 8, end: 9 }), annotation('trim-a', trimmed.id, { start: 3, end: 4 }), annotation('again-a', trimAgain.id), annotation('duplicate-a', duplicate.id), ...Array.from({ length: 30 }, (_, i) => annotation(`independent-a-${i}`, `independent-${i}`))] });
  const report = inspectDataset(input);
  assert.equal(report.distribution.crossSeriesSources, 1);
  assert.ok(report.issues.some(issue => issue.code === 'duplicate_window'));
  for (const groupBy of ['source', 'episode', 'entity']) {
    const first = splitDataset(report.samples, { groupBy, seed: 'stable' });
    const reversed = splitDataset(inspectDataset({ ...input, media: [...input.media].reverse(), annotations: [...input.annotations].reverse() }).samples.reverse(), { groupBy, seed: 'stable' });
    assert.deepEqual(first, reversed);
    const lineage = first.samples.filter(sample => ['original-a', 'trim-a', 'again-a', 'duplicate-a'].includes(sample.annotationId));
    assert.equal(new Set(lineage.map(sample => sample.split)).size, 1);
    assert.equal(new Set(lineage.map(sample => sample.splitGroup)).size, 1);
    for (const source of new Set(first.samples.map(sample => sample.sourceGroup))) assert.equal(new Set(first.samples.filter(sample => sample.sourceGroup === source).map(sample => sample.split)).size, 1);
  }
});

test('unique multi-generation lineage resolves original temporal coordinates', () => {
  const a = media('a'), b = media('b', { duration: 10, sourceAnchor: { mediaId: 'a', sha256: a.sha256, start: 5, end: 15, duration: 20 } }), c = media('c', { duration: 4, sourceAnchor: { mediaId: 'b', sha256: b.sha256, start: 2, end: 6, duration: 10 } });
  const sample = inspectDataset(snapshot({ media: [a, b, c], annotations: [annotation('c-a', 'c')] })).samples[0];
  assert.equal(sample.sourceStart, 8); assert.equal(sample.sourceEnd, 9);
  assert.equal(sample.timeSourceSha256, a.sha256);
  const padded = media('padded', { duration: 4.2, sourceAnchor: { mediaId: 'a', sha256: a.sha256, start: 5, end: 9, duration: 20 } });
  const excluded = inspectDataset(snapshot({ media: [a, padded], annotations: [annotation('tail', 'padded', { start: 4, end: 4.1 })] }));
  assert.equal(excluded.summary.eligible, 0);
  assert.ok(excluded.issues.some(issue => issue.code === 'lineage_padding' && issue.severity === 'error'));
});

test('episode/entity split grouping merges connected components, including a bridging sample', () => {
  const samples = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, sourceGroup: `source${i}`, sourceAliases: [hash(`source${i}`)], entityIds: [], series: 'series', episode: `e${i}` }));
  samples[0].entityIds = ['alice']; samples[1].entityIds = ['alice', 'bob']; samples[2].entityIds = ['bob'];
  const entity = splitDataset(samples, { groupBy: 'entity' });
  assert.equal(new Set(entity.samples.slice(0, 3).map(sample => sample.splitGroup)).size, 1);
  samples[0].episode = 'shared'; samples[2].episode = 'shared';
  const episode = splitDataset(samples, { groupBy: 'episode' });
  assert.equal(episode.samples[0].splitGroup, episode.samples[2].splitGroup);
  assert.throws(() => splitDataset(samples, { ratios: { train: .8, validation: .8, test: .1 } }), /sum/);
  assert.throws(() => splitDataset(samples, { ratios: { train: 1, validation: 0, test: -0.1 } }), /within/);
  assert.throws(() => splitDataset(samples, { seed: '' }), /seed/);
  assert.equal(splitDataset(samples, { ratios: { train: 0, validation: 0, test: 1 } }).splitCounts.test, 4);
  assert.ok(splitDataset([samples[0]]).issues.some(issue => issue.code === 'empty_split'));
});

test('10,000 annotations retain deterministic source isolation without quadratic graph scans', () => {
  const input = snapshot({ media: Array.from({ length: 100 }, (_, index) => media(`large-${index}`, { duration: 300 })),
    templates: [{ id: 'template', fields: [] }],
    annotations: Array.from({ length: 10_000 }, (_, index) => annotation(`sample-${String(index).padStart(5, '0')}`, `large-${index % 100}`, { start: Math.floor(index / 100) * 2, end: Math.floor(index / 100) * 2 + 1, templateId: 'template' })) });
  const report = inspectDataset(input), first = splitDataset(report.samples, { seed: 'large-set' });
  assert.equal(report.summary.eligible, 10_000);
  assert.equal(Object.values(first.splitCounts).reduce((sum, value) => sum + value, 0), 10_000);
  assert.deepEqual(first, splitDataset([...report.samples].reverse(), { seed: 'large-set' }));
  const sources = new Map();
  for (const sample of first.samples) {
    if (!sources.has(sample.sourceGroup)) sources.set(sample.sourceGroup, sample.split);
    assert.equal(sources.get(sample.sourceGroup), sample.split);
  }
  assert.equal(sources.size, 100);
});

test('entity grouping includes performer dependency closure and reports missing dependencies', () => {
  const input = snapshot({ entities: [{ id: 'role', mediaIds: ['m'], actorEntityId: 'actor' }, { id: 'actor', mediaIds: [], actorEntityId: 'performer' }, { id: 'performer', mediaIds: [] }] });
  assert.deepEqual(inspectDataset(input).samples[0].entityIds, ['actor', 'performer', 'role']);
  input.entities.pop();
  const report = inspectDataset(input);
  assert.equal(report.summary.eligible, 0);
  assert.ok(report.issues.some(issue => issue.code === 'missing_entity_dependency'));
});

test('overlap, captions and image zero-time samples are audited without fabricating labels', () => {
  const input = snapshot({ media: [media('m'), media('image', { kind: 'image', width: 320, height: 240, duration: 0 })], annotations: [annotation('a', 'm', { start: 1, end: 3 }), annotation('b', 'm', { start: 2, end: 4, values: { caption: 'Explicit caption' } }), annotation('image', 'image', { start: 0, end: 0 })] });
  const audit = inspectDataset(input);
  assert.equal(audit.summary.eligible, 3);
  assert.equal(audit.distribution.overlappingWindows, 1);
  assert.equal(audit.samples.find(sample => sample.annotationId === 'b').caption, 'Explicit caption');
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cutbox-training-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'tone.wav');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'pcm_s16le', source]);
  const bytes = await fs.readFile(source);
  return { root, data: snapshot({ media: [media('m', { path: source, name: 'tone.wav', duration: 4, size: bytes.length, sha256: hash(bytes) })], annotations: [annotation('a', 'm', { start: 1, end: 2, words: [{ text: 'word', start: 1.1, end: 1.8, confidence: .8 }] }), annotation('excluded', 'm', { start: 0, end: 4, reviewState: 'suggested' })] }) };
}

test('real trimmed dataset contains portable media, split rows, report and original temporal annotations', async t => {
  const { root, data } = await fixture(t), before = structuredClone(data);
  const result = await exportTrainingDataset({ directory: path.join(root, 'dataset'), snapshot: data, ratios: { train: 1, validation: 0, test: 0 } });
  assert.equal(result.sampleCount, 1); assert.deepEqual(result.splitCounts, { train: 1, validation: 0, test: 0 });
  const text = await fs.readFile(result.path, 'utf8'), row = JSON.parse(text.trim());
  assert.equal(row.originalAnnotation.start, 1); assert.equal(row.originalAnnotation.end, 2);
  assert.equal(row.annotation.start, 0); assert.equal(row.annotation.end, 1);
  assert.ok(Math.abs(row.annotation.words[0].start - .1) < 1e-9);
  assert.equal(row.source.start, 1); assert.equal(row.source.end, 2); assert.equal(row.source.sha256, data.media[0].sha256);
  assert.equal(row.media.sourceAnchor.start, 1); assert.ok(!path.isAbsolute(row.media.path));
  assert.equal(await fs.readFile(path.join(result.directory, 'train.jsonl'), 'utf8'), text);
  assert.equal(await fs.readFile(path.join(result.directory, 'validation.jsonl'), 'utf8'), '');
  const manifestText = await fs.readFile(path.join(result.directory, 'manifest.json'), 'utf8');
  for (const filename of ['samples.jsonl', 'manifest.json', 'report.json', 'dataset-card.md']) assert.ok(!(await fs.readFile(path.join(result.directory, filename), 'utf8')).includes(root));
  assert.equal(JSON.parse(manifestText).annotations.length, 1);
  const probed = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path.join(result.directory, row.media.path)])).stdout);
  assert.ok(Math.abs(Number(probed.format.duration) - 1) < .02);
  assert.deepEqual(data, before);
  await assert.rejects(exportTrainingDataset({ directory: result.directory, snapshot: data }), /already exists/);
  assert.equal(await fs.readFile(result.path, 'utf8'), text);
});

test('repeated trimmed export preserves earlier source lineage instead of replacing it', async t => {
  const { root, data } = await fixture(t);
  const ancestor = hash('original-parent');
  data.media[0].sourceAnchor = { mediaId: 'parent', sha256: ancestor, start: 10, end: 14, duration: 30 };
  data.annotations[0].sourceAnchor = { mediaId: 'parent', start: 11, end: 12 };
  const result = await exportTrainingDataset({ directory: path.join(root, 'lineage'), snapshot: data });
  const row = JSON.parse((await fs.readFile(result.path, 'utf8')).trim());
  assert.equal(row.media.sourceAnchor.sha256, ancestor);
  assert.equal(row.media.sourceAnchor.start, 11); assert.equal(row.media.sourceAnchor.end, 12);
  assert.deepEqual(row.annotation.sourceAnchor, { mediaId: 'parent', start: 11, end: 12 });
  assert.equal(row.source.sha256, ancestor); assert.equal(row.source.start, 11);
});

test('dataset card renders authored seed and collection IDs literally while JSON preserves exact values', async t => {
  const { root, data } = await fixture(t);
  const seed = '<img src=x onerror=alert(1)> [link](https://example.com) `code`';
  const collectionId = '<svg onload=alert(2)> ![image](https://example.com/p.png)';
  data.collections = [{ id: collectionId, name: 'Selected annotations', mediaIds: [], entityIds: [], annotationIds: ['a'] }];
  const result = await exportTrainingDataset({ directory: path.join(root, 'literal-card'), snapshot: data, seed, collectionId, profile: 'full' });
  const card = await fs.readFile(path.join(result.directory, 'dataset-card.md'), 'utf8');
  assert.ok(card.includes('&lt;img src=x onerror=alert\\(1\\)&gt;'));
  assert.ok(card.includes('\\[link\\]\\(https://example\\.com\\)'));
  assert.ok(card.includes('&lt;svg onload=alert\\(2\\)&gt;'));
  assert.ok(card.includes('\\!\\[image\\]\\(https://example\\.com/p\\.png\\)'));
  assert.ok(card.includes('\\`code\\`'));
  assert.ok(!card.includes('<img') && !card.includes('<svg') && !card.includes('[link]('));
  const reportText = await fs.readFile(path.join(result.directory, 'report.json'), 'utf8');
  const report = JSON.parse(reportText), manifest = JSON.parse(await fs.readFile(path.join(result.directory, 'manifest.json'), 'utf8'));
  assert.equal(report.split.seed, seed); assert.equal(manifest.dataset.seed, seed);
  assert.equal(report.filters.collectionId, collectionId); assert.equal(manifest.dataset.filters.collectionId, collectionId);
  assert.ok(!reportText.includes(root));
});

test('empty selection, invalid ratios, cancellation and changed bytes leave no partial dataset', async t => {
  const { root, data } = await fixture(t);
  const before = await fs.readdir(root);
  await assert.rejects(exportTrainingDataset({ directory: path.join(root, 'empty'), snapshot: data, minConfidence: 1 }), /No eligible/);
  await assert.rejects(exportTrainingDataset({ directory: path.join(root, 'ratio'), snapshot: data, ratios: { train: 1, validation: 1, test: 0 } }), /sum/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(exportTrainingDataset({ directory: path.join(root, 'cancel'), snapshot: data, signal: controller.signal }));
  const active = new AbortController();
  await assert.rejects(exportTrainingDataset({ directory: path.join(root, 'active'), snapshot: data, signal: active.signal, onProgress() { active.abort(); } }));
  await fs.appendFile(data.media[0].path, 'changed');
  await assert.rejects(exportTrainingDataset({ directory: path.join(root, 'changed'), snapshot: data }), /changed since import/);
  assert.deepEqual(await fs.readdir(root), before);
});
