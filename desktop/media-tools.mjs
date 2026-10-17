import { probeMedia, exportReference, runMediaProcess } from './media.mjs';

const notify = (callback, value) => { try { callback?.(value); } catch { /* UI observers are isolated. */ } };
function lines(callback) {
  let pending = '';
  const consume = chunk => {
    pending += chunk;
    const complete = pending.split('\n'); pending = complete.pop();
    for (const line of complete) callback(line.trim());
  };
  consume.flush = () => { if (pending.trim()) callback(pending.trim()); pending = ''; };
  return consume;
}
function progressParser(duration, onProgress) {
  return lines(line => {
    if (line.startsWith('out_time_us=')) {
      const value = Number(line.slice(12)) / 1e6 / duration;
      if (Number.isFinite(value)) notify(onProgress, Math.max(0, Math.min(0.99, value)));
    }
  });
}

export async function detectScenes({ inputPath, mediaId, threshold = 0.3, minDuration = 0.25, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', signal, onProgress }) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw new Error('Scene threshold must be between 0 and 1');
  if (!Number.isFinite(minDuration) || minDuration < 0) throw new Error('Invalid minimum shot duration');
  const source = await probeMedia(inputPath, { ffprobePath, signal });
  if (source.kind !== 'video') throw new Error('Scene detection requires video');
  const cuts = [];
  let time;
  notify(onProgress, 0);
  await runMediaProcess(ffmpegPath, ['-v', 'error', '-nostdin', '-i', inputPath, '-an', '-vf', `select='gt(scene,${threshold})',metadata=print:file=-`, '-vsync', '0', '-f', 'null', '-', '-progress', 'pipe:2'], {
    signal, timeoutMs: 0, capture: false,
    onStdout: lines(line => {
      const match = line.match(/pts_time:([\d.e+-]+)/);
      if (match) time = Number(match[1]);
      if (line.startsWith('lavfi.scene_score=') && Number.isFinite(time)) {
        const score = Number(line.split('=')[1]);
        if (time - (cuts.at(-1)?.time ?? 0) >= minDuration && source.duration - time >= minDuration) cuts.push({ time, score });
        if (cuts.length > 100000) throw new Error('Too many shot cuts; choose a higher threshold');
      }
    }), onStderr: progressParser(source.duration, onProgress),
  });
  const boundaries = [0, ...cuts.map(cut => cut.time), source.duration];
  const suggestions = boundaries.slice(0, -1).map((start, index) => ({ mediaId, start, end: boundaries[index + 1], label: `镜头 ${index + 1}`, category: 'shot', epistemic: 'interpreted', confidence: null, ...(index ? { values: { sceneScore: cuts[index - 1].score } } : {}), tags: ['自动建议', '待审核'], notes: `FFmpeg scene score threshold ${threshold}; unreviewed cut proposal, score is not calibrated confidence.` }));
  notify(onProgress, 1);
  return { cuts, suggestions };
}

export async function waveform({ inputPath, points = 1000, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', signal, onProgress }) {
  if (!Number.isInteger(points) || points < 1 || points > 20000) throw new Error('Waveform points must be an integer between 1 and 20000');
  const source = await probeMedia(inputPath, { ffprobePath, signal });
  if (source.kind === 'image') throw new Error('Waveform requires audio');
  const sampleRate = 8000;
  const peaks = new Array(points).fill(0);
  let remainder = Buffer.alloc(0), sample = 0;
  const bucketSize = Math.max(1, source.duration * sampleRate / points);
  notify(onProgress, 0);
  await runMediaProcess(ffmpegPath, ['-v', 'error', '-nostdin', '-i', inputPath, '-map', '0:a:0', '-vn', '-af', `aresample=${sampleRate}:async=1:first_pts=0`, '-ac', '1', '-ar', String(sampleRate), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1', '-progress', 'pipe:2'], {
    signal, timeoutMs: 0, capture: false,
    onStdoutBuffer(chunk) {
      const bytes = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
      let offset = 0;
      for (; offset + 4 <= bytes.length; offset += 4) {
        const value = Math.abs(bytes.readFloatLE(offset));
        const bucket = Math.min(points - 1, Math.floor(sample++ / bucketSize));
        if (Number.isFinite(value)) peaks[bucket] = Math.min(1, Math.max(peaks[bucket], value));
      }
      remainder = Buffer.from(bytes.subarray(offset));
    }, onStderr: progressParser(source.duration, onProgress),
  });
  notify(onProgress, 1);
  return { duration: source.duration, sampleRate, peaks };
}

export async function frameTimestamps({ inputPath, ffprobePath = 'ffprobe', signal, onProgress }) {
  const source = await probeMedia(inputPath, { ffprobePath, signal });
  if (source.kind !== 'video') throw new Error('Frame timestamps require video');
  const frames = [];
  notify(onProgress, 0);
  const consume = lines(line => {
      const fields = Object.fromEntries(line.split('|').filter(item => item.includes('=')).map(item => item.split('=')));
      if (!fields.best_effort_timestamp_time) return;
      const sourceTime = Number(fields.best_effort_timestamp_time), time = sourceTime - source.startTime, duration = Number(fields.pkt_duration_time);
      if (!Number.isFinite(time)) return;
      if (frames.length >= 1_000_000) throw new Error('Frame index exceeds one million frames; split the source first');
      frames.push({ index: frames.length, time, sourceTime, ...(Number.isFinite(duration) ? { duration } : {}) });
      if (frames.length % 500 === 0) notify(onProgress, Math.min(0.99, Math.max(0, time / source.duration)));
    });
  await runMediaProcess(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,pkt_duration_time', '-of', 'compact=p=0', inputPath], { signal, timeoutMs: 0, capture: false, onStdout: consume });
  consume.flush();
  notify(onProgress, 1);
  return { frames, timeBase: 'seconds', source: 'best_effort_timestamp_time', startTime: source.startTime };
}

export async function createProxy({ inputPath, outputPath, width = 960, fps, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', signal, onProgress }) {
  const source = await probeMedia(inputPath, { ffprobePath, signal });
  if (source.kind !== 'video') throw new Error('Proxy creation requires video');
  return exportReference({ inputPath, outputPath, start: 0, end: source.duration, mode: 'clip', options: { width, fps }, ffmpegPath, ffprobePath, signal, onProgress });
}
