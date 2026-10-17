import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSuggestions } from '../desktop/suggestions.mjs';
test('approximate model ranges are bounded to source selection and fine word boundaries retained', () => {
  const source = {id:'media',kind:'video',duration:1.23};
  const result = normalizeSuggestions(source,[{start:0.1,end:1.3,label:'words',words:[{start:0.0999999,end:0.5,text:'first',confidence:0.9},{start:0.5,end:1.3000001,text:'last',confidence:0.9}]}],{start:0.2,end:1.2});
  assert.equal(result[0].start,0.2);assert.equal(result[0].end,1.2);assert.equal(result[0].words[0].start,0.2);assert.equal(result[0].words[1].end,1.2);
  assert.deepEqual(normalizeSuggestions(source,[{start:2,end:3}]),[]);
});
test('images keep zero-time anchors; malformed model output does not silently pass',()=>{
  assert.deepEqual(normalizeSuggestions({id:'image',kind:'image',duration:0},[{start:0,end:0}]),[{mediaId:'image',start:0,end:0}]);
  assert.throws(()=>normalizeSuggestions({id:'video',kind:'video',duration:2},[{start:NaN,end:1}]),/无效/);
});
