// Explicit, paid model experiment. Synthetic prompts only; never invokes a printer.
// Usage: node scripts/benchmark-model.mjs --run
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {endpointFor} from '../server/server.mjs';
import sse from '../web/sse.js';
import agent from '../web/agent-protocol.js';
if(!process.argv.includes('--run')){console.log('Use --run to send 12 paid requests with synthetic prompts.');process.exit(0)}
const config=JSON.parse(await readFile('.local/model-config.json','utf8'));
if(config.model!=='glm-5.3-flash'||!config.apiKey)throw Error('Requires configured glm-5.3-flash');
const settings=JSON.parse(await readFile('web/agent-config.json','utf8'));
const cases=[
 {id:'explanation',prompt:'用两句话说明 fridge 和 refrigerator 的区别。这次只学习用法，不需要标签或选择按钮。'},
 {id:'label',prompt:'我要把 flip-top water bottle 做成标签。请直接生成这个完整词组的打印确认卡片，附美式音标。不要实际打印。'},
 {id:'choices',prompt:'带滤网的玻璃茶壶，想做英文标签。请给我 glass teapot 和 glass teapot with an infuser 这两个可点击标签选项，均附上对应美式音标，让我自己选。'}
];
const folder=resolve('.local/benchmarks',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(folder,{recursive:true,mode:0o700});
const report={model:config.model,origin:new URL(config.url).origin,transport:'Mac Node HTTPS to configured Anthropic endpoint',settingsHash:createHash('sha256').update(JSON.stringify(settings)).digest('hex'),maxTokens:2048,repeats:2,cases,results:[]};
const save=()=>writeFile(resolve(folder,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
console.log('Experiment output: '+folder);
experiment: for(let repeat=0;repeat<2;repeat++)for(const sample of cases)for(const mode of repeat%2?['low','default']:['default','low']){
 const payload={...settings,model:config.model,max_tokens:2048,stream:true,messages:[{role:'user',content:sample.prompt}]};
 if(mode==='low')payload.output_config={effort:'low'};
 const result={case:sample.id,repeat:repeat+1,mode,startedAt:new Date().toISOString(),headersMs:null,firstEventMs:null,firstThinkingMs:null,firstTextMs:null,firstToolMs:null,totalMs:null,thinkingCharacters:0,text:'',tools:[],usage:{},completed:false};
 const start=performance.now(),elapsed=()=>Math.round(performance.now()-start),collector=new agent.Collector();let stopReason;
 console.log(`START ${report.results.length+1}/12 ${sample.id} ${mode}`);
 try{
  const response=await fetch(endpointFor(config.url),{method:'POST',headers:{'content-type':'application/json','x-api-key':config.apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(120000)});
  result.headersMs=elapsed();result.status=response.status;
  if(!response.ok){await response.body?.cancel();throw Error('http_'+response.status)}
  if(!response.headers.get('content-type')?.includes('text/event-stream')){await response.body?.cancel();throw Error('not_sse')}
  for await(const event of sse.readEvents(response.body)){
   const d=JSON.parse(event.data),delta=d.delta||{},block=d.content_block||{};
   result.firstEventMs??=elapsed();
   const usage=d.usage||d.message?.usage;
   if(usage)for(const key of ['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'])if(Number.isFinite(usage[key]))result.usage[key]=usage[key];
   if(block.type==='thinking'||delta.type==='thinking_delta'){result.firstThinkingMs??=elapsed();result.thinkingCharacters+=(block.thinking||delta.thinking||'').length}
   const text=block.type==='text'?block.text:delta.type==='text_delta'?delta.text:null;
   if(text){result.firstTextMs??=elapsed();result.text+=text}
   if(d.type==='content_block_start'&&block.type==='tool_use'){
    result.firstToolMs??=elapsed();collector.accept({type:'tool_start',index:d.index,id:block.id,name:block.name,input:block.input});
   }
   if(d.type==='content_block_delta'&&delta.type==='input_json_delta')collector.accept({type:'tool_delta',index:d.index,json:delta.partial_json});
   if(d.type==='content_block_stop')collector.accept({type:'tool_end',index:d.index});
   if(d.type==='message_delta')stopReason=delta.stop_reason;
   if(d.type==='error')throw Error('stream_error');
   if(d.type==='message_stop'){result.completed=true;break}
  }
  if(!result.completed)throw Error('incomplete_stream');
  result.tools=collector.finish(stopReason);result.stopReason=stopReason;
  const expected=sample.id==='explanation'?[]:[sample.id==='label'?'print_label':'offer_choices'];
  result.protocolPass=JSON.stringify(result.tools.map(t=>t.name))===JSON.stringify(expected)&&stopReason!=='max_tokens';
  if(sample.id==='label')result.protocolPass&&=result.tools[0]?.input.word==='flip-top water bottle';
  if(sample.id==='choices')result.protocolPass&&=JSON.stringify(result.tools[0]?.input.options)===JSON.stringify(['glass teapot','glass teapot with an infuser'])&&result.tools[0]?.input.purpose==='label';
 }catch(error){result.error=/^http_\d+$/.test(error.message)?error.message:['TimeoutError','AbortError'].includes(error.name)?'timeout':'stream_or_validation_error'}
 result.totalMs=elapsed();report.results.push(result);await save();
 console.log(JSON.stringify({case:result.case,repeat:result.repeat,mode,status:result.status,firstTextMs:result.firstTextMs,firstThinkingMs:result.firstThinkingMs,thinkingCharacters:result.thinkingCharacters,totalMs:result.totalMs,protocolPass:result.protocolPass,error:result.error}));
 if(result.status===401||result.status===403||result.status===429||mode==='low'&&result.status===400){console.log('Stopping: authentication, quota or parameter rejection; no automatic retry.');process.exitCode=1;break experiment}
}
console.log('Saved synthetic answers and timing report: '+resolve(folder,'report.json'));
