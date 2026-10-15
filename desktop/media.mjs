import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat, mkdir, link, unlink, access } from 'node:fs/promises';
import { resolve, extname, basename, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const images = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff']);
const supported = new Set([...images, '.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.mpeg', '.mpg', '.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.aiff']);
const abortError = () => Object.assign(new Error('Media operation cancelled'), { name: 'AbortError' });

function run(command, args, { signal, onStdout, timeoutMs = 120_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) return reject(abortError());
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timer, deadline, timedOut = false;
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
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-4 * 1024 * 1024); onStdout?.(data.toString()); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
    child.once('error', error => { cleanup(); reject(new Error(`Cannot run ${command}: ${error.message}`)); });
    child.once('close', code => {
      cleanup();
      if (signal?.aborted) reject(abortError());
      else if (timedOut) reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      else if (code !== 0) reject(new Error(`${command} failed (${code}): ${stderr.trim()}`));
      else resolvePromise(stdout);
    });
  });
}

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
  return { kind, duration, ...(video ? { width: video.width, height: video.height } : {}) };
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

export async function exportReference({ inputPath, outputPath, start, end, mode, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', onProgress, signal }) {
  if (signal?.aborted) throw abortError();
  if (!['clip', 'edges'].includes(mode)) throw new Error(`Unsupported reference mode: ${mode}`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('Invalid reference range');
  const input = resolve(inputPath), output = resolve(outputPath);
  if (extname(output).toLowerCase() !== '.mp4') throw new Error('Reference output must use .mp4');
  try { await access(output); throw new Error('Output already exists; choose a new filename'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = await probeMedia(input, { ffprobePath, signal });
  if (source.kind !== 'video') throw new Error('Reference export requires a video source');
  if (end > source.duration + 0.000001) throw new Error('Reference range exceeds source duration');
  const duration = end - start;
  const staging = join(dirname(output), `.cutbox-${randomUUID()}.mp4`);
  let progressBuffer = '';
  const progress = value => { try { onProgress?.(value); } catch { /* Observers cannot invalidate an export. */ } };
  progress(0);
  const filters = ['setpts=PTS-STARTPTS', ...(mode === 'edges' ? ['format=gray', 'edgedetect=low=0.1:high=0.4'] : []), 'pad=ceil(iw/2)*2:ceil(ih/2)*2'];
  try {
    await run(ffmpegPath, ['-v', 'error', '-nostdin', '-n', '-ss', String(start), '-i', input, '-t', String(duration), '-map', '0:v:0', ...(mode === 'clip' ? ['-map', '0:a:0?', '-af', 'asetpts=PTS-STARTPTS', '-c:a', 'aac'] : ['-an']), '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-threads', '2', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', staging], {
      signal,
      timeoutMs: 0,
      onStdout(chunk) {
        progressBuffer += chunk;
        const lines = progressBuffer.split('\n'); progressBuffer = lines.pop();
        for (const line of lines) if (line.startsWith('out_time_us=')) {
          const seconds = Number(line.slice(12)) / 1e6;
          if (Number.isFinite(seconds)) progress(Math.max(0, Math.min(0.99, seconds / duration)));
        }
      },
    });
    if (signal?.aborted) throw abortError();
    const result = await probeMedia(staging, { ffprobePath, signal });
    if (result.kind !== 'video' || !result.duration) throw new Error('Export validation failed');
    if (signal?.aborted) throw abortError();
    // Both files share a filesystem. link atomically refuses an existing destination.
    await link(staging, output);
    progress(1);
    return { outputPath: output, duration: result.duration, mode };
  } finally { await unlink(staging).catch(() => {}); }
}

export async function capabilities({ ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe' } = {}) {
  const [ffmpeg, ffprobe] = await Promise.all([run(ffmpegPath, ['-version']).then(() => true, () => false), run(ffprobePath, ['-version']).then(() => true, () => false)]);
  const encoders = ffmpeg ? await run(ffmpegPath, ['-hide_banner', '-encoders']).catch(() => '') : '';
  const ready = ffmpeg && ffprobe && /\blibx264\b/.test(encoders);
  return { ffmpeg, ffprobe, clip: ready, edges: ready, depth: { available: false, reason: 'Local depth model adapter and weights are not installed.' }, pose: { available: false, reason: 'Local pose model adapter and weights are not installed.' }, mask: { available: false, reason: 'Local segmentation model adapter and weights are not installed.' } };
}
