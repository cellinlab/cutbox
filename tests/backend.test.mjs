import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { appendFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exportBundle } from '../desktop/packages.mjs';

const execute = promisify(execFile);
const password = 'cutbox integration passphrase';
async function openWorker(directory, onProgress) {
  const worker = new Worker(new URL('../desktop/backend-worker.mjs', import.meta.url), { workerData: { directory } });
  const pending = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  worker.on('message', message => {
    if (message.type === 'ready') { readyResolve(); return; }
    if (message.type === 'progress') { onProgress?.(message); return; }
    const entry = pending.get(message.id);
    if (!entry || message.type === 'progress') return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    message.error ? entry.reject(new Error(message.error)) : entry.resolve(message.result);
  });
  worker.on('error', error => {
    readyReject(error);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  });
  await ready;
  const call = (method, input) => new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Worker timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, method, input });
  });
  let stopped = false;
  return { call, async close() {
    if (stopped) return;
    stopped = true;
    try { await call('close'); } finally { await worker.terminate(); }
  } };
}

test('real worker imports media, edits graph, exports a bundle and persists a portable reimport', { timeout: 40000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cutbox-worker-'));
  const workers = [];
  t.after(async () => { for (const worker of workers) await worker.close(); await rm(directory, { recursive: true, force: true }); });
  const source = join(directory, '测试 视频.mp4');
  await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=10:duration=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', source]);
  const originalBytes = await readFile(source);
  const original = await openWorker(join(directory, 'original'));
  workers.push(original);
  let snapshot = await original.call('importMedia', [source]);
  const media = snapshot.media[0];
  assert.equal(media.kind, 'video');
  assert.equal(media.name, '测试 视频.mp4');
  assert.ok(media.thumbnailPath);
  snapshot = await original.call('saveEntity', { type: 'character', name: '阿青', tags: ['侧身'], mediaIds: [media.id], coverMediaId: media.id });
  const entity = snapshot.entities[0];
  snapshot = await original.call('saveAnnotation', { mediaId: media.id, entityId: entity.id, start: 0.1, end: 0.8, label: '转身', notes: '保留来源', region: { x: 0.1, y: 0.1, width: 0.3, height: 0.5 } });
  const annotation = snapshot.annotations[0];
  snapshot = await original.call('saveCollection', { name: '角色动作', entityIds: [entity.id], mediaIds: [media.id], annotationIds: [annotation.id] });
  const exported = await original.call('exportPackage', { directory: join(directory, 'bundle'), password, collectionId: snapshot.collections[0].id });
  assert.equal(exported.mediaCount, 1);
  await original.close();
  await rm(source);

  const restoredDirectory = join(directory, 'restored');
  const restored = await openWorker(restoredDirectory);
  workers.push(restored);
  snapshot = await restored.call('importPackage', { path: exported.path, password });
  assert.equal(snapshot.media.length, 1);
  assert.equal(snapshot.entities[0].name, '阿青');
  assert.equal(snapshot.annotations[0].entityId, snapshot.entities[0].id);
  assert.equal(snapshot.annotations[0].mediaId, snapshot.media[0].id);
  assert.deepEqual(snapshot.collections[0].annotationIds, [snapshot.annotations[0].id]);
  assert.notEqual(snapshot.entities[0].id, entity.id);
  const importedPath = (await restored.call('media', { id: snapshot.media[0].id })).path;
  assert.ok(importedPath.startsWith(join(restoredDirectory, 'managed')));
  assert.deepEqual(await readFile(importedPath), originalBytes);
  assert.equal(snapshot.media[0].sha256, createHash('sha256').update(originalBytes).digest('hex'));
  await restored.close();
  const reopened = await openWorker(restoredDirectory);
  workers.push(reopened);
  assert.deepEqual(await reopened.call('snapshot'), snapshot);
  await assert.rejects(reopened.call('saveAnnotation', { id: snapshot.annotations[0].id, end: 100 }), /duration/);
  await assert.rejects(reopened.call('unknownMethod'), /Unknown backend operation/);
  assert.deepEqual(await reopened.call('snapshot'), snapshot);

  // A valid encrypted package can still fail domain validation; no managed copy or DB rows may survive.
  const invalidSnapshot = structuredClone(snapshot);
  invalidSnapshot.entities[0].type = 'invalid-entity-type';
  const invalid = await exportBundle({ directory: join(directory, 'invalid-bundle'), password, snapshot: invalidSnapshot });
  const managedBefore = await readdir(join(restoredDirectory, 'managed'));
  await assert.rejects(reopened.call('importPackage', { path: invalid.path, password }), /entity type/);
  assert.deepEqual(await readdir(join(restoredDirectory, 'managed')), managedBefore);
  assert.deepEqual(await reopened.call('snapshot'), snapshot);
  await assert.rejects(reopened.call('importPackage', { path: exported.path, password: 'wrong but long password' }), /Authentication failed/);
  assert.deepEqual(await readdir(join(restoredDirectory, 'managed')), managedBefore);
});

test('reference export verifies source bytes before writing provenance and rejects replaced originals', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cutbox-source-integrity-'));
  const worker = await openWorker(join(directory, 'project'));
  t.after(async () => { await worker.close(); await rm(directory, { recursive: true, force: true }); });
  const source = join(directory, 'source.mp4');
  await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=10:duration=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', source]);
  const { media: [record] } = await worker.call('importMedia', [source]);
  const outputPath = join(directory, 'reference.mp4');
  await worker.call('exportReference', { mediaId: record.id, outputPath, start: 0, end: 0.5, mode: 'clip' });
  const provenance = JSON.parse(await readFile(`${outputPath}.json`, 'utf8'));
  assert.equal(provenance.sourceSha256, record.sha256);
  assert.match(provenance.sourceConsistency, /not an atomic filesystem snapshot/);
  // Same-size replacement must be caught by hashing, not merely by size.
  const bytes = await readFile(source);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(source, bytes);
  const rejectedOutput = join(directory, 'changed-reference.mp4');
  await assert.rejects(worker.call('exportReference', { mediaId: record.id, outputPath: rejectedOutput, start: 0, end: 0.5, mode: 'clip' }), /Source media changed/);
  assert.ok(!(await readdir(directory)).includes('changed-reference.mp4'));
  assert.ok(!(await readdir(directory)).includes('changed-reference.mp4.json'));
});

test('source mutation during reference processing removes output and never writes stale provenance', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cutbox-source-mutation-'));
  const source = join(directory, 'source.mp4');
  let changed = false;
  const worker = await openWorker(join(directory, 'project'), () => {
    if (!changed) { changed = true; appendFileSync(source, Buffer.from([0])); }
  });
  t.after(async () => { await worker.close(); await rm(directory, { recursive: true, force: true }); });
  await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=10:duration=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', source]);
  const { media: [record] } = await worker.call('importMedia', [source]);
  const outputPath = join(directory, 'reference.mp4');
  await assert.rejects(worker.call('exportReference', { mediaId: record.id, outputPath, start: 0, end: 0.5, mode: 'clip' }), /Source media changed/);
  assert.equal(changed, true);
  const files = await readdir(directory);
  assert.ok(!files.includes('reference.mp4'));
  assert.ok(!files.includes('reference.mp4.json'));
});
