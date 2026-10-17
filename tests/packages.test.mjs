import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash,scryptSync,createDecipheriv,createCipheriv } from 'node:crypto';
import { exportBundle,importBundle } from '../desktop/packages.mjs';
const password='correct horse battery staple';
async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cutbox-package-test-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source=path.join(root,'original.wav'); await fs.writeFile(source,Buffer.from('synthetic test media bytes'));
 const snapshot={media:[{id:'m1',name:'tone.wav',kind:'audio',path:source,duration:10,thumbnailPath:'/private/thumb.jpg'},{id:'m2',name:'other.wav',kind:'audio',path:source,duration:10}],entities:[{id:'e1',type:'character',name:'Actor',mediaIds:['m1'],coverMediaId:'m1'},{id:'e2',type:'scene',name:'Room',mediaIds:['m2']}],annotations:[{id:'a1',mediaId:'m1',entityId:'e1',start:1,end:3,label:'voice',notes:'test',reviewState:'accepted'},{id:'a2',mediaId:'m2',entityId:'e2',start:0,end:1}],collections:[{id:'c1',name:'Voice',mediaIds:[],entityIds:['e1'],annotationIds:['a1']},{id:'c2',mediaIds:['m2'],entityIds:['e2'],annotationIds:['a2']}]};
 const bytes=await fs.readFile(source);
 for(const media of snapshot.media) { media.size=bytes.length;media.sha256=createHash('sha256').update(bytes).digest('hex'); }
 return {root,snapshot};
}
async function rewrite(box,mutate) {
 const data=await fs.readFile(box),header=data.subarray(0,36),key=scryptSync(password,data.subarray(8,24),32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const dec=createDecipheriv('aes-256-gcm',key,data.subarray(24,36)); dec.setAAD(header);dec.setAuthTag(data.subarray(-16));
 const manifest=JSON.parse(Buffer.concat([dec.update(data.subarray(36,-16)),dec.final()])); mutate(manifest);
 const enc=createCipheriv('aes-256-gcm',key,data.subarray(24,36));enc.setAAD(header);
 await fs.writeFile(box,Buffer.concat([header,enc.update(JSON.stringify(manifest)),enc.final(),enc.getAuthTag()]));
}
test('roundtrip retains annotation data, deduplicates file contents, strips source paths',async t=>{
 const {root,snapshot}=await fixture(t),out=await exportBundle({directory:path.join(root,'out'),password,snapshot});
 assert.equal(out.mediaCount,2);assert.equal((await fs.readdir(path.join(out.directory,'media'))).length,1);
 const imported=await importBundle({path:out.path,password,directory:path.join(root,'managed')});
 assert.deepEqual(imported.annotations,snapshot.annotations);assert.equal(imported.entities[0].coverMediaId,'m1');
 assert.equal(imported.media[0].thumbnailPath,undefined);assert.notEqual(imported.media[0].path,snapshot.media[0].path);
 assert.deepEqual(await fs.readFile(imported.media[0].path),await fs.readFile(snapshot.media[0].path));
});
test('entity and collection selection include valid dependency closure only',async t=>{
 const {root,snapshot}=await fixture(t);
 for(const [i,selection] of [{entityIds:['e1']},{collectionId:'c1'}].entries()) {
  const out=await exportBundle({directory:path.join(root,`out${i}`),password,snapshot,...selection});
  const imported=await importBundle({path:out.path,password,directory:path.join(root,`managed${i}`)});
  for(const [name,id] of [['media','m1'],['entities','e1'],['annotations','a1'],['collections','c1']]) assert.deepEqual(imported[name].map(x=>x.id),[id]);
 }
});
test('wrong passphrase and envelope tamper leave no output',async t=>{
 const {root,snapshot}=await fixture(t),out=await exportBundle({directory:path.join(root,'out'),password,snapshot});
 const destination=path.join(root,'managed');
 await assert.rejects(importBundle({path:out.path,password:'wrong password 123',directory:destination}),/Authentication/);
 const bytes=await fs.readFile(out.path);bytes[40]^=1;await fs.writeFile(out.path,bytes);
 await assert.rejects(importBundle({path:out.path,password,directory:destination}),/Authentication/);
 await assert.rejects(fs.stat(destination),{code:'ENOENT'});
});
test('authenticated traversal and dangling references rejected before output',async t=>{
 for(const mutate of [m=>m.media[0].path='../original.wav',m=>m.annotations[0].mediaId='missing']) {
  const {root,snapshot}=await fixture(t),out=await exportBundle({directory:path.join(root,'out'),password,snapshot});
  await rewrite(out.path,mutate); const destination=path.join(root,'managed');
  await assert.rejects(importBundle({path:out.path,password,directory:destination}),/Unsafe|Unknown/);
  await assert.rejects(fs.stat(destination),{code:'ENOENT'});
 }
});
test('media corruption and symlinks rejected',async t=>{
 for(const symlink of [false,true]) {
  const {root,snapshot}=await fixture(t),out=await exportBundle({directory:path.join(root,'out'),password,snapshot});
  const file=path.join(out.directory,'media',(await fs.readdir(path.join(out.directory,'media')))[0]);
  if(symlink){await fs.unlink(file);await fs.symlink(snapshot.media[0].path,file);}else await fs.writeFile(file,'modified');
  await assert.rejects(importBundle({path:out.path,password,directory:path.join(root,'managed')}),/integrity|Symlink/);
 }
});
test('existing output including empty directories is never overwritten',async t=>{
 const {root,snapshot}=await fixture(t),destination=path.join(root,'existing');await fs.mkdir(destination);
 await assert.rejects(exportBundle({directory:destination,password,snapshot}),/already exists/);
 const out=await exportBundle({directory:path.join(root,'out'),password,snapshot});
 await assert.rejects(importBundle({path:out.path,password,directory:destination}),/already exists/);
 assert.deepEqual(await fs.readdir(destination),[]);
});

test('changed source content or recorded size rejects export and removes staging',async t=>{
 for(const change of ['same-size-content','size-record']) {
  const {root,snapshot}=await fixture(t);
  if(change==='same-size-content') {
   const bytes=await fs.readFile(snapshot.media[0].path);bytes[0]^=1;await fs.writeFile(snapshot.media[0].path,bytes);
  } else snapshot.media[0].size+=1;
  const before=await fs.readdir(root);
  await assert.rejects(exportBundle({directory:path.join(root,'out'),password,snapshot}),/Source media changed/);
  assert.deepEqual(await fs.readdir(root),before);
 }
});
test('0.2 graph roundtrip and dependency selection',async t=>{
 const {root,snapshot}=await fixture(t);snapshot.templates=[{id:'t1',name:'Costume',fields:[]},{id:'t2',name:'Unrelated',fields:[]}];
 Object.assign(snapshot.annotations[0],{templateId:'t1',words:[{start:1,end:1.5,text:'hello',confidence:0.9}],keypoints:[{index:0,x:0.2,y:0.3,z:-0.45,visibility:0.8}],values:{color:'blue'},category:'costume',epistemic:'observed',confidence:0.8,polygon:[{x:0,y:0},{x:1,y:0},{x:0,y:1}],keyframes:[{time:1,region:{x:0,y:0,width:0.5,height:0.5}}]});
 snapshot.events=[{id:'ev1',name:'Appearance',entityIds:['e1'],annotationIds:['a1'],changes:[{entityId:'e1',key:'color',after:'blue'}]},{id:'ev2',entityIds:['e2'],annotationIds:['a2'],changes:[]}];
 snapshot.relations=[{id:'r1',fromEntityId:'e1',toEntityId:'e2',type:'knows',evidenceAnnotationIds:['a1']}];snapshot.stories=[{id:'s1',name:'Story',nodes:[{id:'n1',mediaId:'m1',start:1,end:3,eventIds:['ev1'],choices:[]}],variables:[],startNodeId:'n1'}];
 const out=await exportBundle({directory:path.join(root,'out'),password,snapshot});const all=await importBundle({path:out.path,password,directory:path.join(root,'all')});
 for(const key of ['annotations','templates','events','relations','stories'])assert.deepEqual(all[key],snapshot[key]);assert.equal(all.schema,'cutbox.desktop/0.3');
 const selected=await exportBundle({directory:path.join(root,'selected'),password,snapshot,entityIds:['e1']});const partial=await importBundle({path:selected.path,password,directory:path.join(root,'partial')});
 assert.deepEqual(partial.templates.map(x=>x.id),['t1']);assert.deepEqual(partial.events.map(x=>x.id),['ev1']);assert.equal(partial.relations.length,0);assert.equal(partial.stories.length,1);
});
test('legacy desktop 0.1 import fills new arrays',async t=>{
 const {root,snapshot}=await fixture(t),out=await exportBundle({directory:path.join(root,'out'),password,snapshot});
 await rewrite(out.path,m=>{m.schema='cutbox.desktop/0.1';for(const k of ['templates','events','relations','stories'])delete m[k];});
 const result=await importBundle({path:out.path,password,directory:path.join(root,'legacy')});assert.deepEqual(result.annotations,snapshot.annotations);assert.deepEqual(result.events,[]);
});
test('desktop 0.2 compatibility initializes productions and rejects dangling production output references',async t=>{
 const {root,snapshot}=await fixture(t),out=await exportBundle({directory:path.join(root,'out'),password,snapshot});
 await rewrite(out.path,m=>{m.schema='cutbox.desktop/0.2';delete m.productions;});const old=await importBundle({path:out.path,password,directory:path.join(root,'legacy2')});assert.deepEqual(old.productions,[]);
 await rewrite(out.path,m=>{m.schema='cutbox.desktop/0.3';m.productions=[{id:'p1',entityIds:[],annotationIds:[],shots:[{id:'s1',entityIds:[],annotationIds:[],outputMediaId:'missing'}]}];});
 await assert.rejects(importBundle({path:out.path,password,directory:path.join(root,'bad-production')}),/Unknown media reference/);await assert.rejects(fs.stat(path.join(root,'bad-production')),{code:'ENOENT'});
});
