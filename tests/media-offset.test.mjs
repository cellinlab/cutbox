import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { probeMedia, exportReference } from '../desktop/media.mjs';
import { waveform, frameTimestamps } from '../desktop/media-tools.mjs';
const execute = promisify(execFile);
let directory, delayed, shifted;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cutbox-offset-'));
  delayed = join(directory, 'delayed.mp4'); shifted = join(directory, 'shifted.mp4');
  await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=10:duration=3', '-itsoffset', '1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', delayed]);
  await execute('ffmpeg', ['-v', 'error', '-i', delayed, '-c', 'copy', '-output_ts_offset', '5', shifted]);
});
after(async () => { await rm(directory, { recursive: true, force: true }); });
const streams = async file => JSON.parse((await execute('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file])).stdout).streams;

test('source index and waveform share format origin with nonzero source timestamps', async () => {
  const metadata = await probeMedia(shifted);
  assert.equal(metadata.startTime, 5);
  assert.ok(metadata.duration >= 3 && metadata.duration < 3.1);
  const index = await frameTimestamps({ inputPath: shifted });
  assert.equal(index.frames[0].time, 0);
  assert.equal(index.frames[0].sourceTime, 5);
  assert.ok(Math.abs(index.frames[1].time - 0.1) < 1e-6);
  const result = await waveform({ inputPath: shifted, points: 30 });
  assert.ok(result.peaks.slice(0, 8).every(value => value < 0.001), 'first ~0.8 seconds must remain silent');
  assert.ok(result.peaks.slice(12, 25).every(value => value > 0.05), 'delayed tone must appear in its source-time buckets');
});

test('clip trim preserves delayed audio relative to video on both shifted and ordinary sources', async () => {
  for (const [name, inputPath] of [['zero', delayed], ['nonzero', shifted]]) {
    const outputPath = join(directory, `${name}-clip.mp4`);
    await exportReference({ inputPath, outputPath, start: 0.2, end: 2.5, mode: 'clip' });
    const outputStreams = await streams(outputPath);
    const video = outputStreams.find(stream => stream.codec_type === 'video');
    const audio = outputStreams.find(stream => stream.codec_type === 'audio');
    assert.ok(Math.abs(Number(video.start_time)) < 0.01);
    const relativeAudioStart = Number(audio.start_time) - Number(video.start_time);
    assert.ok(relativeAudioStart > 0.70 && relativeAudioStart < 0.85, `audio delay retained: ${relativeAudioStart}`);
    const result = await waveform({ inputPath: outputPath, points: 23 });
    assert.ok(result.peaks.slice(0, 6).every(value => value < 0.001));
    assert.ok(result.peaks.slice(10, 18).every(value => value > 0.05));
  }
});

test('audio-only reference includes leading silence instead of moving speech to zero', async () => {
  const outputPath = join(directory, 'reference.wav');
  await exportReference({ inputPath: shifted, outputPath, start: 0.2, end: 2.5, mode: 'audio' });
  const result = await waveform({ inputPath: outputPath, points: 23 });
  assert.ok(Math.abs(result.duration - 2.3) < 0.03);
  assert.ok(result.peaks.slice(0, 6).every(value => value < 0.001));
  assert.ok(result.peaks.slice(10, 18).every(value => value > 0.05));
});
