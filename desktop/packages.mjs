/** Desktop CBox: authenticated metadata; external media is deliberately plaintext. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, scrypt as scryptCallback, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const MAGIC = Buffer.from([67,66,79,88,0,1,0,0]);
const MAX = 8 * 1024 * 1024;
const SCHEMA = 'cutbox.desktop/0.1';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const lists = ['media','entities','annotations','collections'];
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));
async function key(password,salt) {
  assert(typeof password === 'string' && [...password].length >= 12, 'Passphrase must contain at least 12 characters');
  return scrypt(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
}
async function seal(manifest,password) {
  const plain=Buffer.from(JSON.stringify(manifest)); assert(plain.length<=MAX,'Manifest too large');
  const salt=randomBytes(16), nonce=randomBytes(12), header=Buffer.concat([MAGIC,salt,nonce]);
  const cipher=createCipheriv('aes-256-gcm',await key(password,salt),nonce); cipher.setAAD(header);
  return Buffer.concat([header,cipher.update(plain),cipher.final(),cipher.getAuthTag()]);
}
async function unseal(data,password) {
  assert(data.length>=52 && data.length<=MAX+52,'Invalid envelope size');
  assert(data.subarray(0,8).equals(MAGIC),'Unsupported CBox version');
  const decipher=createDecipheriv('aes-256-gcm',await key(password,data.subarray(8,24)),data.subarray(24,36));
  decipher.setAAD(data.subarray(0,36)); decipher.setAuthTag(data.subarray(-16));
  let plain; try { plain=Buffer.concat([decipher.update(data.subarray(36,-16)),decipher.final()]); }
  catch { throw new Error('Authentication failed: wrong passphrase or modified envelope'); }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));
}
function validate(snapshot) {
  assert(snapshot && typeof snapshot==='object','Invalid snapshot');
  const ids={};
  for (const name of lists) {
    assert(Array.isArray(snapshot[name]) && snapshot[name].length <= (name==='annotations'?100000:10000),`Invalid ${name} count`);
    ids[name]=new Set();
    for (const item of snapshot[name]) {
      assert(item && typeof item.id==='string' && item.id.length>0 && item.id.length<=256 && !ids[name].has(item.id),`Invalid or duplicate ${name} ID`);
      ids[name].add(item.id);
    }
  }
  for(const m of snapshot.media) {
    assert(typeof m.name==='string'&&m.name.trim()&&['video','audio','image'].includes(m.kind),'Invalid media record');
    assert(Number.isFinite(m.duration)&&m.duration>=0,'Invalid media duration');
  }
  const refs=(arr,name)=>{ assert(Array.isArray(arr),'Invalid reference list'); for(const id of arr) assert(ids[name].has(id),`Unknown ${name} reference`); };
  for(const e of snapshot.entities) { refs(e.mediaIds??[],'media'); if(e.coverMediaId) assert(ids.media.has(e.coverMediaId),'Unknown cover media'); }
  for(const a of snapshot.annotations) {
    assert(ids.media.has(a.mediaId),'Unknown annotation media');
    if(a.entityId) assert(ids.entities.has(a.entityId),'Unknown annotation entity');
    assert(Number.isFinite(a.start)&&Number.isFinite(a.end)&&a.start>=0&&a.end>=a.start&&a.end<=snapshot.media.find(m=>m.id===a.mediaId).duration,'Invalid annotation interval');
    if(a.region) assert(['x','y','width','height'].every(k=>Number.isFinite(a.region[k])&&a.region[k]>=0&&a.region[k]<=1)&&a.region.x+a.region.width<=1&&a.region.y+a.region.height<=1,'Invalid annotation region');
  }
  for(const c of snapshot.collections) for(const name of ['media','entities','annotations']) refs(c[`${name==='entities'?'entity':name==='annotations'?'annotation':'media'}Ids`]??[],name);
  return snapshot;
}
function selected(snapshot,entityIds,collectionId) {
  validate(snapshot);
  if(entityIds===undefined && !collectionId) return structuredClone(snapshot);
  const m=new Set(),e=new Set(entityIds??[]),a=new Set();
  if(collectionId) {
    const c=snapshot.collections.find(x=>x.id===collectionId); assert(c,'Unknown collection');
    for(const id of c.mediaIds??[]) m.add(id);
    for(const id of c.entityIds??[]) e.add(id);
    for(const id of c.annotationIds??[]) a.add(id);
  }
  for(const id of e) assert(snapshot.entities.some(x=>x.id===id),'Unknown selected entity');
  const requestedEntities=new Set(e);
  for(const item of snapshot.annotations) if(requestedEntities.has(item.entityId)||a.has(item.id)) { a.add(item.id); m.add(item.mediaId); if(item.entityId)e.add(item.entityId); }
  for(const item of snapshot.entities) if(e.has(item.id)) { for(const id of item.mediaIds??[])m.add(id); if(item.coverMediaId)m.add(item.coverMediaId); }
  return structuredClone({media:snapshot.media.filter(x=>m.has(x.id)),entities:snapshot.entities.filter(x=>e.has(x.id)),annotations:snapshot.annotations.filter(x=>a.has(x.id)),collections:snapshot.collections.filter(c=>(c.mediaIds??[]).every(id=>m.has(id))&&(c.entityIds??[]).every(id=>e.has(id))&&(c.annotationIds??[]).every(id=>a.has(id)))});
}
async function hash(file) {
  const h=createHash('sha256'); const handle=await fs.open(file,'r');
  try { for await(const chunk of handle.createReadStream({autoClose:false})) h.update(chunk); } finally { await handle.close(); }
  return h.digest('hex');
}
async function safeFile(root,relative) {
  assert(typeof relative==='string' && /^media\/[a-zA-Z0-9._-]+$/.test(relative) && !relative.includes('..'),'Unsafe media path');
  let current=path.resolve(root);
  // Reject symlinks on every path component, including the bundle directory.
  const parsed=path.parse(current); let prefix=parsed.root;
  for(const part of current.slice(parsed.root.length).split(path.sep).filter(Boolean)) { prefix=path.join(prefix,part); assert(!(await fs.lstat(prefix)).isSymbolicLink(),'Symlink rejected'); }
  for(const part of relative.split('/')) { current=path.join(current,part); assert(!(await fs.lstat(current)).isSymbolicLink(),'Symlink rejected'); }
  assert((await fs.stat(current)).isFile(),'Missing media file'); return current;
}
async function staged(directory,operation) {
  directory=path.resolve(directory); const parent=path.dirname(directory);
  try { await fs.lstat(directory); throw new Error('Output directory already exists'); } catch(error) { if(error.code!=='ENOENT')throw error; }
  const temp=await fs.mkdtemp(path.join(parent,'.cutbox-')); let reserved=false;
  try {
    const result=await operation(temp);
    // Exclusive reservation prevents overwriting any pre-existing output, even an empty directory.
    await fs.mkdir(directory,{mode:0o700}); reserved=true;
    await fs.rename(temp,directory); reserved=false;
    return result;
  } catch(error) { if(reserved)await fs.rmdir(directory).catch(()=>{}); throw error; }
  finally { await fs.rm(temp,{recursive:true,force:true}); }
}
export async function exportBundle({directory,password,snapshot,entityIds,collectionId}) {
  const data=selected(snapshot,entityIds,collectionId); directory=path.resolve(directory);
  await staged(directory,async temp=>{
    await fs.mkdir(path.join(temp,'media'));
    const media=[];
    for(const item of data.media) {
      assert(typeof item.path==='string','Missing media source path');
      const stat=await fs.lstat(item.path); assert(stat.isFile()&&!stat.isSymbolicLink(),'Source must be a regular file');
      const temporary=path.join(temp,'media',randomBytes(16).toString('hex')); await fs.copyFile(item.path,temporary);
      const sha256=await hash(temporary),size=(await fs.stat(temporary)).size;
      assert(sha256===item.sha256&&size===item.size,'Source media changed since import; re-import it before exporting');
      const ext=path.extname(item.path).toLowerCase(); const relative=`media/${sha256}${/^\.[a-z0-9]{1,10}$/.test(ext)?ext:''}`;
      await fs.rename(temporary,path.join(temp,relative));
      media.push({...pick(item,['id','name','kind','duration','width','height','fps','createdAt']),path:relative,size,sha256});
    }
    // Whitelist structural fields: never serialize local filesystem or thumbnail locations.
    const manifest={schema:SCHEMA,media,
      entities:data.entities.map(x=>pick(x,['id','type','name','description','tags','attributes','mediaIds','coverMediaId','createdAt','updatedAt'])),
      annotations:data.annotations.map(x=>pick(x,['id','mediaId','entityId','type','label','notes','reviewState','text','start','end','region','tags','createdAt','updatedAt'])),
      collections:data.collections.map(x=>pick(x,['id','name','description','mediaIds','entityIds','annotationIds','createdAt','updatedAt']))};
    validate(manifest); await fs.writeFile(path.join(temp,'collection.cbox'),await seal(manifest,password),{flag:'wx',mode:0o600});
  });
  return {path:path.join(directory,'collection.cbox'),directory,mediaCount:data.media.length};
}
export async function importBundle({path:boxPath,password,directory}) {
  const stat=await fs.lstat(boxPath); assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=MAX+52,'Invalid envelope file');
  const handle=await fs.open(boxPath,'r'); let bytes;
  try { bytes=Buffer.alloc(MAX+53); const result=await handle.read(bytes,0,bytes.length,0); bytes=bytes.subarray(0,result.bytesRead); } finally { await handle.close(); }
  const manifest=await unseal(bytes,password); assert(manifest.schema===SCHEMA,'Unsupported manifest schema'); validate(manifest);
  const root=path.dirname(boxPath), files=[]; const known=new Map();
  for(const item of manifest.media) {
    assert(Number.isSafeInteger(item.size)&&item.size>=0&&/^[a-f0-9]{64}$/.test(item.sha256),'Invalid media integrity metadata');
    const prior=known.get(item.path?.toLowerCase()); assert(!prior||(prior.path===item.path&&prior.sha256===item.sha256&&prior.size===item.size),'Conflicting media path'); known.set(item.path?.toLowerCase(),item);
    const source=await safeFile(root,item.path); assert((await fs.stat(source)).size===item.size&&await hash(source)===item.sha256,'Media integrity mismatch'); files.push(source);
  }
  directory=path.resolve(directory);
  await staged(directory,async temp=>{
    await fs.mkdir(path.join(temp,'media'));
    for(let i=0;i<files.length;i++) {
      const target=path.join(temp,manifest.media[i].path); await fs.copyFile(files[i],target);
      assert((await fs.stat(target)).size===manifest.media[i].size&&await hash(target)===manifest.media[i].sha256,'Media changed during import');
    }
  });
  return {...manifest,media:manifest.media.map(x=>({...x,path:path.join(directory,x.path)}))};
}
