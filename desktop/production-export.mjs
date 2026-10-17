/** Local, plaintext, manual production handoff. No uploads or vendor API integration. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validateSnapshot} from './domain.mjs';
import {exportReference} from './media.mjs';
import {fileDigest,verifyMedia} from './reliability.mjs';
import {staged} from './packages.mjs';
import {auditProduction} from './production.mjs';
const run=promisify(execFile);
const safeName=value=>createHash('sha256').update(String(value)).digest('hex');
const csv=value=>{let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;};
const md=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/([\\`*_[\]#|])/g,'\\$1');
const fields=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
export async function exportProductionKit({directory,snapshot,productionId,includeClips=false,cropRegions=false,signal,ffmpegPath='ffmpeg',ffprobePath='ffprobe',onProgress}) {
 if(typeof includeClips!=='boolean'||typeof cropRegions!=='boolean')throw new Error('Export switches must be boolean');
 const data=validateSnapshot(snapshot),production=data.productions?.find(p=>p.id===productionId);if(!production)throw new Error('Unknown production');
 const audit=auditProduction(data,productionId);if(audit.status==='blocked')throw new Error('Production audit blocked export: '+audit.issues.filter(i=>i.severity==='error').map(i=>i.message).join('; '));
 const annotationIds=new Set([...production.annotationIds,...production.shots.flatMap(s=>s.annotationIds)]),entityIds=new Set([...production.entityIds,...production.shots.flatMap(s=>s.entityIds)]);
 const annotations=data.annotations.filter(a=>annotationIds.has(a.id));for(const a of annotations)if(a.entityId)entityIds.add(a.entityId);
 let changed=true;while(changed){changed=false;for(const e of data.entities)if(entityIds.has(e.id)&&e.actorEntityId&&!entityIds.has(e.actorEntityId)){entityIds.add(e.actorEntityId);changed=true;}}
 const entities=data.entities.filter(e=>entityIds.has(e.id));const outputIds=new Set(production.shots.flatMap(s=>[s.outputMediaId,...(s.takes??[]).map(t=>t.mediaId)]).filter(Boolean));const mediaIds=new Set([...annotations.map(a=>a.mediaId),...outputIds]);const sources=data.media.filter(m=>mediaIds.has(m.id));
 const files=[],references=[],outputFiles=[];directory=path.resolve(directory);
 const progress=value=>{try{onProgress?.(value);}catch{}};
 await staged(directory,async temp=>{
  for(const dir of ['references','outputs','bibles'])await fs.mkdir(path.join(temp,dir));
  for(const media of sources){signal?.throwIfAborted();if(!(await fs.lstat(media.path)).isFile())throw new Error('Source must be a regular file');await verifyMedia(media,signal);}
  async function record(relative,details){const digest=await fileDigest(path.join(temp,relative),signal);const item={path:relative,...digest,...details};files.push(item);return item;}
  for(const [index,a]of annotations.entries()){
   signal?.throwIfAborted();const source=sources.find(m=>m.id===a.mediaId),alias=`@reference_${index+1}`,base=`references/${safeName(a.id)}`;
   const geometry=fields(a,['region','polygon','keyframes','keypoints']);const anchor={mediaId:source.id,sha256:source.sha256,start:a.start,end:a.end,geometry};const ref={alias,annotationId:a.id,label:a.label,source:anchor,files:[]};
   if(source.kind==='audio'){
    if(a.end<=a.start)throw new Error('Audio reference needs a positive interval');const relative=base+'.wav';await exportReference({inputPath:source.path,outputPath:path.join(temp,relative),mode:'audio',start:a.start,end:a.end,signal,ffmpegPath,ffprobePath});await record(relative,{kind:'audio',alias,source:anchor});ref.files.push(relative);
   }else{
    const relative=base+'.png';await exportReference({inputPath:source.path,outputPath:path.join(temp,relative),mode:'frame',start:source.kind==='image'?0:a.start,options:cropRegions&&a.region?{crop:a.region}:{},signal,ffmpegPath,ffprobePath});await record(relative,{kind:'frame',alias,source:anchor,cropped:Boolean(cropRegions&&a.region)});ref.files.push(relative);
    if(includeClips&&source.kind==='video'&&a.end>a.start){const clip=base+'.mp4';await exportReference({inputPath:source.path,outputPath:path.join(temp,clip),mode:'clip',start:a.start,end:a.end,signal,ffmpegPath,ffprobePath});await record(clip,{kind:'clip',alias,source:anchor});ref.files.push(clip);}
   }
   references.push(ref);progress((index+1)/Math.max(1,annotations.length)*0.7);
  }
  for(const media of sources.filter(m=>outputIds.has(m.id))){const ext=path.extname(media.path).toLowerCase(),relative=`outputs/${safeName(media.id)}${/^\.[a-z0-9]{1,10}$/.test(ext)?ext:''}`;await fs.copyFile(media.path,path.join(temp,relative));const file=await record(relative,{kind:'generated-output',source:{mediaId:media.id,sha256:media.sha256,start:0,end:media.duration}});if(file.sha256!==media.sha256||file.size!==media.size)throw new Error('Output media changed during copy');outputFiles.push({mediaId:media.id,path:relative});}
  const pictures=files.filter(f=>f.kind==='frame').slice(0,32);let contactSheet;
  if(pictures.length){contactSheet='contact-sheet.png';if(pictures.length===1)await fs.copyFile(path.join(temp,pictures[0].path),path.join(temp,contactSheet));else{
    const filters=pictures.map((_,i)=>`[${i}:v]scale=256:144:force_original_aspect_ratio=decrease,pad=256:144:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`);const cols=Math.min(4,pictures.length);filters.push(pictures.map((_,i)=>`[v${i}]`).join('')+`xstack=inputs=${pictures.length}:layout=`+pictures.map((_,i)=>`${i%cols*256}_${Math.floor(i/cols)*144}`).join('|')+':fill=black[out]');
    await run(ffmpegPath,['-v','error','-nostdin','-n',...pictures.flatMap(f=>['-i',path.join(temp,f.path)]),'-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map','[out]','-frames:v','1','-threads','1',path.join(temp,contactSheet)],{signal,timeout:120000,maxBuffer:1024*1024});
   }await record(contactSheet,{kind:'contact-sheet',referenceAliases:pictures.map(f=>f.alias)});}
  const bibleEntities=entities.map(e=>({...fields(e,['id','type','name','description','tags','attributes','actorEntityId']),evidence:annotations.filter(a=>a.entityId===e.id).map(a=>({annotationId:a.id,alias:references.find(r=>r.annotationId===a.id)?.alias,...fields(a,['label','notes','values','epistemic','confidence','reviewState'])}))}));
  const groups={character:bibleEntities.filter(e=>['character','actor'].includes(e.type)),scene:bibleEntities.filter(e=>e.type==='scene'),prop:bibleEntities.filter(e=>e.type==='prop'),voice:bibleEntities.filter(e=>e.type==='sound'),wardrobe:annotations.filter(a=>/costume|wardrobe|clothing|outfit|hair|makeup|服装|穿着/i.test([a.category,a.label,...Object.keys(a.values??{})].join(' '))).map(a=>({annotationId:a.id,entityId:a.entityId,alias:references.find(r=>r.annotationId===a.id)?.alias,...fields(a,['label','notes','values','epistemic','confidence','reviewState'])}))};
  for(const [name,entries]of Object.entries(groups)){const json=`bibles/${name}.json`,markdown=`bibles/${name}.md`;await fs.writeFile(path.join(temp,json),JSON.stringify(entries,null,2),{flag:'wx'});await record(json,{kind:'bible'});await fs.writeFile(path.join(temp,markdown),`# ${name}\n\n`+entries.map(e=>`## ${md(e.name||e.label)}\n\n${md(e.description||e.notes||'')}\n\n${md(JSON.stringify(e,null,2))}\n`).join('\n'),{flag:'wx'});await record(markdown,{kind:'bible'});}
  const shots=production.shots.map(s=>({...s,takes:(s.takes??[]).map(t=>({...t,outputPath:outputFiles.find(f=>f.mediaId===t.mediaId)?.path})),references:[...new Set([...production.annotationIds,...s.annotationIds])].map(id=>references.find(r=>r.annotationId===id)).filter(Boolean).map(r=>({alias:r.alias,annotationId:r.annotationId,files:r.files})),...(s.outputMediaId?{outputPath:outputFiles.find(f=>f.mediaId===s.outputMediaId)?.path}:{})}));
  await fs.writeFile(path.join(temp,'audit.json'),JSON.stringify(audit,null,2),{flag:'wx'});await record('audit.json',{kind:'audit'});
  const portable={schema:'cutbox.production-kit/0.1',production:{...production,shots},entities:bibleEntities,annotations:annotations.map(a=>fields(a,['id','mediaId','entityId','label','notes','start','end','region','polygon','keyframes','keypoints','words','values','category','epistemic','confidence','reviewState'])),references,outputs:outputFiles,contactSheet};
  await fs.writeFile(path.join(temp,'production.json'),JSON.stringify(portable,null,2),{flag:'wx'});await record('production.json',{kind:'production'});
  await fs.writeFile(path.join(temp,'shot-list.csv'),[['id','name','duration','status','prompt','negativePrompt','continuity','references'],...shots.map(s=>[s.id,s.name,s.duration,s.status,s.prompt,s.negativePrompt,s.continuity,s.references.map(r=>r.alias).join(' ')])].map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n',{flag:'wx'});await record('shot-list.csv',{kind:'shot-list'});
  await fs.writeFile(path.join(temp,'prompts.md'),`# ${md(production.name)}\n\nThese aliases identify local files; they are not vendor API tokens.\n\n`+shots.map((s,i)=>`## ${i+1}. ${md(s.name)}\n\nDuration: ${s.duration}s\n\n${md(s.prompt)}\n\nNegative guidance: ${md(s.negativePrompt)}\n\nContinuity: ${md(s.continuity)}\n\nReferences:\n${s.references.map(r=>`- ${r.alias}: ${r.files.map(md).join(', ')}`).join('\n')}\n`).join('\n'),{flag:'wx'});await record('prompts.md',{kind:'prompts'});
  await fs.writeFile(path.join(temp,'README.md'),`# CutBox production handoff\n\nTarget label: ${md(production.target)}. This is a local plaintext kit, not a vendor API request or upload.\n\n1. Review shot-list.csv, entity bibles and prompts.md.\n2. Open the selected platform manually and check its current media limits and reference controls.\n3. Attach the files listed for each @reference alias and adapt the plain text prompt. Aliases have no automatic platform meaning.\n4. Review results before importing them back as output media.\n\nFrames represent annotation start times, not entire motion. Clips include only first video/audio streams; audio references use the first audio stream. Optional cropped frames retain original geometry in the manifest. Pose/word data remains evidence, not a vendor-specific control schema. Contact sheet includes at most the first 32 visual references. Original local paths are omitted; external files and metadata here are unencrypted. No content is uploaded.\n`,{flag:'wx'});await record('README.md',{kind:'readme'});
  for(const media of sources)await verifyMedia(media,signal);signal?.throwIfAborted();await fs.writeFile(path.join(temp,'manifest.json'),JSON.stringify({schema:'cutbox.production-kit-files/0.1',productionId,files},null,2),{flag:'wx'});progress(1);
 });
 return {directory,path:path.join(directory,'manifest.json'),referenceCount:references.length};
}
