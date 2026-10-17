import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDomain, validateSnapshot } from '../desktop/domain.mjs';

function fixture(t){const directory=mkdtempSync(join(tmpdir(),'cutbox-production-'));let domain=createDomain({directory});t.after(()=>{domain.close();rmSync(directory,{recursive:true,force:true});});return {directory,get domain(){return domain;},reopen(){domain.close();domain=createDomain({directory});return domain;}};}
function media(domain,patch={}){return domain.addMedia({name:'reference.mp4',kind:'video',path:'/tmp/cutbox-production-reference.mp4',sha256:'a'.repeat(64),size:1,duration:10,...patch});}
function graph(domain){
  const source=media(domain),output=media(domain,{name:'output.mp4',path:'/tmp/cutbox-production-output.mp4',sha256:'b'.repeat(64)});
  const entity=domain.saveEntity({type:'character',name:'观察者',mediaIds:[source.id]});
  const annotation=domain.saveAnnotation({mediaId:source.id,entityId:entity.id,start:1,end:3,label:'蓝色外套'});
  const production=domain.saveProduction({name:'雨夜相遇',description:'参考准备',status:'ready',target:'generic',aspectRatio:'16:9',entityIds:[entity.id],annotationIds:[annotation.id],notes:'无自动生成承诺',shots:[{name:'远景',description:'街道',duration:5,status:'selected',entityIds:[entity.id],annotationIds:[annotation.id],prompt:'雨夜街头，人物穿蓝色外套进入画面',negativePrompt:'无字幕',continuity:'服装保持一致',outputMediaId:output.id}]});
  return {source,output,entity,annotation,production};
}

test('production normalization, status requirements and invalid refs fail atomically',t=>{
  const {domain}=fixture(t);const {production}=graph(domain);assert.match(production.shots[0].id,/^[a-f0-9-]{36}$/);
  const baseline=domain.snapshot(),history=domain.history();
  const variants=[{entityIds:['missing']},{annotationIds:['missing']},{target:'fake-platform'},{aspectRatio:'2:1'},{status:'done'},{shots:[]},{shots:[{...production.shots[0],prompt:'  '}]},{shots:[{...production.shots[0],duration:0}]},{shots:[{...production.shots[0],duration:601}]},{shots:[{...production.shots[0],duration:NaN}]},{shots:[{...production.shots[0],outputMediaId:null}]},{shots:[{...production.shots[0],outputMediaId:'missing'}]},{shots:[production.shots[0],production.shots[0]]}];
  for(const patch of variants)assert.throws(()=>domain.saveProduction({id:production.id,...patch}));
  assert.deepEqual(domain.snapshot(),baseline);assert.deepEqual(domain.history(),history);
  const draft=domain.saveProduction({name:'空草稿'});assert.equal(draft.status,'draft');assert.deepEqual(draft.shots,[]);
  const textOnly=domain.saveProduction({name:'原创文本',status:'ready',shots:[{name:'纯文本镜头',duration:1,prompt:'原创场景'}]});assert.deepEqual(textOnly.shots[0].entityIds,[]);assert.equal(textOnly.shots[0].status,'planned');
});

test('production edit delete undo and redo persist after restart',t=>{
  const f=fixture(t);const {production}=graph(f.domain);const before=f.domain.snapshot();
  const edited=f.domain.saveProduction({id:production.id,target:'seedance',notes:'手工准备'});assert.equal(edited.shots[0].id,production.shots[0].id);assert.deepEqual(f.reopen().snapshot().productions[0],edited);
  assert.deepEqual(f.domain.undo(),before);assert.equal(f.reopen().history().canRedo,true);f.domain.redo();f.domain.deleteProduction(production.id);assert.equal(f.domain.snapshot().productions.length,0);assert.equal(f.domain.undo().productions[0].target,'seedance');
});

test('graph import regenerates production and shot IDs and remaps all evidence and output references',t=>{
  const {domain}=fixture(t);const original=graph(domain),before=domain.snapshot();const after=domain.importSnapshot(before),copy=after.productions[1];
  assert.notEqual(copy.id,original.production.id);assert.notEqual(copy.shots[0].id,original.production.shots[0].id);
  assert.deepEqual(copy.entityIds,[after.entities[1].id]);assert.deepEqual(copy.shots[0].entityIds,[after.entities[1].id]);assert.deepEqual(copy.annotationIds,[after.annotations[1].id]);assert.deepEqual(copy.shots[0].annotationIds,[after.annotations[1].id]);assert.equal(copy.shots[0].outputMediaId,original.output.id);assert.equal(after.media.length,2);
  assert.deepEqual(domain.undo(),before);assert.deepEqual(domain.redo(),after);assert.deepEqual(domain.replaceSnapshot(before),before);
});

test('entity and annotation deletion prune production evidence and demote ready for review',t=>{
  const {domain}=fixture(t);const {entity,annotation,production}=graph(domain),before=domain.snapshot();
  domain.deleteEntity(entity.id);let p=domain.snapshot().productions[0];assert.deepEqual(p.entityIds,[]);assert.deepEqual(p.shots[0].entityIds,[]);assert.equal(p.status,'review');assert.equal(domain.snapshot().annotations[0].entityId,undefined);assert.deepEqual(domain.undo(),before);
  domain.deleteAnnotation(annotation.id);p=domain.snapshot().productions[0];assert.deepEqual(p.annotationIds,[]);assert.deepEqual(p.shots[0].annotationIds,[]);assert.equal(p.status,'review');assert.equal(p.shots[0].status,'selected');
  assert.equal(p.id,production.id);
});

test('output media metadata deletion demotes selected shots but keeps original file bytes',t=>{
  const f=fixture(t);const outputPath=join(f.directory,'output.mp4');writeFileSync(outputPath,'x');const output=media(f.domain,{path:outputPath});
  const production=f.domain.saveProduction({name:'测试',status:'ready',shots:[{name:'镜头',duration:2,prompt:'画面',status:'selected',outputMediaId:output.id}]});
  f.domain.deleteMedia(output.id);const p=f.domain.snapshot().productions[0];assert.equal(p.status,'review');assert.equal(p.shots[0].status,'planned');assert.equal(p.shots[0].outputMediaId,undefined);assert.equal(readFileSync(outputPath,'utf8'),'x');assert.equal(f.domain.undo().productions[0].shots[0].outputMediaId,output.id);assert.equal(production.shots[0].status,'selected');
  f.domain.saveAnnotation({mediaId:output.id,start:0,end:1,label:'不可悬空'});assert.throws(()=>f.domain.deleteMedia(output.id),/Unknown media/);assert.equal(f.domain.snapshot().productions[0].status,'ready');
});

test('schema v2 and its undo history migrate without losing prior objects or IDs',t=>{
  const directory=mkdtempSync(join(tmpdir(),'cutbox-production-migrate-'));let domain=createDomain({directory});
  const entity=domain.saveEntity({type:'prop',name:'旧道具'});domain.saveEntity({id:entity.id,name:'新版旧道具'});domain.close();
  const db=new DatabaseSync(join(directory,'cutbox.sqlite'));db.exec('DROP TABLE productions; PRAGMA user_version=2');
  for(const row of db.prepare('SELECT id,before,after FROM revisions').all()){
    const before=JSON.parse(row.before),after=JSON.parse(row.after);delete before.productions;delete after.productions;db.prepare('UPDATE revisions SET before=?,after=? WHERE id=?').run(JSON.stringify(before),JSON.stringify(after),row.id);
  }db.close();
  domain=createDomain({directory});t.after(()=>{domain.close();rmSync(directory,{recursive:true,force:true});});assert.deepEqual(domain.snapshot().productions,[]);assert.equal(domain.snapshot().entities[0].id,entity.id);assert.equal(domain.undo().entities[0].name,'旧道具');assert.deepEqual(domain.snapshot().productions,[]);assert.equal(domain.redo().entities[0].name,'新版旧道具');
  const check=new DatabaseSync(join(directory,'cutbox.sqlite'));assert.equal(check.prepare('PRAGMA user_version').get().user_version,3);check.close();
  const oldSnapshot=domain.snapshot();delete oldSnapshot.productions;assert.deepEqual(domain.replaceSnapshot(oldSnapshot).productions,[]);assert.deepEqual(domain.importSnapshot(oldSnapshot).productions,[]);
});

test('bulk graph validates and imports 10,000 linked annotations with indexed references and atomic bulk edits',t=>{
  const {domain}=fixture(t),at='2026-10-17T00:00:00.000Z';
  const input={
    media:Array.from({length:1000},(_,i)=>({id:`m${i}`,name:`片段${i}`,kind:'video',path:`/tmp/cutbox-bulk-missing-${i}.mp4`,sha256:i.toString(16).padStart(64,'0'),size:1,duration:10,createdAt:at})),
    entities:Array.from({length:1000},(_,i)=>({id:`e${i}`,type:'character',name:`角色${i}`,mediaIds:[`m${i}`],createdAt:at,updatedAt:at})),
    annotations:Array.from({length:10000},(_,i)=>({id:`a${i}`,mediaId:`m${i%1000}`,entityId:`e${i%1000}`,start:1,end:2,label:`动作${i}`,createdAt:at,updatedAt:at})),
    collections:[{id:'c',name:'批量证据',annotationIds:Array.from({length:10000},(_,i)=>`a${i}`),createdAt:at,updatedAt:at}],
  };
  const start=performance.now();const normalized=validateSnapshot(input);const validatedAt=performance.now();const imported=domain.importSnapshot(input);const importedAt=performance.now();
  assert.equal(normalized.annotations.length,10000);assert.equal(imported.annotations.length,10000);assert.equal(imported.collections[0].annotationIds.length,10000);
  const mediaById=new Map(imported.media.map(m=>[m.id,m])),entityById=new Map(imported.entities.map(e=>[e.id,e]));
  for(const a of imported.annotations){assert.ok(mediaById.has(a.mediaId));assert.deepEqual(entityById.get(a.entityId).mediaIds,[a.mediaId]);}
  const changed=domain.saveAnnotations({annotations:imported.annotations.map(a=>({id:a.id,notes:'人工复核'}))});assert.ok(changed.annotations.every(a=>a.notes==='人工复核'));
  assert.deepEqual(domain.undo(),imported);
  const broken=structuredClone(input);broken.annotations.at(-1).entityId='missing';assert.throws(()=>domain.importSnapshot(broken),/Unknown entities/);assert.equal(domain.snapshot().annotations.length,10000);
  const duplicate=structuredClone(input);duplicate.annotations.at(-1).id='a0';assert.throws(()=>validateSnapshot(duplicate),/Duplicate import annotations/);
  const memory=process.memoryUsage();t.diagnostic(`10k graph validation ${(validatedAt-start).toFixed(1)} ms; import ${(importedAt-validatedAt).toFixed(1)} ms; process RSS ${(memory.rss/1048576).toFixed(1)} MiB, heap ${(memory.heapUsed/1048576).toFixed(1)} MiB (includes test copies/history)`);
});

test('generated takes preserve provenance and selected output independently through reopen and graph import',t=>{
  const f=fixture(t);const {production,output}=graph(f.domain);
  const saved=f.domain.saveProduction({id:production.id,shots:[{...production.shots[0],takes:[{mediaId:output.id,provider:'manual workflow',model:'local-model-v1',prompt:'雨夜行走',negativePrompt:'无字幕',seed:'18446744073709551615',externalTaskId:'external-42',notes:'人工挑选'}]}]});
  const take=saved.shots[0].takes[0];assert.match(take.id,/^[a-f0-9-]{36}$/);assert.match(take.createdAt,/^\d{4}-/);assert.equal(take.seed,'18446744073709551615');assert.deepEqual(f.reopen().snapshot().productions[0],saved);
  const imported=f.domain.importSnapshot(f.domain.snapshot()),copy=imported.productions[1].shots[0].takes[0];assert.notEqual(copy.id,take.id);assert.equal(copy.mediaId,output.id);assert.equal(copy.prompt,take.prompt);assert.equal(copy.externalTaskId,take.externalTaskId);
  const fresh=fixture(t).domain.importSnapshot(f.domain.snapshot());const freshTake=fresh.productions[0].shots[0].takes[0];assert.notEqual(freshTake.mediaId,output.id);assert.equal(freshTake.mediaId,fresh.productions[0].shots[0].outputMediaId);assert.ok(fresh.media.some(m=>m.id===freshTake.mediaId));
  f.domain.deleteMedia(output.id);for(const p of f.domain.snapshot().productions){assert.deepEqual(p.shots[0].takes,[]);assert.equal(p.shots[0].status,'planned');assert.equal(p.status,'review');}
  f.domain.undo();assert.deepEqual(f.domain.snapshot(),imported);
});

test('invalid generation provenance rejects without partial writes or fabricated identifiers',t=>{
  const {domain}=fixture(t);const {production,output}=graph(domain),before=domain.snapshot();
  const take={id:'take-1',mediaId:output.id};
  for(const takes of [[{...take,mediaId:'missing'}],[take,take],[{...take,seed:42}],[{...take,seed:'x'.repeat(101)}],[{...take,createdAt:'yesterday'}]])assert.throws(()=>domain.saveProduction({id:production.id,shots:[{...production.shots[0],takes}]}));
  assert.deepEqual(domain.snapshot(),before);
  const valid=domain.saveProduction({id:production.id,shots:[{...production.shots[0],takes:[take]}]});assert.equal(valid.shots[0].takes[0].provider,'');assert.equal(valid.shots[0].takes[0].model,'');
});

test('indexed media dedup keeps first existing equal-hash identity for restored legacy duplicate records',t=>{
  const {domain}=fixture(t);const first=media(domain),input=domain.snapshot();input.media.push({...first,id:'legacy-duplicate'});domain.replaceSnapshot(input);
  const imported=domain.importSnapshot({media:[{...first,id:'foreign'}],entities:[],annotations:[{id:'foreign-a',mediaId:'foreign',start:0,end:1,label:'source identity'}],collections:[]});
  assert.equal(imported.annotations[0].mediaId,first.id);assert.equal(imported.media.length,2);
});
