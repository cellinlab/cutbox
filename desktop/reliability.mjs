import { createReadStream } from 'node:fs';
import { mkdir, stat, lstat, copyFile, writeFile, readFile, rm, rename, mkdtemp, open, link } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname, extname, resolve } from 'node:path';

const MAX_MANIFEST = 32 * 1024 * 1024;
export async function fileDigest(path, signal) {
  signal?.throwIfAborted();
  const info = await stat(path);
  if (!info.isFile()) throw new Error('素材必须是普通文件');
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(path, { signal })) { hash.update(chunk); size += chunk.length; }
  return { sha256: hash.digest('hex'), size };
}
export async function verifyMedia(record, signal) {
  const digest = await fileDigest(record.path, signal);
  if (digest.sha256 !== record.sha256 || digest.size !== record.size) throw new Error('素材内容与原始记录不一致，不能绑定已有标注。');
  return digest;
}
export async function checkMedia(snapshot, signal) {
  const result = [];
  for (const media of snapshot.media) {
    signal?.throwIfAborted();
    try { await verifyMedia(media, signal); result.push({ mediaId: media.id, status: 'ok' }); }
    catch (error) {
      signal?.throwIfAborted();
      result.push({ mediaId: media.id, status: error.code === 'ENOENT' ? 'missing' : 'changed', message: error.message });
    }
  }
  return result;
}
export async function publishDirectory(directory, operation) {
  directory = resolve(directory);
  const temp = await mkdtemp(join(dirname(directory), '.cutbox-backup-'));
  let reserved = false;
  try {
    const result = await operation(temp);
    await mkdir(directory, { mode: 0o700 }); reserved = true;
    await rename(temp, directory); reserved = false;
    return result;
  } catch (error) { if (reserved) await rm(directory, { recursive: true, force: true }); throw error; }
  finally { await rm(temp, { recursive: true, force: true }); }
}
export async function backupProject({ directory, snapshot, signal, onProgress = () => {} }) {
  directory = resolve(directory);
  await publishDirectory(directory, async temp => {
    await mkdir(join(temp, 'media'));
    const copy = structuredClone(snapshot);
    for (let i = 0; i < copy.media.length; i++) {
      signal?.throwIfAborted();
      const record = copy.media[i];
      const ext = extname(record.path).toLowerCase();
      const relative = `media/${record.sha256}${/^\.[a-z0-9]{1,10}$/.test(ext) ? ext : ''}`;
      await copyFile(record.path, join(temp, relative));
      await verifyMedia({ ...record, path: join(temp, relative) }, signal);
      record.path = relative; delete record.thumbnailPath; delete record.proxyPath;
      onProgress((i + 1) / Math.max(1, copy.media.length));
    }
    const json = JSON.stringify({ schema: 'cutbox.backup/1', snapshot: copy }, null, 2);
    if (Buffer.byteLength(json) > MAX_MANIFEST) throw new Error('备份描述超过 32 MiB');
    signal?.throwIfAborted();
    await writeFile(join(temp, 'project.cutbox-backup.json'), json, { flag: 'wx', mode: 0o600 });
  });
  return { path: join(directory, 'project.cutbox-backup.json') };
}
export async function readBackup({ path, directory, signal, onProgress = () => {} }) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MANIFEST) throw new Error('无效或过大的备份文件');
  const handle = await open(path, 'r'); let bytes;
  try { bytes = Buffer.alloc(MAX_MANIFEST + 1); const read = await handle.read(bytes, 0, bytes.length, 0); bytes = bytes.subarray(0, read.bytesRead); }
  finally { await handle.close(); }
  if (bytes.length > MAX_MANIFEST) throw new Error('备份描述过大');
  const record = JSON.parse(bytes.toString('utf8'));
  if (record.schema !== 'cutbox.backup/1' || !Array.isArray(record.snapshot?.media)) throw new Error('不支持的备份格式');
  const snapshot = record.snapshot;
  const sourceRoot = dirname(resolve(path));
  const folder = await lstat(join(sourceRoot, 'media'));
  if (!folder.isDirectory() || folder.isSymbolicLink()) throw new Error('无效素材目录');
  directory = resolve(directory);
  await publishDirectory(directory, async temp => {
    await mkdir(join(temp, 'media'));
    for (let i = 0; i < snapshot.media.length; i++) {
      signal?.throwIfAborted();
      const media = snapshot.media[i];
      if (typeof media.path !== 'string' || !/^media\/[a-f0-9]{64}(\.[a-z0-9]{1,10})?$/.test(media.path)) throw new Error('不安全的备份素材路径');
      const source = join(sourceRoot, media.path);
      const sourceInfo = await lstat(source);
      if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error('备份素材必须是普通文件');
      const target = join(temp, media.path);
      await copyFile(source, target);
      await verifyMedia({ ...media, path: target }, signal);
      const relative = media.path;
      media.path = join(directory, relative); delete media.proxyPath; delete media.thumbnailPath;
      onProgress((i + 1) / Math.max(1, snapshot.media.length));
    }
  });
  return snapshot;
}
export async function writeNewFile(path, content, signal) {
  signal?.throwIfAborted();
  const staging = await mkdtemp(join(dirname(resolve(path)), '.cutbox-export-'));
  try {
    const temporary = join(staging, 'output');
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600, signal });
    signal?.throwIfAborted();
    await link(temporary, path);
    return { path };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
export async function readModelConfig(root) {
  try { return JSON.parse(await readFile(join(root, 'models.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
export async function writeModelConfig(root, config) {
  const temp = join(root, `.models-${randomUUID()}.json`);
  try { await writeFile(temp, JSON.stringify(config), { flag: 'wx', mode: 0o600 }); await rename(temp, join(root, 'models.json')); }
  finally { await rm(temp, { force: true }); }
}
