import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { capabilities, probeMedia, importMedia, exportReference } from '../desktop/media.mjs';

const execute = promisify(execFile);
let directory, source;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cutbox-media-'));
  source = join(directory, "test video ' $;.mp4");
  await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=12:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

test('probe and import real media, hash and thumbnail without shell interpolation', async () => {
  const metadata = await probeMedia(source);
  assert.equal(metadata.kind, 'video');
  assert.equal(metadata.width, 160);
  assert.ok(Math.abs(metadata.duration - 3) < 0.1);
  const [first, second] = await importMedia([source, source], { cacheDirectory: join(directory, 'cache') });
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.sha256, second.sha256);
  assert.notEqual(first.id, second.id);
  assert.equal((await probeMedia(first.thumbnailPath)).kind, 'image');
  assert.equal(first.path, source);
});

test('clip and edges encode playable trimmed videos and preserve audio only for clip', async () => {
  for (const mode of ['clip', 'edges']) {
    const updates = [];
    const outputPath = join(directory, `${mode}.mp4`);
    const result = await exportReference({ inputPath: source, outputPath, start: 0.5, end: 1.5, mode, onProgress: value => updates.push(value) });
    assert.equal(result.outputPath, outputPath);
    assert.ok(Math.abs(result.duration - 1) < 0.15);
    assert.equal(updates[0], 0);
    assert.equal(updates.at(-1), 1);
    assert.ok(updates.every(value => value >= 0 && value <= 1));
    const { stdout } = await execute('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', outputPath]);
    const streams = JSON.parse(stdout).streams;
    assert.equal(streams.some(stream => stream.codec_type === 'audio'), mode === 'clip');
    assert.ok(Math.abs(Number(streams[0].start_time)) < 0.01);
  }
  // Edges must be a real image transformation, not simply a renamed source clip.
  const decode = file => execute('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'md5', '-']);
  assert.notEqual((await decode(join(directory, 'clip.mp4'))).stdout, (await decode(join(directory, 'edges.mp4'))).stdout);
});

test('reject invalid ranges, unsupported modes and existing output without overwriting', async () => {
  const outputPath = join(directory, 'protected.mp4');
  await writeFile(outputPath, 'keep');
  const base = { inputPath: source, outputPath, start: 0, end: 1, mode: 'clip' };
  await assert.rejects(exportReference(base), /already exists/);
  assert.equal(await readFile(outputPath, 'utf8'), 'keep');
  for (const [start, end] of [[-1, 1], [1, 1], [NaN, 1], [0, Infinity], [0, 4]]) {
    await assert.rejects(exportReference({ ...base, outputPath: join(directory, 'invalid.mp4'), start, end }), /range/);
  }
  await assert.rejects(exportReference({ ...base, mode: 'depth' }), /Unsupported reference mode/);
  await assert.rejects(probeMedia(join(directory, 'unknown.txt')), /Unsupported media type/);
});

test('cancellation cleans staging files and never publishes output', async () => {
  const controller = new AbortController();
  const outputPath = join(directory, 'cancelled.mp4');
  await assert.rejects(exportReference({ inputPath: source, outputPath, start: 0, end: 3, mode: 'edges', signal: controller.signal, onProgress: () => controller.abort() }), { name: 'AbortError' });
  assert.ok(!(await readdir(directory)).includes('cancelled.mp4'));
  assert.ok(!(await readdir(directory)).some(name => name.startsWith('.cutbox-')));
});

test('audio imports without thumbnails and cannot become a video reference', async () => {
  const audio = join(directory, 'sound.wav');
  await execute('ffmpeg', ['-v', 'error', '-i', source, '-vn', audio]);
  const [record] = await importMedia([audio], { cacheDirectory: join(directory, 'cache') });
  assert.equal(record.kind, 'audio');
  assert.equal(record.thumbnailPath, undefined);
  await assert.rejects(exportReference({ inputPath: audio, outputPath: join(directory, 'audio.mp4'), start: 0, end: 1, mode: 'clip' }), /requires a video/);
});

test('failed import batch cleans newly generated thumbnails and preserves existing cache files', async () => {
  const cacheDirectory = join(directory, 'batch-cache');
  const [existing] = await importMedia([source], { cacheDirectory });
  const before = await readdir(cacheDirectory);
  await assert.rejects(importMedia([source, join(directory, 'missing.mp4')], { cacheDirectory }), /ENOENT/);
  assert.deepEqual(await readdir(cacheDirectory), before);
  assert.equal((await probeMedia(existing.thumbnailPath)).kind, 'image');
});

test('cancelling after FFmpeg reports progress cleans the active job', async () => {
  const controller = new AbortController();
  let updates = 0;
  await assert.rejects(exportReference({ inputPath: source, outputPath: join(directory, 'active-cancel.mp4'), start: 0, end: 3, mode: 'clip', signal: controller.signal, onProgress: () => {
    if (++updates > 1) controller.abort();
  } }), { name: 'AbortError' });
  assert.ok(updates > 1);
  const files = await readdir(directory);
  assert.ok(!files.includes('active-cancel.mp4'));
  assert.ok(!files.some(name => name.startsWith('.cutbox-')));
});

test('capabilities report available tools and honestly unavailable models', async () => {
  const result = await capabilities();
  assert.equal(result.clip, true);
  assert.equal(result.edges, true);
  assert.equal(result.depth.available, false);
  const missing = await capabilities({ ffmpegPath: join(directory, 'not-installed') });
  assert.equal(missing.ffmpeg, false);
  assert.equal(missing.clip, false);
});

test('import and probe accept cancellation, including an active probe process', async () => {
  const cancelled = AbortSignal.abort();
  await assert.rejects(probeMedia(source, { signal: cancelled }), { name: 'AbortError' });
  await assert.rejects(importMedia([source], { cacheDirectory: join(directory, 'cancel-cache'), signal: cancelled }), { name: 'AbortError' });
  if (process.platform === 'win32') return; // Executable fixture uses a POSIX shebang.
  const marker = join(directory, 'probe-running');
  const fixture = join(directory, 'waiting-probe.mjs');
  await writeFile(fixture, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ready');\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
  const controller = new AbortController();
  const pending = importMedia([source], { cacheDirectory: join(directory, 'cancel-cache'), ffprobePath: fixture, signal: controller.signal });
  const assertion = assert.rejects(pending, { name: 'AbortError' });
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      ready = await access(marker).then(() => true, () => false);
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(ready, 'the child probe must be running before cancellation');
  } finally { controller.abort(); }
  await assertion;
  assert.deepEqual(await readdir(join(directory, 'cancel-cache')), []);
});
