import { spawn } from 'node:child_process';
import { access, link, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const workerPath = fileURLToPath(new URL('../scripts/model_worker.py', import.meta.url));
const tasks = ['transcription', 'ocr', 'tracking', 'detection', 'pose'];
const modes = ['depth', 'pose', 'mask'];
const abortError = () => Object.assign(new Error('Model operation cancelled'), { name: 'AbortError' });
const envNames = { pythonPath: 'CUTBOX_PYTHON', depthModelPath: 'CUTBOX_DEPTH_MODEL', poseModelPath: 'CUTBOX_POSE_MODEL', maskModelPath: 'CUTBOX_MASK_MODEL', whisperModelPath: 'CUTBOX_WHISPER_MODEL', ffmpegPath: 'CUTBOX_FFMPEG', tesseractPath: 'CUTBOX_TESSERACT' };

export function modelConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid model configuration');
  const config = {};
  for (const [key, env] of Object.entries(envNames)) {
    const value = input[key] ?? process.env[env];
    if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.includes('\0'))) throw new Error(`Invalid model setting: ${key}`);
    if (value) config[key] = value;
  }
  config.pythonPath ||= process.platform === 'win32' ? 'python' : 'python3';
  config.ffmpegPath ||= 'ffmpeg';
  config.tesseractPath ||= 'tesseract';
  config.device = input.device || 'cpu';
  if (!['cpu', 'cuda', 'mps'].includes(config.device)) throw new Error('Model device must be cpu, cuda or mps');
  for (const key of ['language', 'ocrLanguage']) if (input[key] !== undefined) {
    if (input[key] === '') continue;
    if (typeof input[key] !== 'string' || !/^[a-zA-Z_+\-]{2,40}$/.test(input[key])) throw new Error(`Invalid ${key}`);
    config[key] = input[key];
  }
  return config;
}

async function runWorker(request, { signal, onProgress, timeoutMs = 3_600_000 } = {}) {
  if (signal?.aborted) throw abortError();
  const scratch = await mkdtemp(join(tmpdir(), 'cutbox-model-worker-'));
  try { return await new Promise((resolvePromise, reject) => {
    const child = spawn(request.config.pythonPath, [workerPath], {
      shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch, MPLCONFIGDIR: join(scratch, 'matplotlib'), HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONUNBUFFERED: '1' },
    });
    let buffer = '', stderr = '', result, failure, bytes = 0, timer, killTimer, timedOut = false;
    let treeTermination;
    const kill = signalName => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signalName);
        else if (process.platform === 'win32' && child.pid) {
          treeTermination ||= new Promise(done => {
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
            killer.once('error', () => { child.kill(); done(); });
            killer.once('close', done);
          });
        } else child.kill(signalName);
      } catch {}
    };
    const cancel = () => { kill('SIGTERM'); killTimer ||= setTimeout(() => kill('SIGKILL'), 1500); killTimer.unref(); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs); timer.unref();
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', cancel); };
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) { failure = new Error('Model result exceeds 32 MiB; choose a shorter range'); cancel(); return; }
      buffer += chunk.toString();
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (item.type === 'progress' && Number.isFinite(item.value)) { try { onProgress?.(Math.max(0, Math.min(1, item.value))); } catch {} }
          else if (item.type === 'result') result = item.value;
          else if (item.type === 'error') failure = new Error(String(item.message));
        } catch { failure = new Error('Invalid local model worker response'); cancel(); }
      }
    });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-12_000); });
    child.stdin.on('error', () => {});
    child.once('error', error => { cleanup(); reject(new Error(`Cannot start local model Python. Set CUTBOX_PYTHON to an installed interpreter: ${error.message}`)); });
    child.once('close', async code => {
      cleanup();
      if (treeTermination) await treeTermination;
      if (signal?.aborted) reject(abortError());
      else if (timedOut) reject(new Error('Local model operation timed out; choose a shorter range'));
      else if (failure) reject(failure);
      else if (code !== 0 || result === undefined) reject(new Error(`Local model worker failed (${code}): ${stderr.trim() || 'no result'}`));
      else resolvePromise(result);
    });
    child.stdin.end(JSON.stringify(request));
  }); } finally { await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

export async function modelStatus({ config = {}, signal } = {}) {
  const normalized = modelConfig(config);
  try { return await runWorker({ operation: 'status', config: normalized }, { signal, timeoutMs: 30_000 }); }
  catch (error) {
    if (signal?.aborted) throw error;
    return Object.fromEntries(['python', 'depth', 'pose', 'mask', 'transcription', 'ocr', 'tracking', 'detection'].map(key => [key, { available: false, reason: error.message }]));
  }
}

async function validateInput({ inputPath, start = 0, end, sampleFps = 1, region }) {
  if (typeof inputPath !== 'string' || !(await stat(inputPath)).isFile()) throw new Error('Model input must be a local media file');
  if (!Number.isFinite(start) || start < 0 || (end !== undefined && (!Number.isFinite(end) || end <= start))) throw new Error('Invalid model time range');
  if (end !== undefined && end - start > 7200) throw new Error('Analyze at most two hours per operation');
  if (!Number.isFinite(sampleFps) || sampleFps <= 0 || sampleFps > 30) throw new Error('Sample rate must be between 0 and 30 fps');
  if (region !== undefined && (!region || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(region[key])) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1.000001 || region.y + region.height > 1.000001)) throw new Error('Tracking region must be normalized inside the frame');
  return { inputPath: resolve(inputPath), start, end, sampleFps, region };
}

export async function analyzeMedia({ inputPath, task, start = 0, end, sampleFps = 1, region, config = {}, signal, onProgress }) {
  if (!tasks.includes(task)) throw new Error(`Unsupported local analysis task: ${task}`);
  if (task === 'tracking' && !region) throw new Error('Tracking requires an initial region');
  const input = await validateInput({ inputPath, start, end, sampleFps, region });
  return runWorker({ operation: 'analyze', ...input, task, config: modelConfig(config) }, { signal, onProgress });
}

export async function exportModelReference({ inputPath, outputPath, start = 0, end, mode, config = {}, signal, onProgress }) {
  if (!modes.includes(mode)) throw new Error(`Unsupported model reference mode: ${mode}`);
  if (typeof outputPath !== 'string' || extname(outputPath).toLowerCase() !== '.mp4') throw new Error('Model reference output must use .mp4');
  const input = await validateInput({ inputPath, start, end });
  const output = resolve(outputPath);
  try { await access(output); throw new Error('Output already exists; choose a new filename'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(join(dirname(output), '.cutbox-model-'));
  try {
    const result = await runWorker({ operation: 'reference', ...input, mode, outputPath: join(staging, 'reference.mp4'), config: modelConfig(config) }, { signal, onProgress });
    if (signal?.aborted) throw abortError();
    if (!(await stat(join(staging, 'reference.mp4'))).size) throw new Error('Local model produced an empty reference');
    await link(join(staging, 'reference.mp4'), output);
    return { ...result, outputPath: output };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
