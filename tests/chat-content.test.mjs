import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateMessages} from '../server/chat-content.mjs';
const image={type:'image',source:{type:'base64',media_type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII='}};
test('multimodal conversation permits embedded photos, preserves context, rejects unsafe or oversized sources',()=>{
 const content=[image,{type:'text',text:'这是什么？'}];
 const messages=[{role:'user',content},{role:'assistant',content:'一张照片'},{role:'user',content:'继续'}];
 assert.deepEqual(validateMessages(messages),messages);
 assert.deepEqual(validateMessages([{role:'user',content:[image]}])[0].content,[image]);
 for(const source of [{type:'url',url:'http://localhost/private'},{...image.source,media_type:'image/svg+xml'},{...image.source,data:'dGVzdA=='},{...image.source,data:'a'.repeat(2_000_004)}])assert.throws(()=>validateMessages([{role:'user',content:[{type:'image',source}]}]));
 assert.throws(()=>validateMessages([{role:'user',content:[]} ]));
 const many=Array.from({length:17},(_,i)=>i%2?{role:'assistant',content:'ok'}:{role:'user',content:[image]});assert.throws(()=>validateMessages(many),/照片较多/);
});
