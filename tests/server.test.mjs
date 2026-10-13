import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp,endpointFor} from '../server/server.mjs';
import {mockServer} from './mock.mjs';
import {mkdtemp,rm,stat,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sse from '../web/sse.js';
const agentConfig=JSON.parse(await readFile(new URL('../web/agent-config.json',import.meta.url),'utf8'));
const base='http://127.0.0.1:10292';
const post=(path,body,extra={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(body)});
test('Anthropic config, transport, context, errors, and local credential boundaries',async()=>{
 const logs=[];
 const dir=await mkdtemp(resolve('work/ai-test-')),configPath=resolve(dir,'config.json'),mock=mockServer(),app=createApp({configPath,timeout:500,logger:{record(event,fields){logs.push({event,fields})},debug:true}});
 await new Promise(r=>mock.listen(10291,'127.0.0.1',r));await new Promise(r=>app.listen(10292,'127.0.0.1',r));
 try {
  for(const url of ['https://example.com','https://example.com/v1','https://example.com/v1/messages'])assert.equal(endpointFor(url),'https://example.com/v1/messages');
  assert.throws(()=>endpointFor('https://user:password@example.com'));
  assert.equal((await post('/api/chat',{messages:[{role:'user',content:'hello'}]})).status,400);
  const cfg={url:'http://127.0.0.1:10291',model:'test-model',apiKey:'test-only-placeholder'};
  const saved=await (await post('/api/config',cfg)).json();assert.equal(saved.configured,true);assert.equal(saved.effort,'low');assert.equal(JSON.stringify(saved).includes(cfg.apiKey),false);
  assert.equal((await stat(configPath)).mode&0o777,0o600);
  assert.equal((await post('/api/config',{...cfg,apiKey:''})).status,200);
  assert.equal((await post('/api/config',{...cfg,url:'https://example.com',apiKey:''})).status,400);
  const photo={type:'image',source:{type:'base64',media_type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII='}};
  const photoMessages=[{role:'user',content:[photo,{type:'text',text:'识别照片'}]}];
  const photoResponse=await post('/api/chat',{messages:photoMessages});assert.equal(photoResponse.status,200);assert.match((await photoResponse.json()).text,/照片与文字/);assert.deepEqual(mock.metrics.requests.at(-1).messages,photoMessages);assert.equal(mock.metrics.requests.at(-1).system,agentConfig.system);
  assert.equal((await post('/api/chat',{messages:[{role:'user',content:[{type:'image',source:{type:'url',url:'http://localhost/private'}}]}]})).status,400);
  let messages=[{role:'user',content:'你好'}];let reply=await (await post('/api/chat',{messages})).json();assert.match(reply.text,/第 1 轮/);
  messages.push({role:'assistant',content:reply.text},{role:'user',content:'继续'});reply=await (await post('/api/chat',{messages})).json();assert.match(reply.text,/第 2 轮/);assert.equal(mock.metrics.requests.at(-1).system,agentConfig.system);
  let e=await post('/api/chat',{messages:[{role:'user',content:'错误测试'}]});assert.equal(e.status,502);const error=await e.text();assert.match(error,/401/);assert.equal(error.includes(cfg.apiKey),false);
  e=await post('/api/chat',{messages:[{role:'user',content:'空响应'}]});assert.equal(e.status,502);
  e=await post('/api/chat',{messages:[{role:'user',content:'取消测试'}]});assert.equal(e.status,502);assert.match(await e.text(),/超时/);
  assert.equal((await post('/api/config',cfg,{origin:'https://untrusted.example'})).status,403);
  assert.equal((await fetch(base+'/.local/model-config.json')).status,404);
  assert.equal(JSON.stringify(await(await fetch(base+'/api/config')).json()).includes(cfg.apiKey),false);
  assert.equal((await readFile(configPath,'utf8')).includes(cfg.apiKey),true);
  const streamed=async text=>{const r=await post('/api/chat',{stream:true,messages:[{role:'user',content:text}]});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/event-stream/);const events=[];for await(const event of sse.readEvents(r.body))events.push(JSON.parse(event.data));return events};
  const events=await streamed('分段测试');
  assert.equal(mock.metrics.requests.at(-1).system,agentConfig.system);
  assert.equal(mock.metrics.requests.at(-1).tools[0].name,'print_label');
  assert.notEqual(mock.metrics.requests.at(-1).tool_choice.disable_parallel_tool_use,true);
  const trace=logs.findLast(e=>e.event==='model.complete')?.fields.request;
  const stages=logs.filter(e=>e.fields.request===trace);
  for(const event of ['model.start','model.headers','model.first_text','model.complete'])assert.ok(stages.some(e=>e.event===event),event);
  assert.ok(stages.find(e=>e.event==='model.complete').fields.ms>=stages.find(e=>e.event==='model.first_text').fields.ms);
  assert.ok(!JSON.stringify(logs).includes(cfg.apiKey));
  const toolEvents=await streamed('卡片测试');assert.equal(toolEvents.at(-1).stopReason,'tool_use');assert.ok(toolEvents.some(e=>e.type==='tool_delta'));
  assert.ok(events.filter(e=>e.type==='delta').length>1);assert.equal(events.at(-1).type,'done');
  const combined=events.filter(e=>e.type==='delta').map(e=>e.text).join('');assert.match(combined,/分段测试/);assert.ok(!combined.includes('not user-visible'));
  const interrupted=await streamed('中断测试');assert.equal(interrupted.at(-1).type,'error');assert.ok(interrupted.some(e=>e.type==='delta'));
  const upstreamError=await streamed('流内错误');assert.equal(upstreamError.at(-1).type,'error');assert.ok(!JSON.stringify(upstreamError).includes(cfg.apiKey));
  const abort=new AbortController(),cancelledBefore=mock.metrics.cancelled;
  const response=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stream:true,messages:[{role:'user',content:'慢速测试'}]}),signal:abort.signal});
  for await(const event of sse.readEvents(response.body)){if(JSON.parse(event.data).type==='delta'){abort.abort();break}}
  await new Promise(r=>setTimeout(r,50));assert.ok(mock.metrics.cancelled>cancelledBefore);
  assert.equal((await streamed('停止后的新请求')).at(-1).type,'done');
  assert.equal(mock.metrics.requests.at(-1).output_config,undefined);
  assert.equal((await post('/api/config',{...cfg,model:'glm-5.3-flash'})).status,200);
  assert.equal((await streamed('低思考测试')).at(-1).type,'done');
  assert.deepEqual(mock.metrics.requests.at(-1).output_config,{effort:'low'});
  assert.equal(mock.metrics.requests.at(-1).thinking,undefined);
  assert.equal((await post('/api/chat',{messages:[{role:'user',content:'低思考测试'}]})).status,200);
  assert.deepEqual(mock.metrics.requests.at(-1).output_config,{effort:'low'});
  for(const effort of ['high','max','low']){
   const updated=await (await post('/api/config',{...cfg,model:'glm-5.3-flash',apiKey:'',effort})).json();
   assert.equal(updated.effort,effort);assert.equal(updated.keyConfigured,true);assert.equal(updated.apiKey,undefined);
   assert.equal((await (await fetch(base+'/api/config')).json()).effort,effort);
   assert.equal((await streamed('强度测试')).at(-1).type,'done');
   assert.deepEqual(mock.metrics.requests.at(-1).output_config,{effort});
  }
  await post('/api/config',{...cfg,model:'glm-5.3-flash',effort:'high'});
  const before=await readFile(configPath,'utf8');
  for(const effort of ['medium','',null,42,{},['low']])assert.equal((await post('/api/config',{...cfg,effort})).status,400);
  assert.equal(await readFile(configPath,'utf8'),before);
  // An older caller omitting effort preserves a saved value; old files default low.
  assert.equal((await (await post('/api/config',{...cfg,apiKey:''})).json()).effort,'high');
  await writeFile(configPath,JSON.stringify(cfg),{mode:0o600});
  const legacy=await (await fetch(base+'/api/config')).json();assert.equal(legacy.effort,'low');assert.equal(legacy.keyConfigured,true);
  assert.equal((await post('/api/config',cfg)).status,200);
  assert.equal((await streamed('恢复其他模型')).at(-1).type,'done');
  assert.equal(mock.metrics.requests.at(-1).output_config,undefined);

 }finally{app.closeAllConnections();mock.closeAllConnections();await Promise.all([new Promise(r=>app.close(r)),new Promise(r=>mock.close(r))]);await rm(dir,{recursive:true,force:true})}
});
