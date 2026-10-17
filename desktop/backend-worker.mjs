import { parentPort, workerData } from 'node:worker_threads';
import { mkdir, rm, writeFile, unlink, stat, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createDomain } from './domain.mjs';
import { importMedia, exportReference, capabilities, probeMedia } from './media.mjs';
import { exportBundle, importBundle } from './packages.mjs';
import { exportDataset } from './portable.mjs';
import { detectScenes, waveform, frameTimestamps, createProxy } from './media-tools.mjs';
import { modelStatus, analyzeMedia as analyzeModel, exportModelReference } from './models.mjs';
import { exportStory } from './story.mjs';
import { findSimilar, searchAnnotations } from './search.mjs';
import { normalizeSuggestions } from './suggestions.mjs';
import { auditProduction, draftShotPrompt, productionTemplates } from './production.mjs';
import { exportProductionKit } from './production-export.mjs';
import { inspectDataset, exportTrainingDataset } from './dataset-preparation.mjs';
import { parseSubtitles } from './subtitles.mjs';
import { createDiscoveryIndex } from './discovery-index.mjs';
import { publishDirectory, backupProject, readBackup, checkMedia, verifyMedia, readModelConfig, writeModelConfig, writeNewFile } from './reliability.mjs';

const root = workerData.directory;
const domain = createDomain({ directory: root });
const discovery = createDiscoveryIndex({path: join(root, 'discovery.sqlite')});
let discoveryDirty = true;
const controllers = new Map();
const active = new Set();
let mutationTail = Promise.resolve();
let closing = false;
const cacheDirectory = join(root, 'thumbnails');
const options = { cacheDirectory, ffmpegPath: workerData.ffmpegPath || 'ffmpeg', ffprobePath: workerData.ffprobePath || 'ffprobe' };
const snapshot = () => domain.snapshot();
const media = id => {
  const found = domain.getMedia(id);
  if (!found) throw new Error('找不到素材，请刷新后重试。');
  return found;
};
const sourceStamp = details => [details.dev, details.ino, details.size, details.mtimeNs, details.ctimeNs].map(String).join(':');
async function verifySource(record, signal, expectedStamp) {
  const before = await stat(record.path, { bigint: true });
  const stamp = sourceStamp(before);
  const changed = () => new Error('源素材已更改，请重新导入后导出参考。 Source media changed.');
  if (!before.isFile() || before.size !== BigInt(record.size) || (expectedStamp && stamp !== expectedStamp)) throw changed();
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(record.path, { signal })) { hash.update(chunk); size += chunk.length; }
  const after = await stat(record.path, { bigint: true });
  if (signal.aborted) throw new Error('Media operation cancelled');
  if (size !== record.size || hash.digest('hex') !== record.sha256 || sourceStamp(after) !== stamp) throw changed();
  return stamp;
}
async function hydrateMediaRecords(data, signal) {
  // Authentication validates package bytes, not claims about their actual duration or orientation.
  for (const record of data.media) {
    const actual = await probeMedia(record.path, { ...options, signal });
    record.kind = actual.kind; record.duration = actual.duration;
    for (const key of ['width','height']) { if (actual[key] === undefined) delete record[key]; else record[key] = actual[key]; }
  }
  return data;
}
const progress = id => value => parentPort.postMessage({ type: 'progress', id, progress: value });
const models = async () => ({ ...(await readModelConfig(root)), ffmpegPath: options.ffmpegPath });
const methods = {
  snapshot,
  productionAudit: id => auditProduction(snapshot(),id),
  draftShotPrompt: input => draftShotPrompt(snapshot(),input),
  inspectDataset: input => inspectDataset(snapshot(),input),
  exportProduction: (input,id,signal) => exportProductionKit({...input,snapshot:snapshot(),signal,...options,onProgress:progress(id)}),
  exportTrainingDataset: (input,id,signal) => exportTrainingDataset({...input,snapshot:snapshot(),signal,...options,onProgress:progress(id)}),
  discoverAnnotations: input => {
    if(discoveryDirty){discovery.replace(snapshot());discoveryDirty=false;}
    return discovery.search(input);
  },
  installProductionTemplates: () => {
    const data=snapshot(),names=new Set(data.templates.map(t=>t.name));
    const templates=productionTemplates.filter(t=>!names.has(t.name));
    if(templates.length)domain.importSnapshot({media:[],entities:[],annotations:[],collections:[],templates});
    return snapshot();
  },
  async importSubtitles({mediaId,path,offset=0},_id,signal) {
    const record=media(mediaId);
    if(record.kind==='image')throw new Error('字幕需要视频或音频素材');
    const file=await open(path,'r');let bytes;
    try {
      const info=await file.stat(),max=10*1024*1024;
      if(!info.isFile()||info.size>max)throw new Error('字幕文件必须小于等于 10 MiB');
      bytes=Buffer.alloc(max+1);let count=0;
      while(count<bytes.length){signal.throwIfAborted();const read=await file.read(bytes,count,bytes.length-count,null);if(!read.bytesRead)break;count+=read.bytesRead;}
      if(count>max)throw new Error('字幕文件过大');bytes=bytes.subarray(0,count);
    } finally {await file.close();}
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('字幕应为 UTF-8 编码，请转换后导入');}
    const parsed=parseSubtitles(text,{mediaId,duration:record.duration,offset});
    signal.throwIfAborted();domain.saveAnnotations({annotations:parsed.annotations});
    return {snapshot:snapshot(),count:parsed.annotations.length,warnings:parsed.warnings};
  },
  history: () => domain.history(),
  searchAnnotations: input => searchAnnotations(snapshot(), input),
  findSimilar: (input, _id, signal) => findSimilar(snapshot(), { mediaId: input.mediaId, limit: input.limit, ffmpegPath: options.ffmpegPath, signal }),
  capabilities: async () => { const [base,status] = await Promise.all([capabilities(options), modelStatus({config:await models()})]); return {...base, depth:status.depth, pose:status.pose, mask:status.mask}; },
  modelStatus: async () => modelStatus({ config: await models() }),
  async modelConfigure({ key, value }) {
    const allowed = ['pythonPath','depthModelPath','poseModelPath','maskModelPath','whisperModelPath','tesseractPath','device','language','ocrLanguage'];
    if (!allowed.includes(key) || typeof value !== 'string') throw new Error('无效模型设置');
    if (key === 'device' && !['cpu','mps','cuda'].includes(value)) throw new Error('无效计算设备');
    if (['language','ocrLanguage'].includes(key) && !/^[a-zA-Z_+-]{0,40}$/.test(value)) throw new Error('无效语言代码');
    const config = await readModelConfig(root); if (key === 'language' && (!value || value === 'auto')) delete config.language; else config[key] = value;
    await writeModelConfig(root, config);
    return modelStatus({ config: { ...config, ffmpegPath: options.ffmpegPath } });
  },
  async importMedia(paths, id, signal) {
    const records = await importMedia(paths, { ...options, signal });
    try { domain.importSnapshot({ media: records, entities: [], annotations: [], collections: [] }); }
    finally {
      const retained = new Set(snapshot().media.map(item => item.thumbnailPath));
      await Promise.all(records.filter(item => item.thumbnailPath && !retained.has(item.thumbnailPath)).map(item => unlink(item.thumbnailPath).catch(() => {})));
    }
    return snapshot();
  },
  media: ({ id, thumbnail, original }) => {
    const record = media(id);
    return { path: thumbnail ? record.thumbnailPath : original ? record.path : record.proxyPath || record.path, kind: record.kind };
  },
  checkMedia: (_input, _id, signal) => checkMedia(snapshot(), signal),
  async relinkMedia({ id, path }, _requestId, signal) {
    const record = media(id);
    await verifyMedia({ ...record, path }, signal);
    domain.updateMedia({ id, path, proxyPath: null });
    return snapshot();
  },
  async createProxy(id, requestId, signal) {
    const record = media(id);
    const stamp = await verifySource(record, signal);
    const directory = join(root, 'proxies'); await mkdir(directory, { recursive: true });
    const outputPath = join(directory, `${randomUUID()}.mp4`);
    try {
      await createProxy({ ...options, inputPath: record.path, outputPath, signal, onProgress: progress(requestId) });
      await verifySource(record, signal, stamp);
      domain.updateMedia({ id, proxyPath: outputPath });
    } catch (error) { await unlink(outputPath).catch(() => {}); throw error; }
    return snapshot();
  },
  async analyzeMedia(input, requestId, signal) {
    const record = media(input.mediaId);
    const stamp = await verifySource(record, signal);
    const common = { ...options, inputPath: record.path, mediaId: record.id, signal, onProgress: progress(requestId) };
    let result;
    if (input.kind === 'scenes') result = await detectScenes({ ...common, threshold: input.options?.threshold, minDuration: input.options?.minDuration });
    else if (input.kind === 'waveform') result = await waveform({ ...common, points: input.options?.points });
    else if (input.kind === 'frames') result = await frameTimestamps(common);
    else {
      const task = { transcribe:'transcription',ocr:'ocr',track:'tracking',detect:'detection',pose:'pose' }[input.kind];
      if (!task) throw new Error('不支持的分析类型');
      result = await analyzeModel({ ...common, task, start: record.kind === 'image' ? 0 : input.options?.start ?? 0, end: record.kind === 'image' ? undefined : input.options?.end,
        sampleFps: input.options?.sampleFps, region: input.options?.region, config: { ...await models(), ...(input.options?.language && input.options.language !== 'auto' ? { language: input.options.language } : {}) } });
      result.suggestions = normalizeSuggestions(record, result.annotations || [], input.options).map(item => ({ ...item, mediaId: record.id, category: task,
        epistemic: 'interpreted', reviewState: 'suggested', confidence: item.confidence ?? null, notes: `${item.notes || ''}\n模型来源：${JSON.stringify(result.provenance || {})}` }));
      delete result.annotations;
    }
    await verifySource(record, signal, stamp);
    return result;
  },
  async exportReference(input, requestId, signal, onProgressOverride) {
    const record = media(input.mediaId);
    const originalStamp = await verifySource(record, signal);
    const common = { ...options, inputPath: record.path, outputPath: input.outputPath, start: input.start, end: input.end,
      mode: input.mode, options: input.options, signal, onProgress: onProgressOverride || progress(requestId) };
    const result = ['depth','pose','mask'].includes(input.mode)
      ? await exportModelReference({ ...common, config: await models() })
      : await exportReference(common);
    try { await verifySource(record, signal, originalStamp); }
    catch (error) { await unlink(result.outputPath).catch(() => {}); throw error; }
    const provenance = { schema: 'cutbox.reference/0.2', sourceSha256: record.sha256,
      sourceMediaId: record.id, start: input.start, end: input.end, mode: input.mode, options: input.options,
      model: result.provenance, createdAt: new Date().toISOString(), timing: 'seconds; decoded and re-encoded, no VFR frame-accuracy guarantee',
      sourceConsistency: 'SHA-256, size and file identity/timestamps checked before and after export; not an atomic filesystem snapshot. Do not modify source files during export.' };
    let warning;
    try { await writeFile(`${result.outputPath}.json`, JSON.stringify(provenance, null, 2), { flag: 'wx' }); }
    catch { warning = '参考已导出，但来源描述文件未能写入。'; }
    return { path: result.outputPath, ...(warning ? { warning } : {}) };
  },
  async exportReferences({ annotationIds, mode, directory }, requestId, signal) {
    if (!Array.isArray(annotationIds) || !annotationIds.length || annotationIds.length > 5000 || new Set(annotationIds).size !== annotationIds.length) throw new Error('请选择 1–5000 个不同标注');
    if (!['clip','edges','crop','frame','audio','depth','pose','mask'].includes(mode)) throw new Error('不支持的参考配方');
    const data = snapshot();
    const selected = annotationIds.map(id => { const item = data.annotations.find(a => a.id === id); if (!item) throw new Error('找不到标注'); return item; });
    const entries = [];
    await publishDirectory(directory, async staging => {
      for (let i = 0; i < selected.length; i++) {
        signal.throwIfAborted();
        const annotation = selected[i];
        const extension = mode === 'frame' ? 'png' : mode === 'audio' ? 'wav' : 'mp4';
        const filename = `${String(i+1).padStart(4,'0')}-${mode}.${extension}`;
        const result = await methods.exportReference({ mediaId: annotation.mediaId, start: annotation.start, end: annotation.end, mode,
          options: mode === 'crop' ? { crop: annotation.region, track: annotation.keyframes } : undefined, outputPath: join(staging, filename) }, requestId, signal, value => progress(requestId)((i+value)/selected.length));
        entries.push({ annotationId: annotation.id, mediaId: annotation.mediaId, label: annotation.label, file: filename, warning: result.warning });
      }
      signal.throwIfAborted();
      await writeFile(join(staging,'references.json'), JSON.stringify({ schema:'cutbox.reference-set/0.1', mode, entries }, null, 2), { flag:'wx' });
    });
    return { path: join(directory,'references.json'), count: entries.length };
  },
  exportPackage: (input, id, signal) => exportBundle({ ...input, snapshot: snapshot(), signal, ffmpegPath: options.ffmpegPath, ffprobePath: options.ffprobePath, onProgress: progress(id) }),
  exportDataset: (input, id, signal) => exportDataset({ ...input, snapshot: snapshot(), signal, ffmpegPath: options.ffmpegPath, ffprobePath: options.ffprobePath, onProgress: progress(id) }),
  async exportStory({ storyId, format, path }, _id, signal) {
    const data = snapshot(), story = data.stories.find(item => item.id === storyId);
    if (!story) throw new Error('找不到故事');
    const result = exportStory({ story, format, snapshot: data });
    return writeNewFile(path, result.content, signal);
  },
  async importPackage(input, _id, signal) {
    const directory = join(root, 'managed', randomUUID());
    await mkdir(join(root, 'managed'), { recursive: true });
    try {
      const imported = await importBundle({ ...input, directory, signal });
      await hydrateMediaRecords(imported, signal);
      signal.throwIfAborted(); domain.importSnapshot(imported);
      return snapshot();
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  },
  backupProject: ({ directory }, id, signal) => backupProject({ directory, snapshot: snapshot(), signal, onProgress: progress(id) }),
  async restoreProject({ path }, id, signal) {
    const directory = join(root, 'managed', randomUUID());
    await mkdir(join(root, 'managed'), { recursive: true });
    try {
      const restored = await readBackup({ path, directory, signal, onProgress: progress(id) });
      await hydrateMediaRecords(restored, signal);
      signal.throwIfAborted();
      // The validated transaction retains the prior graph in undo history, including its original paths.
      domain.replaceSnapshot(restored);
      return snapshot();
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  },
};
const CRUD = ['saveEntity','deleteEntity','saveAnnotation','saveAnnotations','deleteAnnotation','saveCollection','deleteCollection',
  'saveTemplate','deleteTemplate','saveEvent','deleteEvent','saveRelation','deleteRelation','saveStory','deleteStory','saveProduction','deleteProduction','undo','redo'];
for (const name of CRUD) methods[name] = input => { domain[name](input); return snapshot(); };
methods.updateMedia = input => { // Renderer can edit episode metadata; filesystem paths require native pickers.
  domain.updateMedia({ id: input.id, ...(input.series !== undefined ? { series: input.series } : {}), ...(input.episode !== undefined ? { episode: input.episode } : {}) }); return snapshot();
};
const MUTATIONS = new Set([...CRUD,'updateMedia','importMedia','importPackage','relinkMedia','createProxy','restoreProject','modelConfigure','installProductionTemplates','importSubtitles']);
parentPort.on('message', ({ id, method, input }) => {
  if (method === 'cancel') { const controller = controllers.get(input); controller?.abort(); parentPort.postMessage({ id, result: Boolean(controller) }); return; }
  if (method === 'close') {
    closing = true;
    for (const controller of controllers.values()) controller.abort();
    Promise.allSettled([...active]).then(() => { discovery.close(); domain.close(); parentPort.postMessage({ id, result: true }); }); return;
  }
  if (closing) { parentPort.postMessage({ id, error: 'CutBox is shutting down' }); return; }
  const controller = new AbortController(); controllers.set(id, controller);
  const run = async () => {
    try {
      controller.signal.throwIfAborted();
      if (!Object.hasOwn(methods, method)) throw new Error('Unknown backend operation');
      const result = await methods[method](input, id, controller.signal);
      if(MUTATIONS.has(method))discoveryDirty=true;
      parentPort.postMessage({ id, result });
    } catch (error) { parentPort.postMessage({ id, error: controller.signal.aborted ? 'Operation cancelled' : error.message }); }
    finally { controllers.delete(id); }
  };
  const operation = MUTATIONS.has(method) ? mutationTail.then(run) : run();
  if (MUTATIONS.has(method)) mutationTail = operation.catch(() => {});
  active.add(operation); operation.finally(() => active.delete(operation));
});
parentPort.postMessage({ type: 'ready' });
