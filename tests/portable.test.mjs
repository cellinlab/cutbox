import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {exportDataset} from '../desktop/portable.mjs';
import {exportBundle,importBundle} from '../desktop/packages.mjs';
const run=promisify(execFile);
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cutbox-portable-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source=path.join(root,'tone.wav');await run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=4','-c:a','pcm_s16le',source]);const bytes=await fs.readFile(source);
 return {root,snapshot:{media:[{id:'m1',name:'tone.wav',path:source,kind:'audio',duration:4,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}],entities:[],collections:[],annotations:[{id:'a1',mediaId:'m1',start:1,end:2,label:'line',notes:'hello\n\n<script> & "quote" --> next',keyframes:[{time:1.5,region:{x:0,y:0,width:0.5,height:0.5}}]}]}};
}
test('JSONL/SRT escape text and refuse overwrite',async t=>{
 const {root,snapshot}=await fixture(t);const json=await exportDataset({directory:path.join(root,'json'),snapshot,format:'jsonl'});const rows=(await fs.readFile(json.path,'utf8')).trim().split('\n');assert.equal(rows.length,1);assert.equal(JSON.parse(rows[0]).annotation.notes,snapshot.annotations[0].notes);assert.ok(!JSON.parse(rows[0]).media.path.startsWith('/'));
 const srt=await exportDataset({directory:path.join(root,'srt'),snapshot,format:'srt'});const index=JSON.parse(await fs.readFile(srt.path));const text=await fs.readFile(path.join(srt.directory,index[0].path),'utf8');assert.match(text,/00:00:01,000 --> 00:00:02,000/);assert.match(text,/&lt;script&gt; &amp;/);assert.equal(text.match(/ --> /g).length,1);await assert.rejects(exportDataset({directory:srt.directory,snapshot,format:'srt'}),/already exists/);
});
test('real audio trim rebases annotations, keyframes and story anchors',async t=>{
 const {root,snapshot}=await fixture(t);snapshot.annotations[0].words=[{start:1.1,end:1.8,text:'word',confidence:0.7}];snapshot.stories=[{id:'s',name:'Scene',nodes:[{id:'n',mediaId:'m1',start:0.5,end:2.5,choices:[]}],variables:[],startNodeId:'n'}];
 const result=await exportBundle({directory:path.join(root,'bundle'),snapshot,password:'test passphrase long',profile:'trimmed'});const imported=await importBundle({path:result.path,password:'test passphrase long',directory:path.join(root,'imported')});
 assert.equal(imported.media[0].duration,2);assert.equal(imported.media[0].sourceAnchor.start,0.5);assert.equal(imported.annotations[0].start,0.5);assert.ok(Math.abs(imported.annotations[0].words[0].start-0.6)<1e-9);assert.ok(Math.abs(imported.annotations[0].words[0].end-1.3)<1e-9);assert.equal(imported.annotations[0].keyframes[0].time,1);assert.equal(imported.stories[0].nodes[0].start,0);assert.equal(snapshot.annotations[0].start,1);
 const probe=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',imported.media[0].path]);assert.ok(Math.abs(Number(JSON.parse(probe.stdout).format.duration)-2)<0.05);
});
test('incompatible COCO and cancellation leave no output',async t=>{
 const {root,snapshot}=await fixture(t);const before=await fs.readdir(root);await assert.rejects(exportDataset({directory:path.join(root,'coco'),snapshot,format:'coco'}),/COCO requires/);
 const abort=new AbortController();abort.abort();await assert.rejects(exportDataset({directory:path.join(root,'cancel'),snapshot,format:'jsonl',signal:abort.signal}));assert.deepEqual(await fs.readdir(root),before);
});
test('COCO extracts actual video PNG with pixel geometry',async t=>{
 const {root,snapshot}=await fixture(t);const source=path.join(root,'video.mp4');await run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=64x48:d=3','-c:v','libx264','-threads','1',source]);const bytes=await fs.readFile(source);Object.assign(snapshot.media[0],{path:source,name:'video.mp4',kind:'video',duration:3,width:64,height:48,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});snapshot.annotations[0].region={x:0.25,y:0.25,width:0.5,height:0.5};
 const result=await exportDataset({directory:path.join(root,'coco'),snapshot,format:'coco'});const coco=JSON.parse(await fs.readFile(result.path));assert.deepEqual(coco.annotations[0].bbox,[16,12,32,24]);assert.equal(coco.images[0].width,64);assert.ok((await fs.stat(path.join(result.directory,coco.images[0].file_name))).size>0);
});
test('trimmed odd-size video rescales geometry to encoded padded dimensions',async t=>{
 const {root,snapshot}=await fixture(t);const source=path.join(root,'odd.mkv');await run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc=size=65x49:duration=3:rate=10','-c:v','ffv1','-pix_fmt','bgr0','-threads','1',source]);const bytes=await fs.readFile(source);
 Object.assign(snapshot.media[0],{path:source,name:'odd.mkv',kind:'video',duration:3,width:65,height:49,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});Object.assign(snapshot.annotations[0],{region:{x:0,y:0,width:1,height:1},polygon:[{x:0,y:0},{x:1,y:0},{x:0,y:1}],keypoints:[{index:2,x:1,y:1,z:-0.4,visibility:0.9}]});
 const result=await exportDataset({directory:path.join(root,'trim'),snapshot,format:'jsonl',profile:'trimmed'});const row=JSON.parse((await fs.readFile(result.path,'utf8')).trim());assert.equal(row.media.width,66);assert.equal(row.media.height,50);assert.equal(row.annotation.region.width,65/66);assert.equal(row.annotation.polygon[2].y,49/50);assert.deepEqual(row.annotation.keypoints[0],{index:2,x:65/66,y:49/50,z:-0.4,visibility:0.9});assert.equal(row.annotation.keyframes[0].region.width,0.5*65/66);assert.equal(snapshot.annotations[0].region.width,1);
});
test('domain to encrypted trimmed bundle to domain preserves typed graph and remaps every dependency',async t=>{
 const {createDomain}=await import('../desktop/domain.mjs');const {root,snapshot}=await fixture(t);const domain=createDomain({directory:path.join(root,'db1')}),target=createDomain({directory:path.join(root,'db2')});t.after(()=>{domain.close();target.close();});
 const media=domain.addMedia(snapshot.media[0]);const actor=domain.saveEntity({type:'actor',name:'Performer',mediaIds:[]});const character=domain.saveEntity({type:'character',name:'Role',mediaIds:[media.id],actorEntityId:actor.id,attributes:{age:32}});const scene=domain.saveEntity({type:'scene',name:'Room',mediaIds:[media.id]});
 const template=domain.saveTemplate({name:'Delivery',fields:[{key:'mood',label:'Mood',type:'select',required:true,options:['quiet','loud']}]});const annotation=domain.saveAnnotation({mediaId:media.id,entityId:character.id,start:1,end:2,label:'voice',templateId:template.id,values:{mood:'quiet'},epistemic:'observed',confidence:0.9});
 const event=domain.saveEvent({name:'Arrival',entityIds:[character.id],annotationIds:[annotation.id],sceneId:scene.id,changes:[{entityId:character.id,key:'present',after:true}]});domain.saveRelation({fromEntityId:character.id,toEntityId:scene.id,type:'located_in',evidenceAnnotationIds:[annotation.id]});domain.saveStory({name:'Branch',variables:[],startNodeId:'end',nodes:[{id:'end',title:'Ending',body:'Done',kind:'ending',mediaId:media.id,start:0.5,end:2.5,eventIds:[event.id],choices:[]}]});
 const result=await exportBundle({directory:path.join(root,'graph'),snapshot:domain.snapshot(),password:'graph test password',profile:'trimmed'});const imported=await importBundle({path:result.path,password:'graph test password',directory:path.join(root,'managed')});target.importSnapshot(imported);const actual=target.snapshot();
 assert.equal(actual.annotations[0].values.mood,'quiet');assert.equal(actual.annotations[0].templateId,actual.templates[0].id);assert.equal(actual.events[0].annotationIds[0],actual.annotations[0].id);assert.equal(actual.relations[0].toEntityId,actual.entities.find(e=>e.type==='scene').id);assert.equal(actual.entities.find(e=>e.type==='character').actorEntityId,actual.entities.find(e=>e.type==='actor').id);assert.equal(actual.stories[0].nodes[0].eventIds[0],actual.events[0].id);assert.equal(actual.stories[0].nodes[0].mediaId,actual.media[0].id);assert.equal(actual.stories[0].nodes[0].start,0);assert.equal(actual.media[0].sourceAnchor.mediaId,media.id);assert.equal(actual.annotations[0].sourceAnchor.start,1);assert.equal(actual.annotations[0].start,0.5);
});
