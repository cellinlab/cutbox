import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupProject, readBackup, checkMedia, fileDigest, verifyMedia } from '../desktop/reliability.mjs';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cutbox-reliability-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source.bin'); await writeFile(source, 'source-content');
  const record = { id: 'm', name: 'Synthetic', kind: 'audio', duration: 1, path: source, ...await fileDigest(source) };
  return { root, source, snapshot: { media: [record], entities: [], annotations: [], collections: [], templates: [], events: [], relations: [], stories: [] } };
}
test('backup relocates checked media and preserves semantic identifiers without source paths', async t => {
  const { root, source, snapshot } = await fixture(t);
  const backup = await backupProject({ directory: join(root, 'backup'), snapshot });
  const serialized = await readFile(backup.path, 'utf8'); assert.ok(!serialized.includes(source));
  await rm(source);
  const restored = await readBackup({ path: backup.path, directory: join(root, 'restored') });
  assert.equal(restored.media[0].id, 'm'); await verifyMedia(restored.media[0]);
  assert.deepEqual(await checkMedia(restored), [{ mediaId: 'm', status: 'ok' }]);
  assert.equal((await checkMedia(snapshot))[0].status, 'missing');
});
test('tampered media and path traversal never publish a restored directory', async t => {
  const { root, snapshot } = await fixture(t);
  const backup = await backupProject({ directory: join(root, 'backup'), snapshot });
  const manifest = JSON.parse(await readFile(backup.path, 'utf8'));
  await writeFile(join(root, 'backup', manifest.snapshot.media[0].path), 'tampered');
  await assert.rejects(readBackup({ path: backup.path, directory: join(root, 'restored') }), /不一致/);
  assert.ok(!(await readdir(root)).includes('restored'));
  manifest.snapshot.media[0].path = '../../outside'; await writeFile(backup.path, JSON.stringify(manifest));
  await assert.rejects(readBackup({ path: backup.path, directory: join(root, 'restored') }), /不安全/);
  assert.ok(!(await readdir(root)).some(name => name.startsWith('.cutbox-backup-')));
});
test('backup rejects changed originals and never overwrites an existing directory', async t => {
  const { root, source, snapshot } = await fixture(t);
  await mkdir(join(root, 'existing'));
  await assert.rejects(backupProject({ directory: join(root, 'existing'), snapshot }), { code: 'EEXIST' });
  await writeFile(source, 'changed-content');
  assert.equal((await checkMedia(snapshot))[0].status, 'changed');
  await assert.rejects(backupProject({ directory: join(root, 'changed'), snapshot }), /不一致/);
  assert.ok(!(await readdir(root)).includes('changed'));
});
test('cancelled backup leaves no published or staging files', async t => {
  const { root, snapshot } = await fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(backupProject({ directory: join(root, 'cancelled'), snapshot, signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual((await readdir(root)).sort(), ['source.bin']);
});
