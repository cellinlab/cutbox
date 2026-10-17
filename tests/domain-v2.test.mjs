import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDomain } from '../desktop/domain.mjs';

function fixture(t, options={}) {
  const directory=mkdtempSync(join(tmpdir(),'cutbox-domain-v2-'));
  let domain=createDomain({directory,...options});
  t.after(()=>{domain.close();rmSync(directory,{recursive:true,force:true});});
  return {directory,get domain(){return domain;},reopen(){domain.close();domain=createDomain({directory,...options});return domain;}};
}
function media(domain, patch={}) {return domain.addMedia({name:'scene.mp4',kind:'video',path:'/tmp/source-unavailable-cutbox.mp4',sha256:'a'.repeat(64),size:12,duration:10,...patch});}
function setup(domain) {
  const source=media(domain);
  const actor=domain.saveEntity({type:'actor',name:'演员'});
  const character=domain.saveEntity({type:'character',name:'角色',actorEntityId:actor.id,attributes:{age:30,alive:true},mediaIds:[source.id]});
  const scene=domain.saveEntity({type:'scene',name:'街道'});
  const template=domain.saveTemplate({name:'服装',fields:[{key:'color',label:'颜色',type:'select',required:true,options:['蓝','红']},{key:'count',label:'数量',type:'number'},{key:'wet',label:'淋湿',type:'boolean'}]});
  const annotation=domain.saveAnnotation({mediaId:source.id,entityId:character.id,start:1,end:4,label:'蓝外套',templateId:template.id,values:{color:'蓝',count:1,wet:false},category:'costume',epistemic:'observed',confidence:0.8,tags:['雨夜'],polygon:[{x:0,y:0},{x:1,y:0},{x:1,y:1}],trackId:'track-1',keyframes:[{time:1,region:{x:0,y:0,width:0.3,height:1}},{time:4,region:{x:0.7,y:0,width:0.3,height:1}}]});
  const event=domain.saveEvent({name:'相遇',entityIds:[character.id],annotationIds:[annotation.id],sceneId:scene.id,storyTime:-1,epistemic:'interpreted',confidence:0.6,changes:[{entityId:character.id,key:'alive',before:true,after:false}]});
  const relation=domain.saveRelation({fromEntityId:character.id,toEntityId:scene.id,type:'located_in',evidenceAnnotationIds:[annotation.id]});
  const story=domain.saveStory({name:'分支',description:'',variables:[{id:'visited',name:'到访',type:'boolean',initial:false}],startNodeId:'entry',nodes:[{id:'entry',title:'街道',body:'',kind:'scene',mediaId:source.id,start:1,end:4,eventIds:[event.id],choices:[{id:'go',label:'离开',targetId:'end',conditions:[],effects:[{variable:'visited',op:'set',value:true}]}]},{id:'end',title:'结束',body:'',kind:'ending',choices:[]}]});
  return {source,actor,character,scene,template,annotation,event,relation,story};
}

test('schema v1 migrates metadata without losing IDs or associations',t=>{
  const directory=mkdtempSync(join(tmpdir(),'cutbox-migration-'));
  const db=new DatabaseSync(join(directory,'cutbox.sqlite'));
  const legacy={media:[{id:'m',name:'old.wav',kind:'audio',path:'/tmp/old.wav',sha256:'b'.repeat(64),size:12,duration:5,createdAt:'2026-01-01'}],entities:[{id:'e',type:'sound',name:'对白',description:'',tags:[],mediaIds:['m'],createdAt:'2026-01-01',updatedAt:'2026-01-01'}],annotations:[{id:'a',mediaId:'m',entityId:'e',start:1,end:2,label:'一句话',notes:'原始',reviewState:'accepted'}],collections:[{id:'c',name:'旧库',description:'',mediaIds:['m'],entityIds:['e'],annotationIds:['a']}]};
  for(const [table,rows]of Object.entries(legacy)){db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`);for(const row of rows)db.prepare(`INSERT INTO ${table} VALUES (?,?)`).run(row.id,JSON.stringify(row));}
  db.exec('PRAGMA user_version=1');db.close();
  const domain=createDomain({directory});t.after(()=>{domain.close();rmSync(directory,{recursive:true,force:true});});
  const snap=domain.snapshot();assert.equal(snap.annotations[0].id,'a');assert.equal(snap.annotations[0].entityId,'e');assert.equal(snap.annotations[0].notes,'原始');assert.equal(snap.annotations[0].epistemic,'observed');assert.deepEqual(snap.templates,[]);assert.deepEqual(domain.history().entries,[]);
  const inspect=new DatabaseSync(join(directory,'cutbox.sqlite'));assert.equal(inspect.prepare('PRAGMA user_version').get().user_version,2);inspect.close();
});

test('typed templates and edits reject invalid existing annotation values atomically',t=>{
  const {domain}=fixture(t);const {template,annotation}=setup(domain);const before=domain.snapshot(),history=domain.history();
  for(const input of [{values:{color:'绿'}},{values:{color:'蓝',count:'one'}},{values:{color:'蓝',wet:0}},{values:{}},{values:{color:'蓝',extra:1}}])assert.throws(()=>domain.saveAnnotation({id:annotation.id,...input}));
  assert.throws(()=>domain.saveTemplate({id:template.id,fields:[{key:'color',label:'颜色',type:'select',required:true,options:['黑']}]}));
  assert.throws(()=>domain.saveTemplate({name:'bad',fields:[{key:'constructor',label:'unsafe',type:'text'}]}));
  assert.throws(()=>domain.saveEntity({type:'prop',name:'bad',attributes:JSON.parse('{"__proto__":"bad"}')}));
  assert.deepEqual(domain.snapshot(),before);assert.deepEqual(domain.history(),history);
});

test('geometry, keyframe times and epistemic values validate while edits preserve evidence',t=>{
  const {domain}=fixture(t);const {annotation}=setup(domain);const before=domain.snapshot();
  for(const patch of [{confidence:1.1},{confidence:NaN},{epistemic:'guessed'},{polygon:[{x:0,y:0},{x:0,y:0},{x:0,y:0}]},{polygon:[{x:0,y:0},{x:2,y:0},{x:0,y:1}]},{keyframes:[{time:4,region:{x:0,y:0,width:1,height:1}},{time:1,region:{x:0,y:0,width:1,height:1}}]},{start:2}])assert.throws(()=>domain.saveAnnotation({id:annotation.id,...patch}));
  assert.deepEqual(domain.snapshot(),before);
  const updated=domain.saveAnnotation({id:annotation.id,notes:'解释补充'});assert.equal(updated.trackId,'track-1');assert.deepEqual(updated.polygon,annotation.polygon);assert.equal(updated.epistemic,'observed');
});

test('dependent entity edits/deletes and evidence deletes reject without dangling links',t=>{
  const {domain}=fixture(t);const g=setup(domain);const before=domain.snapshot();
  for(const action of [()=>domain.deleteTemplate(g.template.id),()=>domain.deleteEntity(g.actor.id),()=>domain.saveEntity({id:g.actor.id,type:'prop'}),()=>domain.deleteEntity(g.character.id),()=>domain.saveEntity({id:g.scene.id,type:'prop'}),()=>domain.deleteAnnotation(g.annotation.id),()=>domain.deleteEvent(g.event.id)])assert.throws(action);
  assert.deepEqual(domain.snapshot(),before);
  domain.deleteStory(g.story.id);domain.deleteEvent(g.event.id);domain.deleteRelation(g.relation.id);domain.deleteAnnotation(g.annotation.id);domain.deleteTemplate(g.template.id);domain.deleteEntity(g.character.id);domain.deleteEntity(g.actor.id);
  assert.equal(domain.snapshot().media.length,1);
});

test('persistent undo redo bounded history survives restarts and new branches discard redo',t=>{
  const f=fixture(t,{historyLimit:3});let e=f.domain.saveEntity({type:'prop',name:'1'});
  for(const name of ['2','3','4','5'])e=f.domain.saveEntity({id:e.id,name});
  assert.equal(f.domain.history().entries.length,3);assert.equal(f.reopen().history().canUndo,true);
  assert.equal(f.domain.undo().entities[0].name,'4');assert.equal(f.reopen().history().canRedo,true);
  assert.equal(f.domain.redo().entities[0].name,'5');f.domain.undo();f.domain.undo();assert.equal(f.domain.undo().entities[0].name,'2');assert.throws(()=>f.domain.undo(),/Nothing to undo/);
  f.domain.saveEntity({id:e.id,name:'new branch'});assert.equal(f.domain.history().canRedo,false);assert.throws(()=>f.domain.redo(),/Nothing to redo/);
  assert.equal(f.reopen().snapshot().entities[0].name,'new branch');
});

test('full graph import remaps actor/template/event/story references and preserves canonical original',t=>{
  const {domain}=fixture(t);const g=setup(domain);const old=domain.snapshot();
  const result=domain.importSnapshot(old);
  assert.equal(result.media.length,1);assert.equal(result.stories.length,2);
  const a=result.annotations[1],e=result.events[1],s=result.stories[1],r=result.relations[1];
  assert.notEqual(a.templateId,g.template.id);assert.equal(a.templateId,result.templates[1].id);assert.notEqual(a.trackId,g.annotation.trackId);
  assert.equal(result.entities[4].actorEntityId,result.entities[3].id);assert.equal(e.changes[0].entityId,result.entities[4].id);
  assert.equal(e.sceneId,result.entities[5].id);assert.deepEqual(s.nodes[0].eventIds,[e.id]);assert.equal(s.nodes[0].mediaId,g.source.id);assert.deepEqual(r.evidenceAnnotationIds,[a.id]);assert.deepEqual(result.annotations[0],old.annotations[0]);
  domain.undo();assert.deepEqual(domain.snapshot(),old);domain.redo();assert.deepEqual(domain.snapshot(),result);
});

test('replaceSnapshot preserves IDs and rolls back corrupt graphs, restore is one undoable operation',t=>{
  const {domain}=fixture(t);setup(domain);const backup=domain.snapshot();domain.saveEntity({type:'prop',name:'new'});const before=domain.snapshot();
  assert.deepEqual(domain.replaceSnapshot(backup),backup);assert.deepEqual(domain.undo(),before);domain.redo();
  const bad=structuredClone(backup);bad.events[0].changes[0].entityId='missing';const history=domain.history();assert.throws(()=>domain.replaceSnapshot(bad));assert.deepEqual(domain.snapshot(),backup);assert.deepEqual(domain.history(),history);
  const badStory=structuredClone(backup);badStory.stories[0].nodes[0].eventIds=['missing'];assert.throws(()=>domain.importSnapshot(badStory));assert.deepEqual(domain.snapshot(),backup);
});

test('legacy four-array imports remain valid and template ID collisions never overwrite',t=>{
  const {domain}=fixture(t);const g=setup(domain);const snap=domain.snapshot();const legacy={media:snap.media,entities:[],annotations:[],collections:[]};
  assert.equal(domain.importSnapshot(legacy).media.length,1);const newTemplate=domain.saveTemplate({id:g.template.id,name:'renamed'});assert.equal(newTemplate.name,'renamed');assert.equal(domain.snapshot().annotations[0].templateId,g.template.id);
});

test('verified relink preserves source identity and missing-source duplicate import repairs path',t=>{
  const f=fixture(t),original=join(f.directory,'original.wav'),replacement=join(f.directory,'replacement.wav'),bad=join(f.directory,'wrong.wav');
  const bytes=Buffer.from('synthetic original');writeFileSync(original,bytes);writeFileSync(replacement,bytes);writeFileSync(bad,Buffer.from('synthetic modified'));
  const m=media(f.domain,{path:original,kind:'audio',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length});
  const mark=f.domain.saveAnnotation({mediaId:m.id,start:0,end:1,label:'声音'});
  assert.throws(()=>f.domain.updateMedia({id:m.id,path:bad}),/mismatch/);assert.throws(()=>f.domain.updateMedia({id:m.id,sha256:'c'.repeat(64)}),/immutable/);
  assert.equal(f.domain.updateMedia({id:m.id,path:replacement,series:'剧集',episode:'03'}).series,'剧集');assert.equal(f.domain.snapshot().annotations[0].mediaId,m.id);
  rmSync(replacement);const updated=f.domain.addMedia({...m,id:undefined,path:original});assert.equal(updated.id,m.id);assert.equal(updated.path,original);assert.equal(f.domain.snapshot().annotations[0].id,mark.id);assert.deepEqual(readFileSync(original),bytes);
});

test('batch annotation saves succeed atomically and form a single undo revision',t=>{
  const {domain}=fixture(t);const m=media(domain),before=domain.snapshot(),historyLength=domain.history().entries.length;
  const after=domain.saveAnnotations({annotations:[{mediaId:m.id,start:0,end:1,label:'first'},{mediaId:m.id,start:1,end:2,label:'second'}]});
  assert.equal(after.annotations.length,2);assert.equal(domain.history().entries.length,historyLength+1);
  assert.deepEqual(domain.undo(),before);assert.deepEqual(domain.redo(),after);
  assert.throws(()=>domain.saveAnnotations({annotations:[{mediaId:m.id,start:2,end:3,label:'third'},{mediaId:m.id,start:0,end:99,label:'invalid'}]}));assert.deepEqual(domain.snapshot(),after);
});

test('external source anchors survive import, edit and restore without being mistaken for graph references',t=>{
  const {domain}=fixture(t);const sourceAnchor={mediaId:'external-original',sha256:'f'.repeat(64),start:20,end:30,duration:60,width:1920,height:1080};
  const m=media(domain,{sourceAnchor});const a=domain.saveAnnotation({mediaId:m.id,start:1,end:2,label:'trimmed',sourceAnchor:{mediaId:'external-original',start:21,end:22}});
  const backup=domain.snapshot();const imported=domain.importSnapshot(backup);assert.deepEqual(imported.media[0].sourceAnchor,sourceAnchor);assert.deepEqual(imported.annotations[1].sourceAnchor,a.sourceAnchor);
  assert.deepEqual(domain.saveAnnotation({id:a.id,notes:'edited'}).sourceAnchor,a.sourceAnchor);assert.deepEqual(domain.replaceSnapshot(backup),backup);
  const bad=structuredClone(backup);bad.media[0].sourceAnchor.end=99;assert.throws(()=>domain.replaceSnapshot(bad),/duration/);assert.deepEqual(domain.snapshot(),backup);
});

test('word timing and pose keypoints survive edit import undo and reopen without data loss',t=>{
  const f=fixture(t);const m=media(f.domain);
  const words=[{start:1,end:1.5,text:'你好',confidence:0.9},{start:1.5,end:2,text:'世界',confidence:0.85}];
  const keypoints=[{index:0,x:0.2,y:0.3,z:-0.5,visibility:0.9},{index:10,x:1,y:0,z:0.4,visibility:0}];
  const a=f.domain.saveAnnotation({mediaId:m.id,start:1,end:3,label:'模型建议',reviewState:'suggested',words,keypoints});
  assert.deepEqual(f.domain.saveAnnotation({id:a.id,reviewState:'accepted'}).words,words);
  const before=f.domain.snapshot();const imported=f.domain.importSnapshot(before);
  assert.deepEqual(imported.annotations[1].keypoints,keypoints);assert.deepEqual(imported.annotations[1].words,words);
  assert.deepEqual(f.domain.undo(),before);assert.deepEqual(f.domain.redo(),imported);assert.deepEqual(f.reopen().snapshot(),imported);
});

test('word and keypoint validation rejects broken timing indices bounds and audio poses',t=>{
  const {domain}=fixture(t);const m=media(domain),a=domain.saveAnnotation({mediaId:m.id,start:1,end:3,label:'test'}),before=domain.snapshot();
  const word={start:1,end:2,text:'hello',confidence:0.9};const point={index:0,x:0.5,y:0.5,z:-1,visibility:1};
  for(const words of [[{...word,start:0}],[{...word,end:4}],[word,{...word,start:1.5,end:2.5}],[{...word,confidence:2}],[{...word,confidence:undefined}],[{...word,text:''}]])assert.throws(()=>domain.saveAnnotation({id:a.id,words}));
  for(const keypoints of [[point,point],[{...point,index:1.5}],[{...point,x:1.1}],[{...point,visibility:-1}],[{...point,z:Infinity}]])assert.throws(()=>domain.saveAnnotation({id:a.id,keypoints}));
  assert.deepEqual(domain.snapshot(),before);
  const audio=media(domain,{kind:'audio',sha256:'b'.repeat(64)});
  assert.throws(()=>domain.saveAnnotation({mediaId:audio.id,start:1,end:3,label:'invalid pose',keypoints:[point]}),/Audio annotations/);
  assert.deepEqual(domain.saveAnnotation({mediaId:audio.id,start:1,end:3,label:'speech',words:[word]}).words,[word]);
});

test('explicit unknown confidence stays null across semantic objects, history and import',t=>{
  const {domain}=fixture(t);const g=setup(domain);
  const annotation=domain.saveAnnotation({id:g.annotation.id,confidence:null});
  const event=domain.saveEvent({id:g.event.id,confidence:null});
  const relation=domain.saveRelation({id:g.relation.id,confidence:null});
  assert.equal(annotation.confidence,null);assert.equal(event.confidence,null);assert.equal(relation.confidence,null);
  const snapshot=domain.snapshot();domain.saveAnnotation({id:annotation.id,notes:'new note'});assert.equal(domain.snapshot().annotations[0].confidence,null);
  assert.deepEqual(domain.undo(),snapshot);
  const imported=domain.importSnapshot(snapshot);for(const table of ['annotations','events','relations'])assert.equal(imported[table][1].confidence,null);
  for(const invalid of [-0.1,1.1,Infinity,NaN,'unknown'])assert.throws(()=>domain.saveAnnotation({id:annotation.id,confidence:invalid}));
  assert.equal(domain.saveAnnotation({mediaId:g.source.id,start:0,end:1,label:'manual'}).confidence,1);
});
