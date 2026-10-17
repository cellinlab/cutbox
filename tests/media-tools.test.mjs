import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { probeMedia, exportReference } from '../desktop/media.mjs';
import { detectScenes, waveform, frameTimestamps, createProxy } from '../desktop/media-tools.mjs';
const execute = promisify(execFile);
let directory, source, variable;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cutbox-tools-'));
  source = join(directory, 'cuts.mp4');
  await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:size=160x120:rate=10:duration=1', '-f', 'lavfi', '-i', 'color=white:size=160x120:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', source]);
  variable = join(directory, 'variable.mp4');
  await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=10:duration=2', '-vf', "setpts='if(lt(N,10),N,N*2-10)/(10*TB)'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-threads', '1', variable]);
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

test('scene detector finds actual hard cut and returns reviewable shot suggestions', async () => {
  const result = await detectScenes({ inputPath: source, mediaId: 'source-id' });
  assert.equal(result.cuts.length, 1);
  assert.ok(Math.abs(result.cuts[0].time - 1) < 0.01);
  assert.equal(result.suggestions.length, 2);
  assert.equal(result.suggestions[0].start, 0);
  assert.equal(result.suggestions[1].end, 2);
  assert.equal(result.suggestions[1].epistemic, 'interpreted');
  assert.equal(result.suggestions[1].mediaId, 'source-id');
  assert.equal(result.suggestions[1].confidence, null);
  assert.equal(result.suggestions[1].values.sceneScore, result.cuts[0].score);
  assert.equal(result.suggestions[0].values, undefined);
});

test('waveform streams bounded peak buckets from actual audio', async () => {
  const result = await waveform({ inputPath: source, points: 20 });
  assert.equal(result.peaks.length, 20);
  assert.ok(result.peaks.every(value => value > 0.05 && value <= 1));
  assert.equal(result.duration, 2);
  await assert.rejects(waveform({ inputPath: variable }), /failed/);
});

test('frame index retains nonuniform VFR timestamps', async () => {
  const { frames } = await frameTimestamps({ inputPath: variable });
  const count = await execute('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', variable]);
  assert.equal(frames.length, Number(count.stdout.trim()));
  assert.ok(frames.length >= 19);
  assert.ok(Math.abs(frames[1].time - frames[0].time - 0.1) < 0.001);
  assert.ok(Math.abs(frames[15].time - frames[14].time - 0.2) < 0.001);
  assert.equal(frames.at(-1).index, frames.length - 1);
});

test('crop, PNG frame, WAV audio and scaled proxy are real playable outputs', async () => {
  const crop = join(directory, 'crop.mp4');
  await exportReference({ inputPath: source, outputPath: crop, start: 0, end: 1, mode: 'crop', options: { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } } });
  assert.equal((await probeMedia(crop)).width, 80);
  const frame = join(directory, 'frame.png');
  await exportReference({ inputPath: source, outputPath: frame, start: 1, mode: 'frame', options: { width: 64 } });
  assert.equal((await probeMedia(frame)).kind, 'image');
  assert.equal((await probeMedia(frame)).width, 64);
  const audio = join(directory, 'audio.wav');
  await exportReference({ inputPath: source, outputPath: audio, start: 0.5, end: 1.5, mode: 'audio' });
  assert.equal((await probeMedia(audio)).kind, 'audio');
  assert.equal((await probeMedia(audio)).duration, 1);
  const proxy = join(directory, 'proxy.mp4');
  await createProxy({ inputPath: variable, outputPath: proxy, width: 80, fps: 5 });
  assert.equal((await probeMedia(proxy)).width, 80);
  const { frames } = await frameTimestamps({ inputPath: proxy });
  assert.ok(Math.abs(frames[1].time - frames[0].time - 0.2) < 0.001);
});

test('new options reject invalid geometry and rates, cancelled analysis yields no files', async () => {
  const base = { inputPath: source, outputPath: join(directory, 'invalid.mp4'), start: 0, end: 1, mode: 'crop' };
  await assert.rejects(exportReference(base), /requires.*rectangle/);
  await assert.rejects(exportReference({ ...base, options: { crop: { x: 0.5, y: 0, width: 0.8, height: 1 } } }), /Invalid normalized/);
  await assert.rejects(exportReference({ ...base, mode: 'clip', options: { width: 1 } }), /width/);
  await assert.rejects(exportReference({ ...base, mode: 'edges', options: { edgeLow: 0.9, edgeHigh: 0.1 } }), /threshold/);
  const before = await readdir(directory);
  await assert.rejects(detectScenes({ inputPath: source, signal: AbortSignal.abort() }), { name: 'AbortError' });
  await assert.rejects(waveform({ inputPath: source, points: 100000 }), /points/);
  assert.deepEqual(await readdir(directory), before);
});

test('tracked crop follows interpolated centers in source time and holds edge keyframes', async () => {
  const split = join(directory, 'split.mp4');
  await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:size=160x120:rate=20:duration=3', '-vf', 'drawbox=x=80:y=0:w=80:h=120:color=white:t=fill', '-c:v', 'libx264', '-threads', '1', split]);
  const track = [
    { time: 1.5, region: { x: 0, y: 0, width: 0.5, height: 1 } },
    { time: 2, region: { x: 0.5, y: 0, width: 0.5, height: 1 } },
  ];
  const moving = join(directory, 'moving.mp4'), fixed = join(directory, 'fixed.mp4');
  const base = { inputPath: split, start: 1, end: 2.5, mode: 'crop' };
  await exportReference({ ...base, outputPath: moving, options: { track } });
  await exportReference({ ...base, outputPath: fixed, options: { crop: track[0].region } });
  const average = async (file, time) => {
    const { stdout } = await execute('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
    assert.equal(stdout.length, 80 * 120);
    return stdout.reduce((sum, value) => sum + value, 0) / stdout.length;
  };
  assert.ok(await average(moving, 0.1) < 5, 'hold first center before first keyframe');
  const midpoint = await average(moving, 0.75);
  assert.ok(midpoint > 80 && midpoint < 180, 'linearly interpolate center at source time 1.75');
  assert.ok(await average(moving, 1.25) > 245, 'hold last center after final keyframe');
  assert.ok(await average(fixed, 1.25) < 5, 'static reference remains on black half');
  for (const invalid of [[], [track[1], track[0]], [track[0], track[0]], [{ ...track[0], time: 0.5 }], [{ ...track[0], region: { x: -1, y: 0, width: 0.5, height: 1 } }]]) {
    await assert.rejects(exportReference({ ...base, outputPath: join(directory, 'bad-track.mp4'), options: { track: invalid } }), /track/i);
  }
});

test('quarter-turn video dimensions match autorotated PNG and normalized crop output', async () => {
  const rotated = join(directory, 'rotated.mp4');
  try {
    await execute('ffmpeg', ['-v', 'error', '-display_rotation', '90', '-i', source, '-c', 'copy', rotated]);
  } catch {
    // Older FFmpeg releases set stream rotation through the rotate metadata tag.
    await execute('ffmpeg', ['-v', 'error', '-i', source, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', '-y', rotated]);
  }
  const raw = JSON.parse((await execute('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', rotated])).stdout).streams[0];
  assert.equal(raw.width, 160);
  assert.equal(raw.height, 120);
  assert.equal(Math.abs(Number(raw.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? raw.tags?.rotate)), 90);
  const displayed = await probeMedia(rotated);
  assert.equal(displayed.width, 120);
  assert.equal(displayed.height, 160);
  const frame = join(directory, 'rotated-frame.png');
  await exportReference({ inputPath: rotated, outputPath: frame, start: 0.5, mode: 'frame' });
  assert.equal((await probeMedia(frame)).width, 120);
  assert.equal((await probeMedia(frame)).height, 160);
  const crop = join(directory, 'rotated-crop.mp4');
  await exportReference({ inputPath: rotated, outputPath: crop, start: 0, end: 1, mode: 'crop', options: { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } } });
  assert.equal((await probeMedia(crop)).width, 60);
  assert.equal((await probeMedia(crop)).height, 80);
});
