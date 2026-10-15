import { app, BrowserWindow, ipcMain, dialog, protocol, Menu } from 'electron';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, extname, basename } from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
if (process.env.CUTBOX_DATA_DIR) app.setPath('userData', process.env.CUTBOX_DATA_DIR);
protocol.registerSchemesAsPrivileged([{ scheme: 'cutbox-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
let window, worker, closed = false, workerError;
const pending = new Map(), jobs = new Map();
function backend(method, input, id = randomUUID()) {
  if (workerError) return Promise.reject(workerError);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, input });
  });
}
function emit(job) {
  jobs.set(job.id, job);
  if (window && !window.isDestroyed()) window.webContents.send('cutbox:job', job);
}
async function task(label, method, input) {
  const id = randomUUID(), job = { id, label, status: 'running', progress: 0, cancellable: method === 'exportReference' };
  emit(job);
  try {
    const result = await backend(method, input, id);
    emit({ ...job, status: 'succeeded', progress: 1, path: result?.path, error: result?.warning });
    return result;
  } catch (error) {
    emit({ ...job, status: /cancelled/i.test(error.message) ? 'cancelled' : 'failed', error: error.message });
    throw error;
  }
}
function trusted(event) {
  return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame.url.split('#')[0] === pathToFileURL(join(projectRoot, 'dist/index.html')).href;
}
function handle(name, fn) {
  ipcMain.handle(`cutbox:${name}`, async (event, input) => {
    if (!trusted(event)) return { ok: false, error: 'Untrusted window' };
    try { return { ok: true, value: await fn(input) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
}
const mime = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
async function mediaResponse(request) {
  try {
    const url = new URL(request.url);
    if (url.hostname !== 'asset' || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 });
    const id = decodeURIComponent(url.pathname.slice(1));
    const record = await backend('media', { id, thumbnail: url.searchParams.get('kind') === 'thumbnail' });
    if (!record.path) return new Response(null, { status: 404 });
    const info = await stat(record.path);
    if (!info.isFile()) return new Response(null, { status: 404 });
    const headers = { 'Content-Type': mime[extname(record.path).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    let start = 0, end = info.size - 1, status = 200;
    const range = request.headers.get('Range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
      if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = String(Math.max(0, end - start + 1));
    const body = request.method === 'HEAD' || !info.size ? null : Readable.toWeb(createReadStream(record.path, { start, end }));
    return new Response(body, { status, headers });
  } catch { return new Response(null, { status: 404 }); }
}

app.whenReady().then(() => {
worker = new Worker(new URL('./backend-worker.mjs', import.meta.url), { workerData: { directory: app.getPath('userData'), ffmpegPath: process.env.CUTBOX_FFMPEG, ffprobePath: process.env.CUTBOX_FFPROBE } });
worker.on('message', message => {
  if (message.type === 'progress') {
    const job = jobs.get(message.id); if (job) emit({ ...job, progress: message.progress });
    return;
  }
  const operation = pending.get(message.id);
  if (operation) { pending.delete(message.id); message.error ? operation.reject(new Error(message.error)) : operation.resolve(message.result); }
});
worker.on('error', error => {
  workerError = error;
  for (const operation of pending.values()) operation.reject(error);
  pending.clear();
  if (window && !window.isDestroyed()) dialog.showErrorBox('CutBox 后台错误', error.message);
});
worker.on('exit', code => {
  workerError ||= new Error(`后台进程已退出 (${code})，请重启 CutBox。`);
  for (const operation of pending.values()) operation.reject(workerError);
  pending.clear();
});
protocol.handle('cutbox-media', mediaResponse);
for (const name of ['snapshot', 'capabilities', 'saveEntity', 'deleteEntity', 'saveAnnotation', 'deleteAnnotation', 'saveCollection']) handle(name, input => backend(name, input));
handle('importMedia', async () => {
  const result = await dialog.showOpenDialog(window, { title: '导入本地素材', properties: ['openFile', 'multiSelections'], filters: [{ name: '影音与图片', extensions: ['mp4','mov','mkv','webm','avi','wav','mp3','m4a','flac','ogg','png','jpg','jpeg','webp'] }] });
  if (result.canceled) return backend('snapshot');
  return task('导入素材', 'importMedia', result.filePaths);
});
handle('exportReference', async input => {
  if (!input || !['clip', 'edges'].includes(input.mode)) throw new Error('不支持的参考配方');
  const result = await dialog.showSaveDialog(window, { title: input.mode === 'edges' ? '导出边缘参考' : '导出片段', defaultPath: `cutbox-${input.mode}.mp4`, filters: [{ name: 'MP4', extensions: ['mp4'] }] });
  if (result.canceled || !result.filePath) return { cancelled: true };
  return task(input.mode === 'edges' ? '生成边缘参考' : '导出片段', 'exportReference', { mediaId: input.mediaId, start: input.start, end: input.end, mode: input.mode, outputPath: result.filePath });
});
handle('exportPackage', async input => {
  if (!input || typeof input.password !== 'string' || input.password.length < 12) throw new Error('请使用至少12字符的口令。');
  const result = await dialog.showOpenDialog(window, { title: '选择素材包保存位置（会新建子文件夹）', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled) return { cancelled: true };
  const directory = join(result.filePaths[0], `CutBox-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`);
  return task('导出素材包', 'exportPackage', { directory, password: input.password, entityIds: input.entityIds, collectionId: input.collectionId });
});
handle('importPackage', async input => {
  if (!input || typeof input.password !== 'string') throw new Error('需要口令');
  const result = await dialog.showOpenDialog(window, { title: '导入 CBox 素材包', properties: ['openFile'], filters: [{ name: 'CBox', extensions: ['cbox'] }] });
  if (result.canceled) return backend('snapshot');
  return task('导入素材包', 'importPackage', { path: result.filePaths[0], password: input.password });
});
handle('cancelJob', async id => { if (jobs.get(id)?.status === 'running') return backend('cancel', id); return false; });
Menu.setApplicationMenu(null);
function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 1000, minWidth: 980, minHeight: 700, title: 'CutBox', backgroundColor: '#17191b', webPreferences: { preload: join(projectRoot, 'desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
  window.loadFile(join(projectRoot, 'dist/index.html'));
}
createWindow();
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (closed) return;
  event.preventDefault(); closed = true;
  backend('close').catch(() => {}).finally(() => worker.terminate().finally(() => app.quit()));
});

});
