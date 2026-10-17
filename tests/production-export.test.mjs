import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createDomain} from '../desktop/domain.mjs';
import {importMedia,probeMedia} from '../desktop/media.mjs';
import {fileDigest} from '../desktop/reliability.mjs';
import {exportProductionKit} from '../desktop/production-export.mjs';
import {exportBundle,importBundle} from '../desktop/packages.mjs';
const run=promisify(execFile);
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cutbox-production-'));const domain=createDomain({directory:path.join(root,'db')});t.after(async()=>{domain.close();await fs.rm(root,{recursive:true,force:true});});
 const video=path.join(root,'source.mp4'),audio=path.join(root,'source.wav');await run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=96x64:d=3','-c:v','libx264','-threads','1',video]);await run('ffmpeg',['-v','error','-f','lavfi','-i','sine=duration=3','-c:a','pcm_s16le',audio]);
 const imported=await importMedia([video,audio],{cacheDirectory:path.join(root,'cache')});const vm=domain.addMedia(imported[0]),am=domain.addMedia(imported[1]);const character=domain.saveEntity({name:'Character',type:'character',mediaIds:[vm.id],attributes:{coat:'blue'}});const voice=domain.saveEntity({name:'Voice',type:'sound',mediaIds:[am.id]});
 const a1=domain.saveAnnotation({label:'Coat',category:'wardrobe',values:{clothingColor:'blue'},mediaId:vm.id,entityId:character.id,start:0.5,end:1.5,region:{x:0,y:0,width:0.5,height:0.5}}),a2=domain.saveAnnotation({label:'Pose',mediaId:vm.id,entityId:character.id,start:1.5,end:2}),a3=domain.saveAnnotation({label:'Dialogue',mediaId:am.id,entityId:voice.id,start:0.5,end:1.5});
 const production=domain.saveProduction({name:'Handoff',target:'seedance',entityIds:[character.id,voice.id],annotationIds:[],shots:[{name:'=SUM(1,2)',duration:2,prompt:'A coat ![secret](file:///private/file) <script>',negativePrompt:'avoid blur',continuity:'same blue coat',entityIds:[character.id],annotationIds:[a1.id,a2.id,a3.id],outputMediaId:vm.id,status:'generated',takes:[{mediaId:am.id,provider:'manual',model:'local-reference',prompt:'A voice test',negativePrompt:'no music',seed:'42',externalTaskId:'task-local',notes:'candidate audio'}]}]});
 return {root,domain,production,vm,am,a1,a2,a3};
}
test('production kit generates real frames/audio/clips, contact sheet, safe text and verified manifest',async t=>{
 const f=await fixture(t),out=await exportProductionKit({directory:path.join(f.root,'kit'),snapshot:f.domain.snapshot(),productionId:f.production.id,includeClips:true,cropRegions:true});const manifest=JSON.parse(await fs.readFile(out.path));assert.equal(out.referenceCount,3);
 for(const file of manifest.files)assert.deepEqual(await fileDigest(path.join(out.directory,file.path)),{sha256:file.sha256,size:file.size});
 const frames=manifest.files.filter(x=>x.kind==='frame');assert.equal(frames.length,2);assert.equal((await probeMedia(path.join(out.directory,frames[0].path))).width,48);assert.equal(manifest.files.filter(x=>x.kind==='clip').length,2);assert.equal(manifest.files.filter(x=>x.kind==='audio').length,1);assert.ok((await fs.stat(path.join(out.directory,'contact-sheet.png'))).size>0);
 const json=await fs.readFile(path.join(out.directory,'production.json'),'utf8');assert.ok(!json.includes(f.root));assert.ok(!json.includes('thumbnailPath'));assert.equal(JSON.parse(json).production.shots[0].references.length,3);const take=JSON.parse(json).production.shots[0].takes[0];assert.equal(take.seed,'42');assert.ok(take.outputPath.startsWith('outputs/'));assert.ok((await fs.stat(path.join(out.directory,take.outputPath))).size>0);
 const csv=await fs.readFile(path.join(out.directory,'shot-list.csv'),'utf8');assert.match(csv,/"'=SUM\(1,2\)"/);const prompts=await fs.readFile(path.join(out.directory,'prompts.md'),'utf8');assert.ok(!prompts.includes('![secret]('));assert.ok(prompts.includes('&lt;script&gt;'));assert.match(prompts,/@reference_1/);assert.equal(JSON.parse(await fs.readFile(path.join(out.directory,'bibles/wardrobe.json'))).length,1);assert.ok(manifest.files.some(f=>f.path==='audit.json'));
});
test('production output rejects source changes, cancellation and existing directories without leftovers',async t=>{
 const f=await fixture(t),snapshot=f.domain.snapshot(),destination=path.join(f.root,'kit');await fs.mkdir(destination);await assert.rejects(exportProductionKit({directory:destination,snapshot,productionId:f.production.id}),/already exists/);assert.deepEqual(await fs.readdir(destination),[]);
 const abort=new AbortController();abort.abort();await assert.rejects(exportProductionKit({directory:path.join(f.root,'cancel'),snapshot,productionId:f.production.id,signal:abort.signal}));
 const bytes=await fs.readFile(f.vm.path);bytes[0]^=1;await fs.writeFile(f.vm.path,bytes);await assert.rejects(exportProductionKit({directory:path.join(f.root,'bad'),snapshot,productionId:f.production.id}),/不一致/);assert.ok(!(await fs.readdir(f.root)).some(x=>x.startsWith('.cutbox-')));await assert.rejects(fs.stat(path.join(f.root,'bad')),{code:'ENOENT'});
});
test('post-generation source mutation prevents publication',async t=>{
 const f=await fixture(t);let mutated=false;
 const {writeFileSync,readFileSync}=await import('node:fs');mutated=false;
 await assert.rejects(exportProductionKit({directory:path.join(f.root,'mutating'),snapshot:f.domain.snapshot(),productionId:f.production.id,onProgress:()=>{if(!mutated){mutated=true;const b=readFileSync(f.am.path);b[b.length-1]^=1;writeFileSync(f.am.path,b);}}}),/不一致|changed/);await assert.rejects(fs.stat(path.join(f.root,'mutating')),{code:'ENOENT'});
});
test('CBox 0.3 production graph remaps references and preserves full generated outputs in trim profile',async t=>{
 const f=await fixture(t),snapshot=f.domain.snapshot(),out=await exportBundle({directory:path.join(f.root,'bundle'),snapshot,password:'production password',profile:'trimmed'}),result=await importBundle({path:out.path,password:'production password',directory:path.join(f.root,'managed')});assert.equal(result.schema,'cutbox.desktop/0.3');assert.deepEqual(result.productions,snapshot.productions);assert.equal(result.media.find(m=>m.id===f.vm.id).duration,3);assert.equal(result.annotations.find(a=>a.id===f.a3.id).start,0.5);assert.equal(result.media.find(m=>m.id===f.am.id).duration,3);
 const next=createDomain({directory:path.join(f.root,'next')});try{next.importSnapshot(result);const imported=next.snapshot();assert.notEqual(imported.productions[0].id,f.production.id);assert.ok(imported.media.some(m=>m.id===imported.productions[0].shots[0].outputMediaId));assert.ok(imported.annotations.some(a=>a.id===imported.productions[0].shots[0].annotationIds[0]));assert.ok(imported.media.some(m=>m.id===imported.productions[0].shots[0].takes[0].mediaId));assert.notEqual(imported.productions[0].shots[0].takes[0].id,f.production.shots[0].takes[0].id);}finally{next.close();}
 const partial=await exportBundle({directory:path.join(f.root,'partial'),snapshot,password:'production password',entityIds:[snapshot.entities[0].id]});const selected=await importBundle({path:partial.path,password:'production password',directory:path.join(f.root,'partial-read')});assert.deepEqual(selected.productions,[]);
});
