import { parentPort, workerData } from 'node:worker_threads';
import { mkdir, rm, writeFile, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createDomain } from './domain.mjs';
import { importMedia, exportReference, capabilities } from './media.mjs';
import { exportBundle, importBundle } from './packages.mjs';

const root = workerData.directory;
const domain = createDomain({ directory: root });
const controllers = new Map();
const active = new Set();
let closing = false;
const cacheDirectory = join(root, 'thumbnails');
const options = { cacheDirectory, ffmpegPath: workerData.ffmpegPath || 'ffmpeg', ffprobePath: workerData.ffprobePath || 'ffprobe' };
const snapshot = () => domain.snapshot();
const media = id => {
  const found = snapshot().media.find(item => item.id === id);
  if (!found) throw new Error('找不到素材，请刷新后重试。');
  return found;
};
const sourceStamp = details => [details.dev, details.ino, details.size, details.mtimeNs, details.ctimeNs].map(String).join(':');
async function verifySource(record, signal, expectedStamp) {
  const before = await stat(record.path, { bigint: true });
  const stamp = sourceStamp(before);
  const changed = () => new Error('源素材已更改，请重新导入后导出参考。 Source media changed.');
  if (!before.isFile() || before.size !== BigInt(record.size) || (expectedStamp && stamp !== expectedStamp)) throw changed();
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(record.path, { signal })) { hash.update(chunk); size += chunk.length; }
  const after = await stat(record.path, { bigint: true });
  if (signal.aborted) throw new Error('Media operation cancelled');
  if (size !== record.size || hash.digest('hex') !== record.sha256 || sourceStamp(after) !== stamp) throw changed();
  return stamp;
}
const methods = {
  snapshot,
  capabilities: () => capabilities(options),
  async importMedia(paths, requestId) {
    const controller = new AbortController();
    controllers.set(requestId, controller);
    let records;
    try { records = await importMedia(paths, { ...options, signal: controller.signal }); }
    finally { controllers.delete(requestId); }
    try { domain.importSnapshot({ media: records, entities: [], annotations: [], collections: [] }); }
    finally {
      const retained = new Set(snapshot().media.map(item => item.thumbnailPath));
      await Promise.all(records.filter(item => item.thumbnailPath && !retained.has(item.thumbnailPath)).map(item => unlink(item.thumbnailPath).catch(() => {})));
    }
    return snapshot();
  },
  media: ({ id, thumbnail }) => {
    const record = media(id);
    return { path: thumbnail ? record.thumbnailPath : record.path, kind: record.kind };
  },
  async exportReference(input, requestId) {
    const record = media(input.mediaId);
    const controller = new AbortController();
    controllers.set(requestId, controller);
    try {
      const originalStamp = await verifySource(record, controller.signal);
      const result = await exportReference({ ...options, inputPath: record.path, outputPath: input.outputPath,
        start: input.start, end: input.end, mode: input.mode, signal: controller.signal,
        onProgress: progress => parentPort.postMessage({ type: 'progress', id: requestId, progress }) });
      try { await verifySource(record, controller.signal, originalStamp); }
      catch (error) { await unlink(result.outputPath).catch(() => {}); throw error; }
      // A small sidecar retains the transformation without modifying the source.
      const provenance = { schema: 'cutbox.reference/0.1', sourceSha256: record.sha256,
        sourceMediaId: record.id, start: input.start, end: input.end, mode: input.mode,
        createdAt: new Date().toISOString(), timing: 'seconds; decoded and re-encoded, no VFR frame-accuracy guarantee',
        sourceConsistency: 'SHA-256, size and file identity/timestamps checked before and after export; not an atomic filesystem snapshot. Do not modify source files during export.' };
      let sidecarWarning;
      try { await writeFile(`${result.outputPath}.json`, JSON.stringify(provenance, null, 2), { flag: 'wx' }); }
      catch { sidecarWarning = '参考已导出，但来源描述文件未能写入。'; }
      return { path: result.outputPath, ...(sidecarWarning ? { warning: sidecarWarning } : {}) };
    } finally { controllers.delete(requestId); }
  },
  async exportPackage(input) {
    return exportBundle({ directory: input.directory, password: input.password, snapshot: snapshot(),
      entityIds: input.entityIds, collectionId: input.collectionId });
  },
  async importPackage(input) {
    const directory = join(root, 'managed', randomUUID());
    await mkdir(join(root, 'managed'), { recursive: true });
    try {
      const imported = await importBundle({ path: input.path, password: input.password, directory });
      domain.importSnapshot(imported);
      return snapshot();
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  },
};
for (const name of ['saveEntity', 'deleteEntity', 'saveAnnotation', 'deleteAnnotation', 'saveCollection']) {
  methods[name] = input => { domain[name](input); return snapshot(); };
}
parentPort.on('message', async ({ id, method, input }) => {
  if (method === 'cancel') { controllers.get(input)?.abort(); parentPort.postMessage({ id, result: true }); return; }
  if (method === 'close') {
    closing = true;
    for (const controller of controllers.values()) controller.abort();
    await Promise.allSettled([...active]);
    domain.close(); parentPort.postMessage({ id, result: true }); return;
  }
  if (closing) { parentPort.postMessage({ id, error: 'CutBox is shutting down' }); return; }
  const operation = (async () => {
    try {
      if (!Object.hasOwn(methods, method)) throw new Error('Unknown backend operation');
      const result = await methods[method](input, id);
      parentPort.postMessage({ id, result });
    } catch (error) { parentPort.postMessage({ id, error: error.message }); }
  })();
  active.add(operation);
  operation.finally(() => active.delete(operation));
});
parentPort.postMessage({ type: 'ready' });
