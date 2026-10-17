import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { appendFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exportBundle } from '../desktop/packages.mjs';

const execute = promisify(execFile);
const password = 'cutbox integration passphrase';
async function openWorker(directory, onProgress) {
  const worker = new Worker(new URL('../desktop/backend-worker.mjs', import.meta.url), { workerData: { directory } });
  const pending = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  worker.on('message', message => {
    if (message.type === 'ready') { readyResolve(); return; }
    if (message.type === 'progress') { onProgress?.(message); return; }
    const entry = pending.get(message.id);
    if (!entry || message.type === 'progress') return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    message.error ? entry.reject(new Error(message.error)) : entry.resolve(message.result);
  });
  worker.on('error', error => {
    readyReject(error);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  });
  await ready;
  const call = (method, input) => new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Worker timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, method, input });
  });
  let stopped = false;
  return { call, async close() {
    if (stopped) return;
    stopped = true;
    try { await call('close'); } finally { await worker.terminate(); }
  } };
}

test('real worker imports media, edits graph, exports a bundle and persists a portable reimport', { timeout: 40000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cutbox-worker-'));
  const workers = [];
  t.after(async () => { for (const worker of workers) await worker.close(); await rm(directory, { recursive: true, force: true }); });
  const source = join(directory, '测试 视频.mp4');
  await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=10:duration=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', source]);
  const originalBytes = await readFile(source);
  const original = await openWorker(join(directory, 'original'));
  workers.push(original);
  let snapshot = await original.call('importMedia', [source]);
  const media = snapshot.media[0];
  assert.equal(media.kind, 'video');
  assert.equal(media.name, '测试 视频.mp4');
  assert.ok(media.thumbnailPath);
  snapshot = await original.call('saveEntity', { type: 'character', name: '阿青', tags: ['侧身'], mediaIds: [media.id], coverMediaId: media.id });
  const entity = snapshot.entities[0];
  snapshot = await original.call('saveAnnotation', { mediaId: media.id, entityId: entity.id, start: 0.1, end: 0.8, label: '转身', notes: '保留来源', region: { x: 0.1, y: 0.1, width: 0.3, height: 0.5 } });
  const annotation = snapshot.annotations[0];
  snapshot = await original.call('saveCollection', { name: '角色动作', entityIds: [entity.id], mediaIds: [media.id], annotationIds: [annotation.id] });
  const exported = await original.call('exportPackage', { directory: join(directory, 'bundle'), password, collectionId: snapshot.collections[0].id });
  assert.equal(exported.mediaCount, 1);
  await original.close();
  await rm(source);

  const restoredDirectory = join(directory, 'restored');
  const restored = await openWorker(restoredDirectory);
  workers.push(restored);
  snapshot = await restored.call('importPackage', { path: exported.path, password });
  assert.equal(snapshot.media.length, 1);
  assert.equal(snapshot.entities[0].name, '阿青');
  assert.equal(snapshot.annotations[0].entityId, snapshot.entities[0].id);
  assert.equal(snapshot.annotations[0].mediaId, snapshot.media[0].id);
  assert.deepEqual(snapshot.collections[0].annotationIds, [snapshot.annotations[0].id]);
  assert.notEqual(snapshot.entities[0].id, entity.id);
  const importedPath = (await restored.call('media', { id: snapshot.media[0].id })).path;
  assert.ok(importedPath.startsWith(join(restoredDirectory, 'managed')));
  assert.deepEqual(await readFile(importedPath), originalBytes);
  assert.equal(snapshot.media[0].sha256, createHash('sha256').update(originalBytes).digest('hex'));
  await restored.close();
  const reopened = await openWorker(restoredDirectory);
  workers.push(reopened);
  assert.deepEqual(await reopened.call('snapshot'), snapshot);
  await assert.rejects(reopened.call('saveAnnotation', { id: snapshot.annotations[0].id, end: 100 }), /duration/);
  await assert.rejects(reopened.call('unknownMethod'), /Unknown backend operation/);
  assert.deepEqual(await reopened.call('snapshot'), snapshot);

  // A valid encrypted package can still fail domain validation; no managed copy or DB rows may survive.
  const invalidSnapshot = structuredClone(snapshot);
  invalidSnapshot.entities[0].type = 'invalid-entity-type';
  const invalid = await exportBundle({ directory: join(directory, 'invalid-bundle'), password, snapshot: invalidSnapshot });
  const managedBefore = await readdir(join(restoredDirectory, 'managed'));
  await assert.rejects(reopened.call('importPackage', { path: invalid.path, password }), /entity type/);
  assert.deepEqual(await readdir(join(restoredDirectory, 'managed')), managedBefore);
  assert.deepEqual(await reopened.call('snapshot'), snapshot);
  await assert.rejects(reopened.call('importPackage', { path: exported.path, password: 'wrong but long password' }), /Authentication failed/);
  assert.deepEqual(await readdir(join(restoredDirectory, 'managed')), managedBefore);
});

test('reference export verifies source bytes before writing provenance and rejects replaced originals', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cutbox-source-integrity-'));
  const worker = await openWorker(join(directory, 'project'));
  t.after(async () => { await worker.close(); await rm(directory, { recursive: true, force: true }); });
  const source = join(directory, 'source.mp4');
  await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=10:duration=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', source]);
  const { media: [record] } = await worker.call('importMedia', [source]);
  const outputPath = join(directory, 'reference.mp4');
  await worker.call('exportReference', { mediaId: record.id, outputPath, start: 0, end: 0.5, mode: 'clip' });
  const provenance = JSON.parse(await readFile(`${outputPath}.json`, 'utf8'));
  assert.equal(provenance.sourceSha256, record.sha256);
  assert.match(provenance.sourceConsistency, /not an atomic filesystem snapshot/);
  // Same-size replacement must be caught by hashing, not merely by size.
  const bytes = await readFile(source);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(source, bytes);
  const rejectedOutput = join(directory, 'changed-reference.mp4');
  await assert.rejects(worker.call('exportReference', { mediaId: record.id, outputPath: rejectedOutput, start: 0, end: 0.5, mode: 'clip' }), /Source media changed/);
  assert.ok(!(await readdir(directory)).includes('changed-reference.mp4'));
  assert.ok(!(await readdir(directory)).includes('changed-reference.mp4.json'));
});

test('source mutation during reference processing removes output and never writes stale provenance', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cutbox-source-mutation-'));
  const source = join(directory, 'source.mp4');
  let changed = false;
  const worker = await openWorker(join(directory, 'project'), () => {
    if (!changed) { changed = true; appendFileSync(source, Buffer.from([0])); }
  });
  t.after(async () => { await worker.close(); await rm(directory, { recursive: true, force: true }); });
  await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=10:duration=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', source]);
  const { media: [record] } = await worker.call('importMedia', [source]);
  const outputPath = join(directory, 'reference.mp4');
  await assert.rejects(worker.call('exportReference', { mediaId: record.id, outputPath, start: 0, end: 0.5, mode: 'clip' }), /Source media changed/);
  assert.equal(changed, true);
  const files = await readdir(directory);
  assert.ok(!files.includes('reference.mp4'));
  assert.ok(!files.includes('reference.mp4.json'));
});

test('expanded worker graph survives undo, backup restore, relink and portable exchange', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cutbox-expanded-worker-'));
  const workers = [];
  t.after(async () => { for (const worker of workers) await worker.close(); await rm(directory, { recursive: true, force: true }); });
  const source = join(directory, 'evidence.mp4');
  await execute('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=128x96:rate=10:duration=2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',source]);
  const worker = await openWorker(join(directory,'project')); workers.push(worker);
  let data = await worker.call('importMedia',[source]); const m = data.media[0];
  data = await worker.call('saveTemplate',{name:'服装',fields:[{key:'color',label:'颜色',type:'select',options:['红','蓝'],required:true}]});
  const template = data.templates[0];
  data = await worker.call('saveEntity',{type:'character',name:'观察者',mediaIds:[m.id],tags:[],attributes:{goal:'寻找线索'}}); const character = data.entities[0];
  data = await worker.call('saveAnnotation',{mediaId:m.id,entityId:character.id,start:0.2,end:1.2,label:'线索',templateId:template.id,values:{color:'蓝'},category:'clothing',epistemic:'observed',confidence:1,region:{x:0.1,y:0.1,width:0.4,height:0.4}}); const annotation=data.annotations[0];
  data = await worker.call('saveEvent',{name:'发现线索',description:'从画面中观察',entityIds:[character.id],annotationIds:[annotation.id],storyTime:1,epistemic:'observed',confidence:1,changes:[{entityId:character.id,key:'knows_clue',before:false,after:true}]}); const event=data.events[0];
  data = await worker.call('saveStory',{name:'证据探索',description:'',variables:[{id:'known',name:'已知',type:'boolean',initial:false}],startNodeId:'start',nodes:[{id:'start',title:'现场',body:'调查',kind:'scene',mediaId:m.id,start:0.2,end:1.2,eventIds:[event.id],choices:[{id:'inspect',label:'查看',targetId:'end',conditions:[],effects:[{variable:'known',op:'set',value:true}]}]},{id:'end',title:'完成',body:'找到线索',kind:'ending',choices:[]}]});
  const before=data;
  await worker.call('saveEntity',{id:character.id,name:'临时名称'});
  data=await worker.call('undo'); assert.equal(data.entities[0].name,'观察者');
  data=await worker.call('redo'); assert.equal(data.entities[0].name,'临时名称');
  data=await worker.call('undo'); assert.equal(data.stories.length,1);
  const backup=await worker.call('backupProject',{directory:join(directory,'backup')});
  await worker.call('saveEntity',{id:character.id,name:'恢复前'});
  data=await worker.call('restoreProject',{path:backup.path}); assert.equal(data.entities[0].name,'观察者');
  assert.equal(data.stories[0].nodes[0].eventIds[0],data.events[0].id);
  assert.equal(data.annotations[0].templateId,data.templates[0].id);
  assert.equal(data.media[0].id,m.id);
  assert.deepEqual(await worker.call('checkMedia'),[{mediaId:m.id,status:'ok'}]);
  const result=await worker.call('analyzeMedia',{mediaId:m.id,kind:'frames'}); assert.ok(result.frames.length>=19);
  const destination=join(directory,'story.json'); await worker.call('exportStory',{storyId:data.stories[0].id,format:'json',path:destination}); assert.match(await readFile(destination,'utf8'),/证据探索/);
  const bundle=await worker.call('exportPackage',{directory:join(directory,'bundle-expanded'),password});
  const fresh=await openWorker(join(directory,'fresh')); workers.push(fresh);
  const imported=await fresh.call('importPackage',{path:bundle.path,password});
  assert.equal(imported.templates.length,1); assert.equal(imported.events.length,1); assert.equal(imported.stories.length,1);
  assert.notEqual(imported.stories[0].nodes[0].mediaId,m.id);
  assert.equal(imported.stories[0].nodes[0].mediaId,imported.media[0].id);
  assert.equal(imported.stories[0].nodes[0].eventIds[0],imported.events[0].id);
  assert.equal(before.annotations[0].values.color,imported.annotations[0].values.color);
  const previous=await worker.call('snapshot');
  await assert.rejects(worker.call('saveAnnotations',{annotations:[{mediaId:m.id,start:0,end:1,label:'valid'},{mediaId:m.id,start:0,end:99,label:'invalid'}]}), /range|duration/i);
  assert.deepEqual(await worker.call('snapshot'),previous);
  const accepted = await worker.call('saveAnnotations',{annotations:[{mediaId:m.id,start:0,end:0.5,label:'建议一',reviewState:'accepted'},{mediaId:m.id,start:0.5,end:1,label:'建议二',reviewState:'accepted'}]});
  assert.equal(accepted.annotations.length, previous.annotations.length + 2);
  const selectedIds = accepted.annotations.filter(a => a.label.startsWith('建议')).map(a => a.id);
  const batch = await worker.call('exportReferences', {annotationIds:selectedIds,mode:'edges',directory:join(directory,'reference-batch')});
  const batchFiles = await readdir(join(directory,'reference-batch'));
  assert.equal(batch.count,2); assert.equal(batchFiles.filter(name=>name.endsWith('.mp4')).length,2);
  const invalidBatch = join(directory,'invalid-reference-batch');
  await assert.rejects(worker.call('exportReferences',{annotationIds:[annotation.id,selectedIds[0]],mode:'crop',directory:invalidBatch}), /crop/i);
  assert.ok(!(await readdir(directory)).includes('invalid-reference-batch'));
  assert.deepEqual(await worker.call('undo'), previous);
});
