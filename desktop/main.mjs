import { app, BrowserWindow, ipcMain, dialog, protocol, Menu } from 'electron';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, extname, basename } from 'node:path';
import { createReadStream } from 'node:fs';
import { stat, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
if (process.env.CUTBOX_DATA_DIR) app.setPath('userData', process.env.CUTBOX_DATA_DIR);
protocol.registerSchemesAsPrivileged([{ scheme: 'cutbox-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
let window, worker, closed = false, quitting = false, workerError;
const pending = new Map(), jobs = new Map();
let jobsPath, jobSave = Promise.resolve();
function persistJobs() {
  if (!jobsPath) return;
  const data = JSON.stringify([...jobs.values()].slice(-100));
  jobSave = jobSave.catch(() => {}).then(async () => { await writeFile(`${jobsPath}.tmp`, data, { mode: 0o600 }); await rename(`${jobsPath}.tmp`, jobsPath); });
}
function backend(method, input, id = randomUUID()) {
  if (workerError) return Promise.reject(workerError);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, input });
  });
}
function emit(job) {
  jobs.set(job.id, { ...job, updatedAt: new Date().toISOString() });
  if (jobs.size > 100) { const oldest = [...jobs.values()].find(item => item.status !== 'running'); if (oldest) jobs.delete(oldest.id); }
  if (job.status !== 'running' || job.progress === 0) persistJobs();
  if (window && !window.isDestroyed()) window.webContents.send('cutbox:job', job);
}
async function task(label, method, input) {
  const id = randomUUID(), job = { id, label, status: 'running', progress: 0, cancellable: true };
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
    const record = await backend('media', { id, thumbnail: url.searchParams.get('kind') === 'thumbnail', original: url.searchParams.get('kind') === 'original' });
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

app.whenReady().then(async () => {
await mkdir(app.getPath('userData'), { recursive: true });
jobsPath = join(app.getPath('userData'), 'jobs.json');
try {
  const previous = JSON.parse(await readFile(jobsPath, 'utf8'));
  if (Array.isArray(previous)) for (const item of previous.slice(-100)) if (typeof item.id === 'string') jobs.set(item.id, item.status === 'running' ? { ...item, status: 'failed', error: '上次进程中断；请重新运行任务。', cancellable: false } : item);
} catch (error) { if (error.code !== 'ENOENT') console.warn('任务历史未能读取'); }
persistJobs();
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
for (const name of ['snapshot','capabilities','saveEntity','deleteEntity','saveAnnotation','saveAnnotations','deleteAnnotation','saveCollection','deleteCollection','saveTemplate','deleteTemplate','saveEvent','deleteEvent','saveRelation','deleteRelation','saveStory','deleteStory','undo','redo','history','updateMedia','modelStatus']) handle(name, input => backend(name, input));
handle('importMedia', async () => {
  const result = await dialog.showOpenDialog(window, { title: '导入本地素材', properties: ['openFile', 'multiSelections'], filters: [{ name: '影音与图片', extensions: ['mp4','mov','mkv','webm','avi','wav','mp3','m4a','flac','ogg','png','jpg','jpeg','webp'] }] });
  if (result.canceled) return backend('snapshot');
  return task('导入素材', 'importMedia', result.filePaths);
});
handle('exportReference', async input => {
  if (!input || !['clip','edges','crop','frame','audio','depth','pose','mask'].includes(input.mode)) throw new Error('不支持的参考配方');
  const extension = input.mode === 'frame' ? 'png' : input.mode === 'audio' ? 'wav' : 'mp4';
  const result = await dialog.showSaveDialog(window, { title: '导出参考素材', defaultPath: `cutbox-${input.mode}.${extension}`, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
  if (result.canceled || !result.filePath) return { cancelled: true };
  return task(input.mode === 'edges' ? '生成边缘参考' : '导出片段', 'exportReference', { mediaId: input.mediaId, start: input.start, end: input.end, mode: input.mode, options: input.options, outputPath: result.filePath });
});
handle('exportPackage', async input => {
  if (!input || typeof input.password !== 'string' || input.password.length < 12) throw new Error('请使用至少12字符的口令。');
  const result = await dialog.showOpenDialog(window, { title: '选择素材包保存位置（会新建子文件夹）', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled) return { cancelled: true };
  const directory = join(result.filePaths[0], `CutBox-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`);
  return task('导出素材包', 'exportPackage', { directory, password: input.password, entityIds: input.entityIds, collectionId: input.collectionId, profile: input.profile });
});
handle('importPackage', async input => {
  if (!input || typeof input.password !== 'string') throw new Error('需要口令');
  const result = await dialog.showOpenDialog(window, { title: '导入 CBox 素材包', properties: ['openFile'], filters: [{ name: 'CBox', extensions: ['cbox'] }] });
  if (result.canceled) return backend('snapshot');
  return task('导入素材包', 'importPackage', { path: result.filePaths[0], password: input.password });
});
handle('jobs', () => [...jobs.values()].reverse());
for(const name of ['saveProduction','deleteProduction','productionAudit','draftShotPrompt','inspectDataset','discoverAnnotations','installProductionTemplates']) handle(name,input=>backend(name,input));
handle('importSubtitles',async input=>{
  const result=await dialog.showOpenDialog(window,{title:'导入 UTF-8 字幕（SRT / WebVTT）',properties:['openFile'],filters:[{name:'Subtitles',extensions:['srt','vtt']}]});
  if(result.canceled)return {snapshot:await backend('snapshot'),count:0,warnings:[],cancelled:true};
  return task('导入字幕','importSubtitles',{mediaId:input.mediaId,offset:input.offset,path:result.filePaths[0]});
});
handle('exportProduction',async input=>{
  const result=await dialog.showOpenDialog(window,{title:'选择创作资料包保存位置',properties:['openDirectory','createDirectory']});
  if(result.canceled)return {cancelled:true};
  return task('导出创作资料包','exportProduction',{productionId:input.productionId,includeClips:input.includeClips===true,cropRegions:input.cropRegions===true,directory:join(result.filePaths[0],`CutBox-production-${Date.now()}-${randomUUID().slice(0,6)}`)});
});
handle('exportTrainingDataset',async input=>{
  const result=await dialog.showOpenDialog(window,{title:'选择训练数据准备包保存位置',properties:['openDirectory','createDirectory']});
  if(result.canceled)return {cancelled:true};
  return task('准备训练数据集','exportTrainingDataset',{collectionId:input.collectionId,acceptedOnly:input.acceptedOnly,minConfidence:input.minConfidence,requireObserved:input.requireObserved,groupBy:input.groupBy,seed:input.seed,ratios:input.ratios,profile:input.profile,directory:join(result.filePaths[0],`CutBox-training-${Date.now()}-${randomUUID().slice(0,6)}`)});
});
handle('searchAnnotations', input => backend('searchAnnotations', input));
handle('findSimilar', input => task('寻找视觉相似候选', 'findSimilar', input));
handle('checkMedia', () => task('校验素材', 'checkMedia'));
handle('analyzeMedia', input => task('分析素材', 'analyzeMedia', { mediaId: input.mediaId, kind: input.kind, options: input.options }));
handle('createProxy', id => task('生成播放代理', 'createProxy', id));
handle('relinkMedia', async id => {
  const result = await dialog.showOpenDialog(window, { title: '选择原素材的新位置（内容必须一致）', properties: ['openFile'] });
  return result.canceled ? backend('snapshot') : task('重新定位素材', 'relinkMedia', { id, path: result.filePaths[0] });
});
handle('backupProject', async () => {
  const result = await dialog.showOpenDialog(window, { title: '选择项目备份位置（明文媒体和描述）', properties: ['openDirectory','createDirectory'] });
  if (result.canceled) return { cancelled: true };
  return task('备份项目', 'backupProject', { directory: join(result.filePaths[0], `CutBox-backup-${Date.now()}-${randomUUID().slice(0,6)}`) });
});
handle('restoreProject', async () => {
  const result = await dialog.showOpenDialog(window, { title: '选择 project.cutbox-backup.json', properties: ['openFile'], filters: [{ name: 'CutBox Backup', extensions: ['json'] }] });
  if (result.canceled) return backend('snapshot');
  const confirm = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消','恢复项目'], defaultId: 0, cancelId: 0, message: '用备份替换当前项目？', detail: '恢复前会校验媒体与引用。当前元数据保留在撤销历史中，原始素材不会删除。' });
  return confirm.response !== 1 ? backend('snapshot') : task('恢复项目', 'restoreProject', { path: result.filePaths[0] });
});
handle('modelConfigure', async input => {
  if (['device','language','ocrLanguage'].includes(input?.key)) return backend('modelConfigure', { key: input.key, value: input.value });
  const directories = ['whisperModelPath'];
  if (!['pythonPath','depthModelPath','poseModelPath','maskModelPath','whisperModelPath','tesseractPath'].includes(input?.key)) throw new Error('无效设置');
  const result = await dialog.showOpenDialog(window, { title: '选择本地模型或工具', properties: [input.directory || directories.includes(input.key) ? 'openDirectory' : 'openFile'] });
  return result.canceled ? backend('modelStatus') : backend('modelConfigure', { key: input.key, value: result.filePaths[0] });
});
handle('exportReferences', async input => {
  const result = await dialog.showOpenDialog(window, { title: '选择批量参考保存位置', properties: ['openDirectory','createDirectory'] });
  if (result.canceled) return { cancelled: true };
  return task('批量导出参考', 'exportReferences', { annotationIds: input.annotationIds, mode: input.mode, directory: join(result.filePaths[0], `CutBox-references-${Date.now()}-${randomUUID().slice(0,6)}`) });
});
handle('exportDataset', async input => {
  if (!['jsonl','coco','srt'].includes(input?.format)) throw new Error('不支持的导出格式');
  const result = await dialog.showOpenDialog(window, { title: '选择数据集保存位置', properties: ['openDirectory','createDirectory'] });
  if (result.canceled) return { cancelled: true };
  return task('导出数据集', 'exportDataset', { directory: join(result.filePaths[0], `CutBox-${input.format}-${Date.now()}-${randomUUID().slice(0,6)}`), format: input.format, collectionId: input.collectionId, profile: input.profile });
});
handle('exportStory', async input => {
  const extension = { json: 'json', renpy: 'rpy', godot: 'gd' }[input?.format];
  if (!extension) throw new Error('不支持的故事格式');
  const result = await dialog.showSaveDialog(window, { title: '导出互动故事', defaultPath: `cutbox-story.${extension}`, filters: [{ name: 'Story', extensions: [extension] }] });
  if (result.canceled || !result.filePath) return { cancelled: true };
  return task('导出互动故事', 'exportStory', { storyId: input.storyId, format: input.format, path: result.filePath });
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
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  let finished = false, timer;
  const finish = async () => {
    if (finished) return;
    finished = true; clearTimeout(timer);
    await worker.terminate().catch(() => {});
    await jobSave.catch(() => {});
    closed = true; app.quit();
  };
  const askIfSlow = async () => {
    if (finished) return;
    const answer = await dialog.showMessageBox({ type: 'question', buttons: ['继续等待','强制退出'], defaultId: 0, cancelId: 0,
      message: '后台正在停止并清理文件', detail: '大型文件复制可能需要时间。强制退出可能留下未完成的临时文件；已保存的项目数据不会因此删除。' });
    if (finished) return;
    if (answer.response === 1) await finish();
    else timer = setTimeout(askIfSlow, 30000);
  };
  timer = setTimeout(askIfSlow, 30000);
  backend('close').catch(() => {}).finally(finish);
});

});
