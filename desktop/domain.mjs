import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { validateStory } from './story.mjs';

const TABLES = ['media', 'entities', 'annotations', 'collections', 'templates', 'events', 'relations', 'stories', 'productions'];
const OLD = TABLES.slice(0, 4);
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : fail('Expected an object');
const string = (v, key, empty = false) => typeof v === 'string' && v.length <= 100000 && (empty || v.trim()) ? v : fail(`${key} must be a string${empty ? '' : ' and not empty'}`);
const finite = (v, key) => typeof v === 'number' && Number.isFinite(v) ? v : fail(`${key} must be finite`);
const number = (v, key) => finite(v, key) >= 0 ? v : fail(`${key} must be nonnegative`);
const choice = (v, values, key) => values.includes(v) ? v : fail(`Invalid ${key}`);
const strings = (v, key) => Array.isArray(v) ? [...new Set(v.map(x => string(x, key)))] : fail(`${key} must be an array`);
const scalar = (v, key) => ['string', 'boolean'].includes(typeof v) || (typeof v === 'number' && Number.isFinite(v)) ? v : fail(`${key} must be a scalar`);
const safeKey = key => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) && !['__proto__', 'prototype', 'constructor'].includes(key) ? key : fail('Unsafe field key');
const attributes = (value = {}) => Object.fromEntries(Object.entries(object(value)).map(([k,v]) => [safeKey(k), scalar(v, k)]));
const optional = v => v !== undefined && v !== null && v !== '';
const absolute = (v, key) => isAbsolute(string(v, key)) ? v : fail(`${key} must be absolute`);
const epistemic = v => choice(v ?? 'observed', ['observed', 'interpreted', 'invented'], 'epistemic');
const confidence = v => v === null ? null : number(v ?? 1, 'confidence') <= 1 ? (v ?? 1) : fail('confidence must be within 0..1');
const rect = input => {
  object(input);
  const r = Object.fromEntries(['x','y','width','height'].map(k => [k, number(input[k], `region.${k}`)]));
  if (r.width <= 0 || r.height <= 0 || r.x + r.width > 1 || r.y + r.height > 1) fail('Region must be a nonempty rectangle within normalized image bounds');
  return r;
};
const sourceAnchor = (value, media = false) => {
  object(value);
  const result={mediaId:string(value.mediaId,'sourceAnchor.mediaId'),start:number(value.start,'sourceAnchor.start'),end:number(value.end,'sourceAnchor.end')};
  if(result.start>result.end)fail('Invalid source anchor range');
  if(media){
    result.sha256=string(value.sha256,'sourceAnchor.sha256');if(!/^[a-f0-9]{64}$/.test(result.sha256))fail('Invalid source anchor SHA-256');
    result.duration=number(value.duration,'sourceAnchor.duration');if(result.end>result.duration)fail('Source anchor exceeds duration');
    for(const k of ['width','height'])if(value[k]!==undefined){result[k]=number(value[k],`sourceAnchor.${k}`);if(!Number.isSafeInteger(result[k])||result[k]===0)fail('Invalid source anchor dimensions');}
  }
  return result;
};
const stamps = v => ({ createdAt: string(v.createdAt ?? new Date().toISOString(), 'createdAt'), updatedAt: string(v.updatedAt ?? v.createdAt ?? new Date().toISOString(), 'updatedAt') });

/** Validate the entire graph, including dependencies affected by an edit. No file IO. */
export function validateSnapshot(input) {
  object(input);
  const data = {};
  for (const table of TABLES) {
    const list = input[table] ?? (OLD.includes(table) ? fail(`${table} must be an array`) : []);
    if (!Array.isArray(list)) fail(`${table} must be an array`);
    const seen = new Set();
    data[table] = list.map(item => {
      object(item); const id = string(item.id, `${table} id`);
      if (seen.has(id)) fail(`Duplicate import ${table} id: ${id}`);
      seen.add(id); return { ...item, id };
    });
  }
  const indexes = Object.fromEntries(TABLES.map(table=>[table,new Map(data[table].map(item=>[item.id,item]))]));
  const refresh = table => { indexes[table]=new Map(data[table].map(item=>[item.id,item])); };
  const ref = (table, id) => indexes[table].get(string(id, `${table} id`)) ?? fail(`Unknown ${table} id: ${id}`);
  const refs = (table, ids = []) => strings(ids, `${table} references`).map(id => ref(table, id).id);
  data.media = data.media.map(v => {
    const sha256 = string(v.sha256, 'sha256').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) fail('sha256 must be a SHA-256 hexadecimal digest');
    const r = { id:v.id, name:string(v.name,'name'), kind:choice(v.kind,['video','audio','image'],'media kind'), path:absolute(v.path,'Media path'), sha256, size:number(v.size,'size'), duration:number(v.duration,'duration'), createdAt:stamps(v).createdAt };
    if (!Number.isSafeInteger(r.size)) fail('size must be a safe integer');
    for (const k of ['width','height']) if (v[k] !== undefined) { r[k] = number(v[k],k); if (!Number.isSafeInteger(r[k]) || !r[k]) fail(`${k} must be a positive integer`); }
    for (const k of ['thumbnailPath','proxyPath']) if (optional(v[k])) r[k] = absolute(v[k],k);
    for (const k of ['series','episode']) if (v[k] !== undefined) r[k] = string(v[k],k,true);
    if(v.sourceAnchor!=null)r.sourceAnchor=sourceAnchor(v.sourceAnchor,true);
    return r;
  });
  refresh('media');
  data.templates = data.templates.map(v => {
    if (!Array.isArray(v.fields) || v.fields.length > 100) fail('Template fields must be an array of at most 100');
    const seen = new Set();
    const fields = v.fields.map(f => {
      object(f); const key = safeKey(string(f.key,'field key'));
      if (seen.has(key)) fail('Duplicate template field key'); seen.add(key);
      const out = {key, label:string(f.label,'field label'), type:choice(f.type,['text','number','boolean','select'],'field type')};
      if (f.required !== undefined) { if (typeof f.required !== 'boolean') fail('required must be boolean'); out.required=f.required; }
      if (f.unit !== undefined) out.unit=string(f.unit,'unit',true);
      if (f.type === 'select') { out.options=strings(f.options,'options'); if (!out.options.length) fail('Select options must not be empty'); }
      return out;
    });
    return {id:v.id,name:string(v.name,'name'),description:string(v.description??'','description',true),fields,...stamps(v)};
  });
  refresh('templates');
  data.entities = data.entities.map(v => {
    const r = {id:v.id,type:choice(v.type,['character','scene','prop','sound','actor'],'entity type'),name:string(v.name,'name'),description:string(v.description??'','description',true),tags:strings(v.tags??[],'tags'),mediaIds:refs('media',v.mediaIds),attributes:attributes(v.attributes),...stamps(v)};
    if (optional(v.coverMediaId)) { if (!r.mediaIds.includes(v.coverMediaId)) fail('coverMediaId must belong to mediaIds'); r.coverMediaId=v.coverMediaId; }
    if (optional(v.actorEntityId)) { if (r.type !== 'character' || ref('entities',v.actorEntityId).type !== 'actor') fail('actorEntityId requires character linked to actor'); r.actorEntityId=v.actorEntityId; }
    return r;
  });
  refresh('entities');
  data.annotations = data.annotations.map(v => {
    const media=ref('media',v.mediaId);
    const r={id:v.id,mediaId:media.id,start:number(v.start,'start'),end:number(v.end,'end'),label:string(v.label,'label'),notes:string(v.notes??'','notes',true),reviewState:choice(v.reviewState??'accepted',['suggested','accepted','needs_review'],'reviewState'),category:string(v.category??'general','category'),epistemic:epistemic(v.epistemic),confidence:confidence(v.confidence),tags:strings(v.tags??[],'tags'),values:attributes(v.values),...stamps(v)};
    if (r.start>r.end || r.end>media.duration) fail('Annotation range must be within media duration');
    if (optional(v.entityId)) r.entityId=ref('entities',v.entityId).id;
    if (optional(v.trackId)) r.trackId=string(v.trackId,'trackId');
    if(v.sourceAnchor!=null)r.sourceAnchor=sourceAnchor(v.sourceAnchor);
    if (optional(v.templateId)) {
      const template=ref('templates',v.templateId); r.templateId=template.id;
      for (const key of Object.keys(r.values)) if (!template.fields.some(f=>f.key===key)) fail(`Unknown template field: ${key}`);
      for (const f of template.fields) {
        const value=r.values[f.key];
        if (value===undefined) { if (f.required) fail(`Required field: ${f.key}`); continue; }
        if (f.type==='text' && typeof value!=='string' || f.type==='number' && typeof value!=='number' || f.type==='boolean' && typeof value!=='boolean' || f.type==='select' && !f.options.includes(value)) fail(`Invalid template value: ${f.key}`);
        if (f.required && typeof value==='string' && !value.trim()) fail(`Required field: ${f.key}`);
      }
    }
    if (v.region != null) r.region=rect(v.region);
    if (v.polygon != null) {
      if (!Array.isArray(v.polygon) || v.polygon.length<3 || v.polygon.length>10000) fail('Polygon requires 3..10000 points');
      r.polygon=v.polygon.map(p=>{object(p);const x=number(p.x,'polygon.x'),y=number(p.y,'polygon.y');if(x>1||y>1)fail('Polygon outside normalized bounds');return {x,y};});
      const area=r.polygon.reduce((a,p,i)=>{const q=r.polygon[(i+1)%r.polygon.length];return a+p.x*q.y-q.x*p.y;},0);
      if(Math.abs(area)<1e-12)fail('Polygon must have nonzero area');
    }
    if (v.keyframes != null) {
      if (!Array.isArray(v.keyframes) || v.keyframes.length>10000) fail('Invalid keyframes');
      let last=-Infinity;
      r.keyframes=v.keyframes.map(k=>{object(k);const time=number(k.time,'keyframe time');if(time<=last||time<r.start||time>r.end)fail('Keyframes must be ordered, unique and inside annotation range');last=time;return {time,region:rect(k.region)};});
    }
    if(v.words!=null){
      if(!Array.isArray(v.words)||v.words.length>10000)fail('Words must be an array of at most 10000');
      let previousEnd=r.start;
      r.words=v.words.map(word=>{
        object(word);const start=number(word.start,'word.start'),end=number(word.end,'word.end');
        if(start<previousEnd||start>end||end>r.end)fail('Words must be ordered, nonoverlapping and within annotation range');
        previousEnd=end;
        return {start,end,text:string(word.text,'word.text'),confidence:confidence(number(word.confidence,'word.confidence'))};
      });
    }
    if(v.keypoints!=null){
      if(!Array.isArray(v.keypoints)||v.keypoints.length>1000)fail('Keypoints must be an array of at most 1000');
      const indices=new Set();
      r.keypoints=v.keypoints.map(point=>{
        object(point);const index=number(point.index,'keypoint.index');
        if(!Number.isSafeInteger(index)||indices.has(index))fail('Keypoint indices must be unique nonnegative integers');indices.add(index);
        const x=number(point.x,'keypoint.x'),y=number(point.y,'keypoint.y'),visibility=number(point.visibility,'keypoint.visibility');
        if(x>1||y>1||visibility>1)fail('Keypoint coordinates and visibility must be within 0..1');
        return {index,x,y,z:finite(point.z,'keypoint.z'),visibility};
      });
    }
    if(media.kind==='audio'&&(r.region||r.polygon||r.keyframes?.length||r.keypoints?.length))fail('Audio annotations cannot have image regions');
    return r;
  });
  refresh('annotations');
  data.collections=data.collections.map(v=>({id:v.id,name:string(v.name,'name'),description:string(v.description??'','description',true),mediaIds:refs('media',v.mediaIds),entityIds:refs('entities',v.entityIds),annotationIds:refs('annotations',v.annotationIds),...stamps(v)}));
  refresh('collections');
  data.events=data.events.map(v=>{
    const r={id:v.id,name:string(v.name,'name'),description:string(v.description??'','description',true),entityIds:refs('entities',v.entityIds),annotationIds:refs('annotations',v.annotationIds),epistemic:epistemic(v.epistemic),confidence:confidence(v.confidence),...stamps(v)};
    if(optional(v.sceneId)){if(ref('entities',v.sceneId).type!=='scene')fail('sceneId must reference a scene');r.sceneId=v.sceneId;}
    if(v.storyTime!==undefined)r.storyTime=finite(v.storyTime,'storyTime');
    if(!Array.isArray(v.changes??[]))fail('Event changes must be an array');
    r.changes=(v.changes??[]).map(c=>{object(c);ref('entities',c.entityId);if(!r.entityIds.includes(c.entityId))fail('State change entity must be an event participant');return {entityId:c.entityId,key:safeKey(string(c.key,'change key')),...(c.before!==undefined?{before:scalar(c.before,'before')} : {}),after:scalar(c.after,'after')};});
    return r;
  });
  refresh('events');
  data.relations=data.relations.map(v=>({id:v.id,fromEntityId:ref('entities',v.fromEntityId).id,toEntityId:ref('entities',v.toEntityId).id,type:string(v.type,'relation type'),description:string(v.description??'','description',true),evidenceAnnotationIds:refs('annotations',v.evidenceAnnotationIds),epistemic:epistemic(v.epistemic),confidence:confidence(v.confidence),...stamps(v)}));
  refresh('relations');
  data.stories=data.stories.map(v=>{
    const story={...v,...stamps(v)};
    const result=validateStory(story,data);
    return result;
  });
  refresh('stories');
  data.productions=data.productions.map(v=>{
    const result={id:v.id,name:string(v.name,'production name'),description:string(v.description??'','description',true),status:choice(v.status??'draft',['draft','review','ready'],'production status'),target:choice(v.target??'generic',['generic','seedance','libtv','tapnow'],'production target'),aspectRatio:choice(v.aspectRatio??'16:9',['16:9','9:16','1:1','4:3'],'aspectRatio'),entityIds:refs('entities',v.entityIds),annotationIds:refs('annotations',v.annotationIds),notes:string(v.notes??'','notes',true),...stamps(v)};
    if(!Array.isArray(v.shots??[])||(v.shots??[]).length>10000)fail('Production shots must be an array of at most 10000');
    const ids=new Set();
    result.shots=(v.shots??[]).map(shot=>{
      object(shot);const id=string(shot.id,'shot id');if(id.length>256||ids.has(id))fail('Shot IDs must be unique and at most 256 characters');ids.add(id);
      const duration=number(shot.duration,'shot duration');if(duration<=0||duration>600)fail('Shot duration must be greater than 0 and at most 600 seconds');
      const out={id,name:string(shot.name,'shot name'),description:string(shot.description??'','description',true),duration,status:choice(shot.status??'planned',['planned','generated','selected'],'shot status'),entityIds:refs('entities',shot.entityIds),annotationIds:refs('annotations',shot.annotationIds),prompt:string(shot.prompt??'','prompt',true),negativePrompt:string(shot.negativePrompt??'','negativePrompt',true),continuity:string(shot.continuity??'','continuity',true)};
      if(!Array.isArray(shot.takes??[])||(shot.takes??[]).length>10000)fail('Shot takes must be an array of at most 10000');
      const takeIds=new Set();
      out.takes=(shot.takes??[]).map(take=>{
        object(take);const id=string(take.id,'take id');if(id.length>256||takeIds.has(id))fail('Take IDs must be unique within each shot and at most 256 characters');takeIds.add(id);
        const result={id,mediaId:ref('media',take.mediaId).id,createdAt:string(take.createdAt??new Date().toISOString(),'take createdAt')};
        if(!/^\d{4}-\d{2}-\d{2}T/.test(result.createdAt)||!Number.isFinite(Date.parse(result.createdAt)))fail('Take createdAt must be an ISO timestamp');
        for(const key of ['provider','model','prompt','negativePrompt','notes'])result[key]=string(take[key]??'',`take ${key}`,true);
        if(take.seed!==undefined){result.seed=string(take.seed,'take seed',true);if(result.seed.length>100)fail('Take seed must be at most 100 characters');}
        if(take.externalTaskId!==undefined)result.externalTaskId=string(take.externalTaskId,'externalTaskId',true);
        return result;
      });
      if(optional(shot.outputMediaId))out.outputMediaId=ref('media',shot.outputMediaId).id;
      if(out.status==='selected'&&!out.outputMediaId)fail('Selected shot requires outputMediaId');
      return out;
    });
    if(result.status==='ready'&&(!result.shots.length||result.shots.some(shot=>!shot.prompt.trim())))fail('Ready production requires at least one shot and a prompt for every shot');
    return result;
  });
  refresh('productions');
  return data;
}

function verifyFile(path, expected) {
  absolute(path,'Media path');
  const stat=statSync(path);if(!stat.isFile()||stat.size!==expected.size)fail('Relink media size mismatch');
  const fd=openSync(path,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);
  try{let bytes;while((bytes=readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,bytes));}finally{closeSync(fd);}
  if(hash.digest('hex')!==expected.sha256)fail('Relink media SHA-256 mismatch');
}

/** Single writer, validated snapshots and bounded persistent metadata undo. Never edits source files. */
export function createDomain({directory,historyLimit=30}) {
  string(directory,'directory');if(!Number.isSafeInteger(historyLimit)||historyLimit<1||historyLimit>200)fail('historyLimit must be 1..200');
  mkdirSync(directory,{recursive:true});const db=new DatabaseSync(join(directory,'cutbox.sqlite'));
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version>3){db.close();fail('This database requires a newer version of CutBox');}
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  const raw=()=>Object.fromEntries(TABLES.map(t=>[t,db.prepare(`SELECT data FROM ${t} ORDER BY rowid`).all().map(r=>JSON.parse(r.data))]));
  const write=data=>{for(const t of TABLES){db.exec(`DELETE FROM ${t}`);const q=db.prepare(`INSERT INTO ${t}(id,data) VALUES (?,?)`);for(const item of data[t])q.run(item.id,JSON.stringify(item));}};
  try { tx(()=>{
    for(const t of TABLES)db.exec(`CREATE TABLE IF NOT EXISTS ${t}(id TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)))`);
    db.exec('CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY AUTOINCREMENT,operation TEXT NOT NULL,createdAt TEXT NOT NULL,before TEXT NOT NULL,after TEXT NOT NULL); CREATE TABLE IF NOT EXISTS domain_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL); INSERT OR IGNORE INTO domain_meta(key,value) VALUES (\'cursor\',0)');
    if(version<3){write(validateSnapshot(raw()));db.exec('PRAGMA user_version=3');}
  }); } catch(error){db.close();throw error;}
  const cursor=()=>db.prepare("SELECT value FROM domain_meta WHERE key='cursor'").get().value;
  const setCursor=id=>db.prepare("UPDATE domain_meta SET value=? WHERE key='cursor'").run(id);
  const mutation=(operation,fn)=>tx(()=>{
    const before=raw(), next=structuredClone(before), result=fn(next), after=validateSnapshot(next);
    const oldJson=JSON.stringify(before),newJson=JSON.stringify(after);
    if(oldJson!==newJson){
      write(after);db.prepare('DELETE FROM revisions WHERE id>?').run(cursor());
      const inserted=db.prepare('INSERT INTO revisions(operation,createdAt,before,after) VALUES (?,?,?,?)').run(operation,new Date().toISOString(),oldJson,newJson);
      setCursor(Number(inserted.lastInsertRowid));db.prepare('DELETE FROM revisions WHERE id NOT IN (SELECT id FROM revisions ORDER BY id DESC LIMIT ?)').run(historyLimit);
    }
    if(result?.table)return after[result.table].find(x=>x.id===result.id);
    return result??after;
  });
  const find=(data,table,id)=>data[table].find(x=>x.id===string(id,`${table} id`))??fail(`Unknown ${table} id: ${id}`);
  const save=(table,input)=>mutation(`save${table}`,data=>{
    object(input);const existing=input.id===undefined?undefined:find(data,table,input.id);const now=new Date().toISOString();
    const value={...existing,...input,id:existing?.id??randomUUID(),createdAt:existing?.createdAt??now,updatedAt:now};
    if(table==='productions' && Array.isArray(value.shots))value.shots=value.shots.map(shot=>({...object(shot),id:shot.id===undefined?randomUUID():shot.id,...(Array.isArray(shot.takes)?{takes:shot.takes.map(take=>({...object(take),id:take.id===undefined?randomUUID():take.id}))}:{})}));
    if(existing)data[table][data[table].indexOf(existing)]=value;else data[table].push(value);
    return {table,id:value.id};
  });
  const remove=(table,id,cleanup)=>mutation(`delete${table}`,data=>{find(data,table,id);cleanup?.(data);data[table]=data[table].filter(x=>x.id!==id);return {id};});
  const mergeMedia=(data,input,lookup)=>{
    const item=validateSnapshot({media:[{...input,id:input.id??randomUUID()}],entities:[],annotations:[],collections:[]}).media[0];
    const duplicate=lookup?lookup.byHash.get(item.sha256):data.media.find(x=>x.sha256===item.sha256);
    if(duplicate){
      if(duplicate.size!==item.size)fail('Duplicate SHA-256 has inconsistent media size');
      if(!existsSync(duplicate.path) && existsSync(item.path)){verifyFile(item.path,duplicate);duplicate.path=item.path;delete duplicate.proxyPath;delete duplicate.thumbnailPath;if(item.thumbnailPath)duplicate.thumbnailPath=item.thumbnailPath;}
      return duplicate.id;
    }
    if(lookup?lookup.byId.has(item.id):data.media.some(x=>x.id===item.id))fail('Media id already exists');data.media.push(item);if(lookup){lookup.byHash.set(item.sha256,item);lookup.byId.set(item.id,item);}return item.id;
  };
  const pruneProductionRefs=(data,key,id)=>{
    for(const production of data.productions){
      let affected=false;
      if(key==='outputMediaId'){
        for(const shot of production.shots){
          if(shot.outputMediaId===id){delete shot.outputMediaId;shot.status='planned';affected=true;}
          if(shot.takes?.some(take=>take.mediaId===id)){shot.takes=shot.takes.filter(take=>take.mediaId!==id);affected=true;}
        }
      }else{
        for(const record of [production,...production.shots])if(record[key].includes(id)){record[key]=record[key].filter(refId=>refId!==id);affected=true;}
      }
      if(affected){if(production.status==='ready')production.status='review';production.updatedAt=new Date().toISOString();}
    }
  };
  const domain={
    snapshot:raw,
    getMedia:id=>{if(typeof id!=='string')fail('Invalid media id');const row=db.prepare('SELECT data FROM media WHERE id=?').get(id);if(!row)fail('Unknown media id');return JSON.parse(row.data);},
    addMedia:input=>mutation('addMedia',data=>({table:'media',id:mergeMedia(data,input)})),
    saveAnnotations:input=>mutation('saveAnnotations',data=>{
      const items=Array.isArray(input)?input:object(input).annotations;
      if(!Array.isArray(items)||items.length>10000)fail('annotations must be an array of at most 10000');
      const seen=new Set(), positions=new Map(data.annotations.map((item,index)=>[item.id,index]));
      for(const item of items){
        object(item);const position=item.id===undefined?undefined:positions.get(string(item.id,'annotations id'));
        if(item.id!==undefined&&position===undefined)fail(`Unknown annotations id: ${item.id}`);
        const existing=position===undefined?undefined:data.annotations[position];
        if(item.id!==undefined&&seen.has(item.id))fail('Duplicate annotation update');if(item.id!==undefined)seen.add(item.id);
        const now=new Date().toISOString();const value={...existing,...item,id:existing?.id??randomUUID(),createdAt:existing?.createdAt??now,updatedAt:now};
        if(existing)data.annotations[position]=value;else data.annotations.push(value);
      }
    }),
    updateMedia:input=>mutation('updateMedia',data=>{
      object(input);const media=find(data,'media',input.id);
      for(const key of Object.keys(input))if(!['id','series','episode','path','proxyPath','thumbnailPath'].includes(key))fail(`Media field is immutable: ${key}`);
      if(input.path!==undefined){verifyFile(input.path,media);media.path=input.path;delete media.proxyPath;}
      for(const k of ['series','episode','proxyPath','thumbnailPath'])if(Object.hasOwn(input,k)){if(input[k]===null)delete media[k];else media[k]=input[k];}
      return {table:'media',id:media.id};
    }),
    deleteEntity:id=>remove('entities',id,data=>{
      for(const a of data.annotations)if(a.entityId===id)delete a.entityId;
      for(const c of data.collections)c.entityIds=c.entityIds.filter(x=>x!==id);
      pruneProductionRefs(data,'entityIds',id);
      // Actor links, events and relations deliberately block deletion rather than erasing evidence.
    }),
    deleteAnnotation:id=>remove('annotations',id,data=>{for(const c of data.collections)c.annotationIds=c.annotationIds.filter(x=>x!==id);pruneProductionRefs(data,'annotationIds',id);}),
    deleteMedia:id=>remove('media',id,data=>pruneProductionRefs(data,'outputMediaId',id)),
    deleteProduction:id=>remove('productions',id),
    deleteTemplate:id=>remove('templates',id),deleteEvent:id=>remove('events',id),deleteRelation:id=>remove('relations',id),deleteStory:id=>remove('stories',id),deleteCollection:id=>remove('collections',id),
    replaceSnapshot:input=>mutation('replaceSnapshot',data=>{const validated=validateSnapshot(input);for(const t of TABLES)data[t]=validated[t];}),
    importSnapshot:input=>mutation('importSnapshot',data=>{
      const imported=validateSnapshot(input),maps=Object.fromEntries(TABLES.map(t=>[t,new Map(imported[t].map(x=>[x.id,randomUUID()]))]));
      const map=(t,id)=>maps[t].get(id)??fail(`Missing import ${t} reference: ${id}`);
      const list=(t,ids=[])=>ids.map(id=>map(t,id));
      const mediaLookup={byHash:new Map(),byId:new Map(data.media.map(item=>[item.id,item]))};
      for(const item of data.media)if(!mediaLookup.byHash.has(item.sha256))mediaLookup.byHash.set(item.sha256,item);
      for(const item of imported.media)maps.media.set(item.id,mergeMedia(data,{...item,id:maps.media.get(item.id)},mediaLookup));
      for(const t of TABLES.filter(x=>x!=='media'))for(const item of imported[t]){
        const v={...item,id:map(t,item.id)};
        if(t==='entities'){v.mediaIds=list('media',v.mediaIds);if(v.coverMediaId)v.coverMediaId=map('media',v.coverMediaId);if(v.actorEntityId)v.actorEntityId=map('entities',v.actorEntityId);}
        if(t==='annotations'){v.mediaId=map('media',v.mediaId);if(v.entityId)v.entityId=map('entities',v.entityId);if(v.templateId)v.templateId=map('templates',v.templateId);if(v.trackId)v.trackId=`import-${maps.media.get(item.mediaId)}-${v.trackId}`;}
        if(t==='collections'){v.mediaIds=list('media',v.mediaIds);v.entityIds=list('entities',v.entityIds);v.annotationIds=list('annotations',v.annotationIds);}
        if(t==='events'){v.entityIds=list('entities',v.entityIds);v.annotationIds=list('annotations',v.annotationIds);if(v.sceneId)v.sceneId=map('entities',v.sceneId);v.changes=v.changes.map(c=>({...c,entityId:map('entities',c.entityId)}));}
        if(t==='relations'){v.fromEntityId=map('entities',v.fromEntityId);v.toEntityId=map('entities',v.toEntityId);v.evidenceAnnotationIds=list('annotations',v.evidenceAnnotationIds);}
        if(t==='stories')v.nodes=v.nodes.map(n=>({...n,...(n.mediaId?{mediaId:map('media',n.mediaId)}:{}),...(n.eventIds?{eventIds:list('events',n.eventIds)}:{})}));
        if(t==='productions'){v.entityIds=list('entities',v.entityIds);v.annotationIds=list('annotations',v.annotationIds);v.shots=v.shots.map(shot=>({...shot,id:randomUUID(),entityIds:list('entities',shot.entityIds),annotationIds:list('annotations',shot.annotationIds),...(shot.outputMediaId?{outputMediaId:map('media',shot.outputMediaId)}:{}),takes:shot.takes.map(take=>({...take,id:randomUUID(),mediaId:map('media',take.mediaId)}))}));}
        data[t].push(v);
      }
    }),
    history:()=>{const position=cursor();const entries=db.prepare('SELECT id,operation,createdAt FROM revisions ORDER BY id DESC').all().map(x=>({...x,applied:x.id<=position}));return {canUndo:entries.some(x=>x.applied),canRedo:entries.some(x=>!x.applied),entries};},
    undo:()=>tx(()=>{const entry=db.prepare('SELECT * FROM revisions WHERE id<=? ORDER BY id DESC LIMIT 1').get(cursor());if(!entry)fail('Nothing to undo');write(validateSnapshot(JSON.parse(entry.before)));setCursor(entry.id-1);return raw();}),
    redo:()=>tx(()=>{const entry=db.prepare('SELECT * FROM revisions WHERE id>? ORDER BY id LIMIT 1').get(cursor());if(!entry)fail('Nothing to redo');write(validateSnapshot(JSON.parse(entry.after)));setCursor(entry.id);return raw();}),
    close:()=>db.close(),
  };
  for(const [name,table]of Object.entries({Entity:'entities',Annotation:'annotations',Collection:'collections',Template:'templates',Event:'events',Relation:'relations',Story:'stories',Production:'productions'}))domain[`save${name}`]=input=>save(table,input);
  return domain;
}
