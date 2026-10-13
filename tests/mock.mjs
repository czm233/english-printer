import http from 'node:http';
const frame=(type,data={})=>`event: ${type}\r\ndata: ${JSON.stringify({type,...data})}\r\n\r\n`;
function pause(res,ms){return new Promise(resolve=>{const done=()=>{clearTimeout(timer);res.off('close',done);resolve()};const timer=setTimeout(done,ms);res.once('close',done)})}
export const tableReply='**fridge** 是常用的冰箱说法。\n\n| 单词 | 中文意思 | 音标 | 用法和例句 |\n| --- | --- | --- | --- |\n| fridge | 冰箱（口语） | /frɪdʒ/ | Put the milk in the fridge. |\n| refrigerator | 冰箱（正式） | /rɪˈfrɪdʒəreɪtər/ | This refrigerator is new. |\n| bridge | 桥 | /brɪdʒ/ | Walk across the bridge. |\n\n1. 日常标签可以用 **Fridge**。\n2. 英文和音标各占一行。\n\n<script>throw new Error("unsafe")</script><img src="/unsafe-test-image" onerror="alert(1)">[危险链接](javascript:alert(1))';
export function mockServer(){
 const metrics={cancelled:0,requests:[]};
 const server=http.createServer(async(req,res)=>{
  res.on('close',()=>{if(!res.writableEnded)metrics.cancelled++});
  let data='';for await(const c of req)data+=c;let b;try{b=JSON.parse(data)}catch{res.writeHead(400).end();return}
  const expected=req.url==='/v1/messages'&&req.method==='POST'&&req.headers['x-api-key']==='test-only-placeholder'&&req.headers['anthropic-version']==='2023-06-01'&&['test-model','glm-5.3-flash'].includes(b.model)&&b.max_tokens===2048&&typeof b.stream==='boolean';
  if(!expected){res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{message:'invalid fixture request'}}));return}
  metrics.requests.push(b);
  const content=b.messages.at(-1).content;
  const text=typeof content==='string'?content:content.filter(b=>b.type==='text').map(b=>b.text).join('');
  const hasImage=Array.isArray(content)&&content.some(b=>b.type==='image');
  if(text.includes('错误测试')){res.writeHead(401,{'content-type':'application/json'}).end(JSON.stringify({error:{message:'test-only-placeholder must never be echoed'}}));return}
  if(text.includes('取消测试'))await pause(res,3000);
  if(res.destroyed)return;
  const answer=text.includes('空响应')?'':text.includes('音标测试')?'glass teapot /ɡlæs; ˈtiˌpɑt/':text.includes('表格测试')?tableReply:text.includes('长回复测试')?('这是本地接口测试的长回复，用于检查聊天记录在内部滚动，底部导航和输入框保持可见。\n').repeat(30):`接口测试成功。这是第 ${Math.ceil(b.messages.length/2)} 轮，收到：${hasImage?'照片与文字 ':''}${text}`;
  if(!b.stream){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({content:answer?[{type:'text',text:answer}]:[],stop_reason:'end_turn'}));return}
  res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();
  if(text.includes('等待首字测试'))await pause(res,4000);
  if(res.destroyed)return;
  res.write(frame('message_start',{message:{content:[]}}));
  if(text.includes('选择测试')){
   const input={question:'你想用哪个表达做标签？',options:['glass teapot','glass teapot with an infuser']};
   if(text.includes('直达'))Object.assign(input,{purpose:'label',labels:[{word:input.options[0],ipa:'/ɡlæs ˈtipɑt/'},{word:input.options[1],ipa:'/ɡlæs ˈtipɑt wɪð ən ɪnˈfjuzɚ/'}]});
   res.write(frame('content_block_start',{index:0,content_block:{type:'text',text:'glass teapot 是玻璃茶壶；glass teapot with an infuser 强调滤网。'}}));
   res.write(frame('content_block_stop',{index:0}));
   res.write(frame('content_block_start',{index:1,content_block:{type:'tool_use',id:'choice_'+metrics.requests.length,name:'offer_choices',input:{}}}));
   const json=JSON.stringify(input);res.write(frame('content_block_delta',{index:1,delta:{type:'input_json_delta',partial_json:json.slice(0,12)}}));
   if(text.includes('慢速'))await pause(res,4000);
   if(text.includes('中断')){res.end();return}
   res.write(frame('content_block_delta',{index:1,delta:{type:'input_json_delta',partial_json:json.slice(12)}}));
   res.write(frame('content_block_stop',{index:1}));res.write(frame('message_delta',{delta:{stop_reason:'tool_use'}}));res.end(frame('message_stop'));return;
  }
  if(text==='glass teapot'){
   res.write(frame('content_block_start',{index:0,content_block:{type:'tool_use',id:'selected_'+metrics.requests.length,name:'print_label',input:{word:'glass teapot',ipa:'/ɡlæs; ˈtiˌpɑt/'}}}));
   res.write(frame('content_block_stop',{index:0}));res.write(frame('message_delta',{delta:{stop_reason:'tool_use'}}));res.end(frame('message_stop'));return;
  }
  if(text.includes('卡片测试')){
   const word=text.includes('主机')?'computer tower stand':text.includes('超长')?'side-by-side refrigerator':text.includes('失败')?'paper':text.includes('其他')?'refrigerator':'fridge';
   const ipa=word==='side-by-side refrigerator'?'/ˌsaɪd baɪ ˈsaɪd rɪˈfrɪdʒəreɪtər/':word==='paper'?'/ˈpeɪpɚ/':word==='refrigerator'?'/rɪˈfrɪdʒəreɪtɚ/':'/frɪdʒ/';
   res.write(frame('content_block_start',{index:0,content_block:{type:'text',text:'可以用这个表达，需要打印时点击卡片。'}}));
   res.write(frame('content_block_stop',{index:0}));
   const labels=text.includes('多张')?[{word:'computer',ipa:'/kəmˈpjutɚ/'},{word:'tower stand',ipa:'/ˈtaʊɚ; stænd/'}]:[{word,ipa:text.includes('无效')?'/a/b/':ipa}];
   for(let i=0;i<labels.length;i++){
    const index=i+1,toolId='tool_'+metrics.requests.length+'_'+index;
    res.write(frame('content_block_start',{index,content_block:{type:'tool_use',id:toolId,name:'print_label',input:{}}}));
    const json=JSON.stringify(labels[i]);
    res.write(frame('content_block_delta',{index,delta:{type:'input_json_delta',partial_json:json.slice(0,13)}}));
    if(text.includes('慢速'))await pause(res,4000);
    if(text.includes('中断')){res.end();return}
    res.write(frame('content_block_delta',{index,delta:{type:'input_json_delta',partial_json:json.slice(13)}}));
    res.write(frame('content_block_stop',{index}));
   }
   res.write(frame('message_delta',{delta:{stop_reason:'tool_use'}}));res.end(frame('message_stop'));return;
  }

  res.write(frame('content_block_start',{index:0,content_block:{type:'thinking',thinking:''}}));
  res.write(frame('content_block_delta',{index:0,delta:{type:'thinking_delta',thinking:'not user-visible'}}));
  res.write(frame('content_block_start',{index:1,content_block:{type:'text',text:''}}));
  let index=0;
  for(const part of answer.match(/.{1,18}|\n/g)||[]){
   if(res.destroyed)return;
   res.write(frame('content_block_delta',{index:1,delta:{type:'text_delta',text:part}}));index++;
   if(index===1){
    if(text.includes('中断测试')){res.end();return}
    if(text.includes('流内错误')){res.end(frame('error',{error:{type:'overloaded_error',message:'test-only-placeholder'}}));return}
    if(text.includes('慢速测试'))await pause(res,4000);
   }
   await pause(res,25);
  }
  if(res.destroyed)return;
  res.write(frame('ping'));res.write(frame('future_event',{ignored:true}));
  res.write(frame('message_delta',{delta:{stop_reason:'end_turn'}}));res.end(frame('message_stop'));
 });
 server.metrics=metrics;return server;
}
if(process.argv[1]?.endsWith('/mock.mjs'))mockServer().listen(10291,'127.0.0.1',()=>console.log('Local mock: 10291'));
