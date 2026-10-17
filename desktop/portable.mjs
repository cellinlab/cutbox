/** Explicit plaintext dataset exports. Every format also includes the lossless portable manifest. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { selectSnapshot,prepareMedia,staged } from './packages.mjs';
import { exportReference,probeMedia } from './media.mjs';
const idName=id=>createHash('sha256').update(id).digest('hex');
function timestamp(seconds) {
 const ms=Math.round(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;
}
function subtitleText(text) {
 return String(text).replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n\s*\n/g,'\n').trim();
}
export async function exportDataset({directory,snapshot,format,collectionId,entityIds,profile='full',signal,ffmpegPath,ffprobePath,onProgress}) {
 if(!['jsonl','coco','srt'].includes(format))throw new Error('Unsupported dataset format');
 const data=selectSnapshot(snapshot,entityIds,collectionId);directory=path.resolve(directory);
 const filename=format==='jsonl'?'annotations.jsonl':format==='coco'?'coco.json':'subtitles.json';
 await staged(directory,async temp=>{
  const manifest=await prepareMedia(data,temp,{profile,signal,ffmpegPath,ffprobePath,onProgress});
  if(format==='jsonl') {
   const rows=manifest.annotations.map(annotation=>JSON.stringify({schema:'cutbox.annotation/0.2',annotation,media:manifest.media.find(m=>m.id===annotation.mediaId)}));
   await fs.writeFile(path.join(temp,filename),rows.join('\n')+(rows.length?'\n':''),{flag:'wx'});
  } else if(format==='srt') {
   await fs.mkdir(path.join(temp,'subtitles'));const index=[];
   for(const media of manifest.media) {
    signal?.throwIfAborted();const annotations=manifest.annotations.filter(a=>a.mediaId===media.id&&a.end>a.start).sort((a,b)=>a.start-b.start||a.end-b.end);
    if(!annotations.length)continue;
    const relative=`subtitles/${idName(media.id)}.srt`;
    const text=annotations.map((a,i)=>`${i+1}\n${timestamp(a.start)} --> ${timestamp(a.end)}\n${subtitleText(a.notes||a.label||'Annotation')}\n`).join('\n');
    await fs.writeFile(path.join(temp,relative),text,{flag:'wx'});index.push({mediaId:media.id,mediaPath:media.path,path:relative,annotationIds:annotations.map(a=>a.id)});
   }
   await fs.writeFile(path.join(temp,filename),JSON.stringify(index,null,2),{flag:'wx'});
  } else {
   await fs.mkdir(path.join(temp,'images'));const images=[],annotations=[],categories=[],categoryMap=new Map(),imageMap=new Map();
   for(const annotation of manifest.annotations) {
    signal?.throwIfAborted(); const media=manifest.media.find(m=>m.id===annotation.mediaId);
    if(media.kind==='audio'||(!annotation.region&&!annotation.polygon?.length))throw new Error('COCO requires visual annotations with a box or polygon; select a compatible collection');
    const frameTime=media.kind==='image'?0:annotation.start,key=JSON.stringify([media.id,frameTime]);let image=imageMap.get(key);
    if(!image) {
     const relative=`images/${idName(key)}.png`;
     await exportReference({inputPath:path.join(temp,media.path),outputPath:path.join(temp,relative),mode:'frame',start:frameTime,signal,ffmpegPath,ffprobePath});
     const dimensions=await probeMedia(path.join(temp,relative),{signal,ffprobePath});
     image={id:images.length+1,file_name:relative,width:dimensions.width,height:dimensions.height,cutbox:{mediaId:media.id,time:frameTime,sourceAnchor:media.sourceAnchor}};
     images.push(image);imageMap.set(key,image);
    }
    const label=annotation.category||annotation.label||'object';if(!categoryMap.has(label)){categoryMap.set(label,categories.length+1);categories.push({id:categories.length+1,name:label});}
    const polygon=annotation.polygon;let box=annotation.region;
    if(!box){const xs=polygon.map(p=>p.x),ys=polygon.map(p=>p.y);box={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};}
    const bbox=[box.x*image.width,box.y*image.height,box.width*image.width,box.height*image.height];
    const points=polygon?.flatMap(p=>[p.x*image.width,p.y*image.height]);
    let area=bbox[2]*bbox[3];if(polygon){area=Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p.x*q.y-q.x*p.y;},0))*image.width*image.height/2;}
    annotations.push({id:annotations.length+1,image_id:image.id,category_id:categoryMap.get(label),bbox,area,iscrowd:0,segmentation:points?[points]:[],cutbox:{annotationId:annotation.id,start:annotation.start,end:annotation.end,sourceAnchor:annotation.sourceAnchor}});
   }
   await fs.writeFile(path.join(temp,filename),JSON.stringify({info:{description:'CutBox point-in-time visual samples; full temporal annotations in manifest.json'},images,annotations,categories},null,2),{flag:'wx'});
  }
  signal?.throwIfAborted();await fs.writeFile(path.join(temp,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 });
 return {path:path.join(directory,filename),directory,mediaCount:data.media.length};
}
