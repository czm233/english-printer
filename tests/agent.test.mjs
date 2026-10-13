import {test} from 'node:test';
import assert from 'node:assert/strict';
import agent from '../web/agent-protocol.js';
import sse from '../web/sse.js';
import {forwardStream} from '../server/stream.mjs';
import {validateMessages} from '../server/chat-content.mjs';
const start={type:'tool_start',index:1,id:'tool_test',name:'print_label',input:{}};
function collect(json='{"word":"fridge","ipa":"/frɪdʒ/"}'){const c=new agent.Collector();c.accept(start);for(const part of json)c.accept({type:'tool_delta',index:1,json:part});return c;}
test('tool input is buffered until complete; malformed, duplicate, unknown and truncated calls cannot create a card',()=>{
 const c=collect();assert.throws(()=>c.finish('tool_use'));c.accept({type:'tool_end',index:1});assert.deepEqual(c.finish('tool_use')[0].input,{word:'fridge',ipa:'/frɪdʒ/'});assert.throws(()=>c.finish('max_tokens'));
 for(const json of ['{','{"word":"<img>","ipa":"/x/"}','{"word":"fridge","ipa":"/a/b/"}','{"word":"fridge","ipa":"/a/","copies":2}']){const bad=collect(json);bad.accept({type:'tool_end',index:1});assert.throws(()=>bad.finish('tool_use'))}
 assert.throws(()=>c.accept({...start,index:2}));assert.throws(()=>new agent.Collector().accept({...start,name:'exec'}));assert.throws(()=>new agent.Collector().finish('tool_use'));
 assert.deepEqual(agent.input({word:'double-door fridge',ipa:'ˌdʌbəl dɔr frɪdʒ'}),{word:'double-door fridge',ipa:'/ˌdʌbəl dɔr frɪdʒ/'});
});
test('conversation requires matching tool results and rejects injected tools or orphan results',()=>{
 const tool={type:'tool_use',id:'tool_test',name:'print_label',input:{word:'fridge',ipa:'/frɪdʒ/'}};
 const messages=[{role:'user',content:'冰箱'},{role:'assistant',content:[tool]},{role:'user',content:[{type:'tool_result',tool_use_id:'tool_test',content:'fridge 已打印'},{type:'text',text:'换一个词'}]}];
 assert.deepEqual(validateMessages(messages),messages);
 const bad=structuredClone(messages);bad[2].content[0].tool_use_id='other';assert.throws(()=>validateMessages(bad));
 assert.throws(()=>validateMessages([messages[0],messages[1],{role:'user',content:'继续'}]));
 const unknown=structuredClone(messages);unknown[1].content[0].name='shell';assert.throws(()=>validateMessages(unknown));
});
test('server forwards fragmented tool input without interpreting it as printable text',async()=>{
 const frames=[{type:'content_block_start',index:1,content_block:{type:'tool_use',id:'tool_test',name:'print_label',input:{}}},{type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{"word":"fridge",'}},{type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'"ipa":"/frɪdʒ/"}'}},{type:'content_block_stop',index:1},{type:'message_delta',delta:{stop_reason:'tool_use'}},{type:'message_stop'}];
 const upstream=new Response(frames.map(d=>'data: '+JSON.stringify(d)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
 const chunks=[];const res={writeHead(){},flushHeaders(){},write(v){chunks.push(v)},end(){this.writableEnded=true}};
 await forwardStream(upstream,res);const collector=new agent.Collector();let done;
 for await(const event of sse.readEvents(new Response(chunks.join('')).body)){const d=JSON.parse(event.data);if(d.type.startsWith('tool_'))collector.accept(d);if(d.type==='done')done=d;assert.notEqual(d.type,'delta')}
 assert.equal(collector.finish(done.stopReason)[0].input.word,'fridge');
});

test('phrase IPA accepts common vowels, dental consonants and word separators; multiple calls remain atomic',()=>{
 assert.equal(agent.input({word:'tower stand',ipa:'/taʊɚ; stænd/'}).ipa,'/taʊɚ stænd/');
 assert.equal(agent.input({word:'the thing',ipa:'/ðə; θɪŋ/'}).ipa,'/ðə θɪŋ/');
 const c=collect();c.accept({type:'tool_end',index:1});
 c.accept({...start,index:2,id:'second',input:{word:'stand',ipa:'/stænd/'}});
 assert.throws(()=>c.finish('tool_use'));
 c.accept({type:'tool_end',index:2});assert.equal(c.finish('tool_use').length,2);
 const calls=c.finish('tool_use');
 assert.equal(validateMessages([{role:'user',content:'分开打印'},{role:'assistant',content:calls},{role:'user',content:[...calls.map(t=>({type:'tool_result',tool_use_id:t.id,content:'待确认'})),{type:'text',text:'继续讨论'}]}])[1].content.length,2);
});

test('choices validate complete streams and matching follow-up results; reject partial, mixed and injected options',()=>{
 const input={question:'选择哪个表达？',options:['glass teapot','glass teapot with an infuser']};
 const c=new agent.Collector();c.accept({...start,name:'offer_choices'});
 for(const json of JSON.stringify(input))c.accept({type:'tool_delta',index:1,json});
 assert.throws(()=>c.finish('tool_use'));
 c.accept({type:'tool_end',index:1});const calls=c.finish('tool_use');assert.deepEqual(calls[0].input,input);
 const messages=[{role:'user',content:'玻璃茶壶'},{role:'assistant',content:calls},{role:'user',content:[{type:'tool_result',tool_use_id:'tool_test',content:'用户选择：glass teapot'},{type:'text',text:'glass teapot'}]}];
 assert.deepEqual(validateMessages(messages),messages);
 for(const options of [['only'],['same','SAME'],['a','b','c','d','e'],['a','<button>'],['a',42]])assert.throws(()=>agent.choices({...input,options}));
 assert.throws(()=>agent.choices({...input,command:'print'}));
 c.accept({...start,index:2,id:'another',input:{word:'glass',ipa:'/ɡlæs/'}});c.accept({type:'tool_end',index:2});assert.throws(()=>c.finish('tool_use'));
});

test('label choices require explicit matching validated payload; old choices stay conversational',()=>{
 const base={question:'选哪个标签？',options:['glass','mug']};
 assert.equal(agent.choices(base).purpose,undefined);
 const value={...base,purpose:'label',labels:[{word:'glass',ipa:'/ɡlæs/'},{word:'mug',ipa:'/mʌɡ/'}]};
 assert.equal(agent.choices(value).labels[0].word,'glass');
 assert.throws(()=>agent.choices({...base,purpose:'label'}));
 assert.throws(()=>agent.choices({...value,labels:value.labels.slice(1)}));
 assert.throws(()=>agent.choices({...value,labels:[value.labels[1],value.labels[0]]}));
 assert.throws(()=>agent.choices({...value,purpose:'clarify'}));
});
