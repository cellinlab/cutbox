import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { findSimilar, searchAnnotations } from '../desktop/search.mjs';
test('structured annotation search ANDs words, fields, tags and episode context', () => {
  const snapshot = { media: [{ id:'m',name:'素材',series:'剧集',episode:'2' }], entities:[{id:'e',name:'角色',tags:['外套']}], annotations:[{id:'a',mediaId:'m',entityId:'e',label:'夜晚 低声',notes:'室内',tags:['红色'],category:'dialogue',epistemic:'observed',reviewState:'accepted'}] };
  assert.equal(searchAnnotations(snapshot, {text:'夜晚 室内',tags:['红色'],series:'剧集',episode:'2'}).length,1);
  assert.equal(searchAnnotations(snapshot, {text:'夜晚 户外'}).length,0);
  assert.equal(searchAnnotations(snapshot, {episode:'3'}).length,0);
  assert.equal(searchAnnotations(snapshot, {epistemic:'interpreted'}).length,0);
});
test('visual candidates rank matching generated colors and disclose first-frame method', async t => {
  const directory = await mkdtemp(join(tmpdir(),'cutbox-similarity-')); t.after(()=>rm(directory,{recursive:true,force:true}));
  const media = [];
  for (const [id,color] of [['ref','red'],['near','0xf01010'],['far','blue']]) {
    const path=join(directory,`${id}.png`);
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=${color}:s=32x32`,'-frames:v','1',path]);
    media.push({id,path,kind:'image'});
  }
  const result=await findSimilar({media},{mediaId:'ref'});
  assert.equal(result.candidates[0].mediaId,'near');
  assert.ok(result.candidates[0].score>result.candidates[1].score);
  assert.match(result.method,/first-frame/);
  await assert.rejects(findSimilar({media},{mediaId:'unknown'}),/找不到/);
});
