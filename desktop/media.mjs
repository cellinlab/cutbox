import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat, mkdir, link, unlink, access } from 'node:fs/promises';
import { resolve, extname, basename, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const images = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff']);
const supported = new Set([...images, '.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.mpeg', '.mpg', '.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.aiff']);
const abortError = () => Object.assign(new Error('Media operation cancelled'), { name: 'AbortError' });

export function runMediaProcess(command, args, { signal, onStdout, onStdoutBuffer, onStderr, capture = true, timeoutMs = 120_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) return reject(abortError());
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timer, deadline, timedOut = false, callbackError;
    const cancel = () => {
      if (timer) return;
      child.kill('SIGTERM');
      timer = setTimeout(() => child.kill('SIGKILL'), 1500);
      timer.unref();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    if (timeoutMs > 0) {
      deadline = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
      deadline.unref();
    }
    const cleanup = () => { clearTimeout(deadline); clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    child.stdout.on('data', data => {
      if (capture) stdout = (stdout + data).slice(-4 * 1024 * 1024);
      try { onStdout?.(data.toString()); onStdoutBuffer?.(data); } catch (error) { callbackError = error; cancel(); }
    });
    child.stderr.on('data', data => {
      stderr = (stderr + data).slice(-16000);
      try { onStderr?.(data.toString()); } catch (error) { callbackError = error; cancel(); }
    });
    child.once('error', error => { cleanup(); reject(new Error(`Cannot run ${command}: ${error.message}`)); });
    child.once('close', code => {
      cleanup();
      if (signal?.aborted) reject(abortError());
      else if (callbackError) reject(callbackError);
      else if (timedOut) reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      else if (code !== 0) reject(new Error(`${command} failed (${code}): ${stderr.trim()}`));
      else resolvePromise(stdout);
    });
  });
}

const run = runMediaProcess;

export async function probeMedia(filePath, { ffprobePath = 'ffprobe', signal } = {}) {
  if (signal?.aborted) throw abortError();
  const path = resolve(filePath);
  const extension = extname(path).toLowerCase();
  if (!supported.has(extension)) throw new Error(`Unsupported media type: ${extension || '(no extension)'}`);
  if (!(await stat(path)).isFile()) throw new Error('Media path must be a regular file');
  const data = JSON.parse(await run(ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { signal }));
  const video = data.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const audio = data.streams?.find(stream => stream.codec_type === 'audio');
  const kind = images.has(extension) && video ? 'image' : video ? 'video' : audio ? 'audio' : null;
  if (!kind) throw new Error('Unsupported media: no playable video, audio or image stream');
  const duration = kind === 'image' ? 0 : Number(data.format?.duration ?? video?.duration ?? audio?.duration);
  if (!Number.isFinite(duration) || duration < 0 || (kind !== 'image' && duration === 0)) throw new Error('Media has no finite positive duration');
  // FFmpeg and desktop players apply the display matrix before annotations/crops.
  // Quarter turns exchange dimensions; coded stream dimensions would misplace boxes.
  const matrixRotation = video?.side_data_list?.find(item => Number.isFinite(Number(item.rotation)))?.rotation;
  const rotation = Number(matrixRotation ?? video?.tags?.rotate ?? 0);
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const quarterTurn = Math.abs(normalizedRotation - 90) < 0.01 || Math.abs(normalizedRotation - 270) < 0.01;
  return { kind, duration, ...(video ? { width: quarterTurn ? video.height : video.width, height: quarterTurn ? video.width : video.height } : {}) };
}

export async function importMedia(filePaths, { cacheDirectory, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', signal } = {}) {
  if (signal?.aborted) throw abortError();
  if (!Array.isArray(filePaths)) throw new Error('Expected an array of media paths');
  if (!cacheDirectory) throw new Error('A thumbnail cache directory is required');
  await mkdir(cacheDirectory, { recursive: true });
  const records = [];
  const thumbnails = [];
  try {
    for (const filePath of filePaths) {
      if (signal?.aborted) throw abortError();
      const path = resolve(filePath);
      const before = await stat(path);
      const metadata = await probeMedia(path, { ffprobePath, signal });
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path, { signal })) {
        if (signal?.aborted) throw abortError();
        hash.update(chunk);
      }
      const sha256 = hash.digest('hex');
      let thumbnailPath;
      if (metadata.kind !== 'audio') {
        thumbnailPath = resolve(cacheDirectory, `${randomUUID()}.jpg`);
        thumbnails.push(thumbnailPath);
        try {
          await run(ffmpegPath, ['-v', 'error', '-nostdin', '-n', '-i', path, '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=480:480:force_original_aspect_ratio=decrease', '-threads', '1', thumbnailPath], { signal });
        } catch (error) { await unlink(thumbnailPath).catch(() => {}); throw error; }
      }
      if (signal?.aborted) throw abortError();
      const after = await stat(path);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        if (thumbnailPath) await unlink(thumbnailPath).catch(() => {});
        throw new Error('Source media changed during import; please retry');
      }
      records.push({ id: randomUUID(), name: basename(path), kind: metadata.kind, path, sha256, size: after.size, ...metadata, ...(thumbnailPath ? { thumbnailPath } : {}), createdAt: new Date().toISOString() });
    }
    if (signal?.aborted) throw abortError();
    return records;
  } catch (error) {
    await Promise.all(thumbnails.map(path => unlink(path).catch(() => {})));
    throw error;
  }
}

export async function exportReference({ inputPath, outputPath, start, end, mode, options = {}, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', onProgress, signal }) {
  if (signal?.aborted) throw abortError();
  if (!['clip', 'edges', 'crop', 'frame', 'audio'].includes(mode)) throw new Error(`Unsupported reference mode: ${mode}`);
  if (!Number.isFinite(start) || start < 0 || (mode !== 'frame' && (!Number.isFinite(end) || end <= start))) throw new Error('Invalid reference range');
  const input = resolve(inputPath), output = resolve(outputPath);
  const extension = mode === 'frame' ? '.png' : mode === 'audio' ? '.wav' : '.mp4';
  if (extname(output).toLowerCase() !== extension) throw new Error(`Reference output must use ${extension}`);
  try { await access(output); throw new Error('Output already exists; choose a new filename'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = await probeMedia(input, { ffprobePath, signal });
  if (mode === 'audio' ? source.kind === 'image' : source.kind !== 'video' && !(mode === 'frame' && source.kind === 'image')) throw new Error(mode === 'audio' ? 'Audio export requires audio or video' : 'Reference export requires a video source');
  if (mode === 'frame' ? (source.kind === 'image' ? start !== 0 : start >= source.duration) : end > source.duration + 0.000001) throw new Error('Reference range exceeds source duration');
  if (options.width !== undefined && (!Number.isInteger(options.width) || options.width < 16 || options.width > 4096)) throw new Error('Output width must be an integer between 16 and 4096');
  if (options.fps !== undefined && (!Number.isFinite(options.fps) || options.fps < 1 || options.fps > 120)) throw new Error('Output fps must be between 1 and 120');
  if (options.keyframes !== undefined) throw new Error('Pass crop keyframes as options.track');
  const validRegion = region => region && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(region[key])) && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0 && region.x + region.width <= 1 && region.y + region.height <= 1;
  const track = options.track;
  if (track !== undefined) {
    if (mode !== 'crop' || !Array.isArray(track) || track.length < 1 || track.length > 200) throw new Error('Crop track requires 1–200 keyframes in crop mode');
    for (let index = 0; index < track.length; index++) {
      const frame = track[index];
      if (!frame || !Number.isFinite(frame.time) || frame.time < start || frame.time > end || (index && frame.time <= track[index - 1].time) || !validRegion(frame.region)) throw new Error('Invalid crop track: ordered unique source times must be inside export range and rectangles normalized');
    }
  }
  const crop = options.crop ?? track?.[0].region;
  if (mode === 'crop' && !crop) throw new Error('Crop mode requires a normalized crop rectangle');
  if (crop && !validRegion(crop)) throw new Error('Invalid normalized crop rectangle');
  const low = options.edgeLow ?? 0.1, high = options.edgeHigh ?? 0.4;
  if (![low, high].every(value => Number.isFinite(value) && value >= 0 && value <= 1) || low > high) throw new Error('Invalid edge thresholds');
  const duration = mode === 'frame' ? 0 : end - start;
  const staging = join(dirname(output), `.cutbox-${randomUUID()}${extension}`);
  let progressBuffer = '';
  const progress = value => { try { onProgress?.(value); } catch { /* Observers cannot invalidate an export. */ } };
  progress(0);
  const filters = ['setpts=PTS-STARTPTS'];
  if (track) {
    // setpts above makes filter t relative to export start; keyframe times stay source-relative.
    // A fixed output window follows interpolated region centers, without changing zoom.
    const centerExpression = (position, size) => {
      const center = frame => frame.region[position] + frame.region[size] / 2;
      let expression = String(center(track.at(-1)));
      for (let index = track.length - 2; index >= 0; index--) {
        const left = track[index], right = track[index + 1];
        const fraction = `(t-${left.time - start})/${right.time - left.time}`;
        const interpolation = `${center(left)}+(${center(right) - center(left)})*${fraction}`;
        expression = `if(lt(t,${right.time - start}),${interpolation},${expression})`;
      }
      return `if(lte(t,${track[0].time - start}),${center(track[0])},${expression})`;
    };
    filters.push(`crop=w=iw*${crop.width}:h=ih*${crop.height}:x='min(max(iw*(${centerExpression('x', 'width')})-ow/2,0),iw-ow)':y='min(max(ih*(${centerExpression('y', 'height')})-oh/2,0),ih-oh)'`);
  } else if (crop) filters.push(`crop=iw*${crop.width}:ih*${crop.height}:iw*${crop.x}:ih*${crop.y}`);
  if (mode === 'edges') filters.push('format=gray', `edgedetect=low=${low}:high=${high}`);
  if (options.width) filters.push(`scale=${options.width}:-2`);
  if (options.fps && mode !== 'frame') filters.push(`fps=${options.fps}`);
  if (mode !== 'frame') filters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
  const args = ['-v', 'error', '-nostdin', '-n', '-ss', String(start), '-i', input];
  if (mode !== 'frame') args.push('-t', String(duration));
  if (mode === 'audio') args.push('-map', '0:a:0', '-vn', '-af', 'asetpts=PTS-STARTPTS', '-c:a', 'pcm_s24le');
  else {
    args.push('-map', '0:v:0', '-vf', filters.join(','));
    if (mode === 'frame') args.push('-frames:v', '1', '-an', '-c:v', 'png');
    else {
      args.push(...(['clip', 'crop'].includes(mode) ? ['-map', '0:a:0?', '-af', 'asetpts=PTS-STARTPTS', '-c:a', 'aac'] : ['-an']));
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-fps_mode', 'vfr', '-movflags', '+faststart');
    }
  }
  args.push('-threads', '2', '-progress', 'pipe:1', '-nostats', staging);
  try {
    await run(ffmpegPath, args, {
      signal, timeoutMs: 0,
      onStdout(chunk) {
        progressBuffer += chunk;
        const lines = progressBuffer.split('\n'); progressBuffer = lines.pop();
        for (const line of lines) if (line.startsWith('out_time_us=')) {
          const seconds = Number(line.slice(12)) / 1e6;
          if (Number.isFinite(seconds) && duration > 0) progress(Math.max(0, Math.min(0.99, seconds / duration)));
        }
      },
    });
    if (signal?.aborted) throw abortError();
    const result = await probeMedia(staging, { ffprobePath, signal });
    const expectedKind = mode === 'frame' ? 'image' : mode === 'audio' ? 'audio' : 'video';
    if (result.kind !== expectedKind || (expectedKind !== 'image' && !result.duration)) throw new Error('Export validation failed');
    if (signal?.aborted) throw abortError();
    await link(staging, output);
    progress(1);
    return { outputPath: output, duration: result.duration, mode };
  } finally { await unlink(staging).catch(() => {}); }
}

export async function capabilities({ ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe' } = {}) {
  const [ffmpeg, ffprobe] = await Promise.all([run(ffmpegPath, ['-version']).then(() => true, () => false), run(ffprobePath, ['-version']).then(() => true, () => false)]);
  const encoders = ffmpeg ? await run(ffmpegPath, ['-hide_banner', '-encoders']).catch(() => '') : '';
  const ready = ffmpeg && ffprobe && /\blibx264\b/.test(encoders);
  return { ffmpeg, ffprobe, clip: ready, edges: ready, crop: ready, frame: ffmpeg && ffprobe, audio: ffmpeg && ffprobe, scenes: ffmpeg && ffprobe, waveform: ffmpeg && ffprobe, proxy: ready, depth: { available: false, reason: 'Local depth model adapter and weights are not installed.' }, pose: { available: false, reason: 'Local pose model adapter and weights are not installed.' }, mask: { available: false, reason: 'Local segmentation model adapter and weights are not installed.' } };
}
