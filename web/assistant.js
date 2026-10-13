// Chat snapshots contain structured messages, never rendered HTML or credentials.
(()=>{
const el=id=>document.getElementById(id);
let historyReady=false,historyStale=false,pendingTurn=null,saveTimer,writeQueue=Promise.resolve();
let saved={configured:false,keyConfigured:false,url:'',model:'',effort:'low'},modelOptions={},saving=false,chatBusy=false,controller=null,history=[],failedContent=null,waiting=null,failedBubble=null,composingChat=false;
function settings(which){el('labelSettings').hidden=which!=='label';el('modelSettings').hidden=which!=='model';el('labelSettingsTab').setAttribute('aria-selected',String(which==='label'));el('modelSettingsTab').setAttribute('aria-selected',String(which==='model'));}
el('labelSettingsTab').onclick=()=>settings('label');el('modelSettingsTab').onclick=()=>settings('model');
function openConfig(){tab('settings');settings('model')}
el('configureModel').onclick=openConfig;
function configError(text){el('configError').textContent=text;el('configError').hidden=!text;}
async function localJson(path,options={}){let r;try{r=await fetch(path,options)}catch{throw Error('本机服务未连接，请重新启动项目。')}const data=await r.json();if(!r.ok)throw Error(data.error||'请求失败，请重试。');return data;}
function update(){['apiUrl','apiKey','modelName','modelEffort'].forEach(id=>el(id).disabled=saving||chatBusy);el('configureModel').hidden=saved.configured;el('sendChat').setAttribute('aria-label',chatBusy?'停止':'发送');el('sendChat').firstElementChild.className='icon '+(chatBusy?'icon-stop':'icon-send');el('sendChat').disabled=!chatBusy&&(!historyReady||(!el('chatInput').value.trim()&&!P0ChatInput.photo)||!saved.configured||saving||P0ChatInput.pending);el('newChat').disabled=chatBusy||!historyReady;el('chatHistory').disabled=chatBusy||!historyReady;el('saveConfig').disabled=saving||chatBusy;el('retryChat').disabled=chatBusy||saving||!historyReady;P0ChatInput.lock(chatBusy||!historyReady);if(historyStale)el('chatInput').disabled=false;P0Choices.sync(!historyReady||chatBusy||saving||!saved.configured||P0ChatInput.pending||!!P0ChatInput.photo||!!el('chatInput').value.trim())}
function syncEffort(){el('effortField').hidden=!Object.hasOwn(modelOptions,el('modelName').value.trim())}
function applyConfig(c){saved=c;el('apiUrl').value=c.url||'';el('modelName').value=c.model||'';el('modelEffort').querySelectorAll('input').forEach(input=>input.checked=input.value===(c.effort||'low')); syncEffort();el('apiKey').value='';el('apiKey').placeholder=c.keyConfigured?'已保存，留空保留':'输入 API Key';update()}
Promise.all([localJson('/api/config'),localJson('model-options.json')]).then(([c,options])=>{modelOptions=options;applyConfig(c)}).catch(e=>configError(e.message));
el('modelSettings').onsubmit=async e=>{e.preventDefault();if(saving||chatBusy)return;saving=true;configError('');el('saveConfig').textContent='保存中…';update();try{const result=await localJson('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:el('apiUrl').value.trim(),apiKey:el('apiKey').value.trim(),model:el('modelName').value.trim(),effort:el('modelEffort').querySelector('input:checked').value})});applyConfig(result);el('saveConfig').textContent='已保存'}catch(e){configError(e.message);el('saveConfig').textContent='保存'}finally{saving=false;update()}};
['apiUrl','apiKey','modelName','modelEffort'].forEach(id=>el(id).oninput=()=>{syncEffort();el('saveConfig').textContent='保存';configError('')});
let followOutput=true;
el('messages').addEventListener('scroll',()=>{const list=el('messages');followOutput=list.scrollHeight-list.scrollTop-list.clientHeight<80});
function scrollReply(){if(followOutput)el('messages').scrollTop=el('messages').scrollHeight}
function contentText(content){return typeof content==='string'?content:content.filter(b=>b.type==='text').map(b=>b.text).join('\n')}
function bubble(role,content){el('chatEmpty').hidden=true;const d=document.createElement('div');d.className='message '+role;if(Array.isArray(content)){for(const block of content){if(block.type==='image'){const img=document.createElement('img');img.className='message-photo';img.alt='已发送照片';img.src=`data:${block.source.media_type};base64,${block.source.data}`;d.append(img)}else{const text=document.createElement('div');text.textContent=block.text;d.append(text)}}}else d.textContent=content;el('messages').append(d);followOutput=true;scrollReply();return d}
function feedback(text,retry=false){el('chatError').textContent=text;el('chatFeedback').hidden=!text;el('retryChat').hidden=!retry;}
async function send(content,isRetry=false){
  if(chatBusy||!historyReady||!saved.configured||!content)return;
  if(history.length>=40){feedback('本轮对话较长，请新建对话。');return}
  if(!isRetry&&failedContent){history.push({role:'user',content:failedContent},{role:'assistant',content:(failedBubble?.textContent||'上一条回复未完成。')+'\n[回复未完成，没有生成可打印卡片。]'});failedBubble=null;}
  P0Choices.expire();pendingTurn={content,reply:''};chatBusy=true;failedContent=null;feedback('');controller=new AbortController();update();
  if(!isRetry)bubble('user',content);
  waiting=isRetry&&failedBubble?failedBubble:bubble('assistant','正在回复…');failedBubble=null;
  renderTranslationLoading(waiting,'正在回复');waiting.classList.add('waiting');waiting.setAttribute('aria-busy','true');
  P0ChatInput.reset();
  let reply='',complete=false,stopReason=null,renderTimer,requestId;const tools=new P0Agent.Collector();
  const paint=()=>{clearTimeout(renderTimer);renderTimer=null;if(reply){waiting.classList.remove('waiting','translation-loading');P0Markdown.render(waiting,reply);scrollReply()}};
  const timer=window.P0Native?null:setTimeout(()=>controller?.abort(),125000);
  try{
    await persist();
    let response;
    try{response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stream:true,messages:P0PrintCards.messages(history,content)}),signal:controller.signal})}
    catch(e){if(e.name==='AbortError')throw e;throw Error('本机服务未连接，请重新启动项目。')}
    requestId=response.headers.get('x-request-id');
    if(!response.ok){const data=await response.json();throw Error(data.error||'请求失败，请重试。')}
    if(!response.headers.get('content-type')?.includes('text/event-stream'))throw Error('本机服务版本不匹配，请重新启动项目。');
    for await(const event of P0SSE.readEvents(response.body)){
      const data=JSON.parse(event.data);
      if(data.type==='delta'&&typeof data.text==='string'){
        reply+=data.text;pendingTurn.reply=reply;scheduleSave();if(reply.length>64000)throw Error('回复过长，请缩小问题范围。');
        if(!renderTimer)renderTimer=setTimeout(paint,50);
      }else if(data.type?.startsWith('tool_'))tools.accept(data);
      else if(data.type==='error')throw Error(data.message||'回复中断，请重试。');
      else if(data.type==='done'){complete=true;stopReason=data.stopReason;break}
    }
    if(!complete)throw Error('回复中途断开，请重试。');
    const calls=tools.finish(stopReason);
    const plans=await Promise.all(calls.map(call=>call.name==='offer_choices'?null:P0PrintCards.prepare(call)));
    if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
    if(!reply.trim()&&!calls.length)throw Error('回复中途断开，请重试。');
    paint();waiting.classList.remove('waiting','translation-loading');if(!reply.trim())waiting.replaceChildren();
    const blocks=reply.trim()?[{type:'text',text:reply}]:[];
    for(let i=0;i<calls.length;i++){if(calls[i].name==='offer_choices'){const choiceId=P0Choices.create(calls[i],waiting);blocks.push({...calls[i],_choiceId:choiceId});continue}const cardIds=plans[i].map(value=>P0PrintCards.create({...calls[i],input:value},waiting));blocks.push({...calls[i],_cardIds:cardIds})}
    window.P0Diagnostics?.record('model.complete',{characters:reply.length,tools:calls.length,request:requestId});
    history.push({role:'user',content:content},{role:'assistant',content:calls.length?blocks:reply});
    if(stopReason==='max_tokens')feedback('本次回复达到长度上限，可继续提问。');
  }catch(e){
    window.P0Diagnostics?.record('model.error',{stage:e.diagnosticCode?'tools':'stream',request:requestId,code:e.diagnosticCode||0,error_type:e.name},'error');
    paint();if(reply){failedBubble=waiting;failedBubble._reply=reply;}else waiting.remove();failedContent=content;
    const hint=controller.signal.aborted?'已停止，可重试。':e.message||'回复中断，请重试。';
    feedback(hint,true);
  }finally{
    clearTimeout(timer);clearTimeout(renderTimer);waiting?.removeAttribute('aria-busy');waiting=null;controller=null;chatBusy=false;pendingTurn=null;update();scrollReply();persist().catch(()=>{});
  }
}
el('chatForm').onsubmit=e=>{e.preventDefault();if(chatBusy){controller?.abort();return}if(!saved.configured){openConfig();return}const text=el('chatInput').value.trim();if(P0ChatInput.pending)return;const content=P0ChatInput.photo?[P0ChatInput.photo,...(text?[{type:'text',text}]:[])]:text;send(content)};
async function selectLabel(label,value){
 chatBusy=true;update();feedback('');const start=performance.now(),request=crypto.randomUUID();
 let userNode,cardNode,added=false;
 try{
  const prepared=await P0PrintCards.prepare({input:value});
  const tool={type:'tool_use',id:'local_'+request.replaceAll('-',''),name:'print_label',input:prepared[0]};
  userNode=bubble('user',label);cardNode=bubble('assistant','');
  tool._cardIds=[P0PrintCards.create(tool,cardNode)];
  history.push({role:'user',content:label},{role:'assistant',content:[tool]});added=true;
  await persist();P0Choices.expire();
  window.P0Diagnostics?.record('bridge.end',{request,kind:'dictionary',ms:Math.round(performance.now()-start)});
  return true;
 }catch(error){
  if(added)history.splice(-2);userNode?.remove();cardNode?.remove();
  feedback(error.message||'卡片生成失败，请重新选择。');return false;
 }finally{chatBusy=false;update();scrollReply()}
}
P0Choices.onSelect=(label,value)=>{if(chatBusy||saving||!historyReady||!saved.configured||history.length>=40||P0ChatInput.pending||P0ChatInput.photo||el('chatInput').value.trim())return false;if(value)return selectLabel(label,value);send(label);return true};
el('retryChat').onclick=()=>{if(failedContent)send(failedContent,true)};
document.addEventListener('chat-input-change',update);
document.addEventListener('chat-input-error',e=>feedback(e.detail));
el('chatInput').oncompositionstart=()=>composingChat=true;el('chatInput').oncompositionend=()=>composingChat=false;
el('chatInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!composingChat){e.preventDefault();el('chatForm').requestSubmit()}};
// All snapshots are structured data. Restoration always uses the normal safe renderers.
const sessions=new Map();let sessionId=crypto.randomUUID();
function saveSession(){
 if(!history.length&&!failedContent&&!pendingTurn&&!el('chatInput').value.trim()&&!P0ChatInput.photo){sessions.delete(sessionId);return}
 const title=contentText(history[0]?.content||failedContent||pendingTurn?.content||el('chatInput').value||'照片对话').trim().slice(0,28)||'照片对话';
 sessions.set(sessionId,{title,history:structuredClone(history),failedContent,failedReply:failedBubble?._reply||'',pending:pendingTurn?structuredClone(pendingTurn):null,error:el('chatError').textContent,draft:P0ChatInput.snapshot()});
}
function snapshot(){
 saveSession();const cardIds=new Set(),choiceIds=new Set(),cards=P0PrintCards.snapshot();
 for(const session of sessions.values())for(const m of session.history)if(Array.isArray(m.content))for(const block of m.content)if(block.type==='tool_use'){if(block.name==='offer_choices')choiceIds.add(block._choiceId);else for(const id of block._cardIds||[block._cardId])cardIds.add(id)}
 for(const card of cards)if(cardIds.has(card.id))for(const child of card.children||[])cardIds.add(child);
 return {version:1,current:sessionId,sessions:[...sessions],cards:cards.filter(c=>cardIds.has(c.id)),choices:P0Choices.snapshot().filter(([id])=>choiceIds.has(id))};
}
function persist(options){
 if(!historyReady)return Promise.reject(Error('历史记录尚未加载，无法保存。'));
 clearTimeout(saveTimer);const value=snapshot();
 const run=writeQueue.catch(()=>{}).then(()=>P0ChatStore.save(value,options));writeQueue=run;
 run.catch(error=>{
  const stale=['HISTORY_CONFLICT','PRINT_ALREADY_CLAIMED'].includes(error.code);
  if(stale){historyReady=false;historyStale=true;clearTimeout(saveTimer);update();P0PrintCards.sync()}
  feedback(stale?error.message:'历史记录保存失败，请检查存储空间后重试。');
 });
 return run;
}
function scheduleSave(){clearTimeout(saveTimer);if(historyReady)saveTimer=setTimeout(()=>persist().catch(()=>{}),350)}
function clearConversation(){history=[];failedContent=null;failedBubble=null;pendingTurn=null;el('messages').querySelectorAll('.message').forEach(e=>e.remove());el('chatEmpty').hidden=false;feedback('');P0ChatInput.reset()}
function renderAssistant(content){
 const node=bubble('assistant','');const blocks=typeof content==='string'?[{type:'text',text:content}]:content;
 P0Markdown.render(node,blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n'));
 for(const block of blocks){if(block.type!=='tool_use')continue;if(block.name==='offer_choices')P0Choices.render(block._choiceId,node);else for(const id of block._cardIds||[block._cardId])P0PrintCards.render(id,node)}
 return node;
}
function restoreSession(id){
 clearConversation();sessionId=id;const selected=sessions.get(id);if(!selected){update();return}
 history=structuredClone(selected.history);
 for(const m of history){if(m.role==='user')bubble('user',m.content);else renderAssistant(m.content)}
 failedContent=selected.pending?.content||selected.failedContent;
 if(failedContent){bubble('user',failedContent);const text=selected.pending?.reply||selected.failedReply;if(text){failedBubble=renderAssistant(text);failedBubble._reply=text}}
 feedback(selected.pending?'上次回复中断，可重试。':selected.error,!!failedContent);P0ChatInput.restore(selected.draft);P0PrintCards.sync();update();followOutput=true;scrollReply();
}
el('newChat').onclick=()=>{if(chatBusy||!historyReady)return;saveSession();sessionId=crypto.randomUUID();clearConversation();update();persist().catch(()=>{})};
function showHistory(){
 if(chatBusy||!historyReady)return;saveSession();el('historyList').replaceChildren();
 for(const [id,session] of [...sessions].reverse()){
  const row=document.createElement('div');row.className='history-row';
  const button=document.createElement('button');button.className='history-item';button.textContent=session.title;button.setAttribute('aria-current',String(id===sessionId));
  button.onclick=()=>{saveSession();restoreSession(id);el('historyDialog').close();persist().catch(()=>{})};
  const remove=document.createElement('button');remove.className='speak';remove.textContent='删除';remove.setAttribute('aria-label','删除对话 '+session.title);
  remove.onclick=async()=>{if(!confirm('删除这段对话？删除后无法恢复。'))return;sessions.delete(id);if(id===sessionId){sessionId=crypto.randomUUID();clearConversation();update()}try{await persist();showHistory()}catch{}};
  row.append(button,remove);el('historyList').append(row);
 }
 if(!sessions.size){const empty=document.createElement('p');empty.className='note';empty.textContent='暂无对话';el('historyList').append(empty)}
 if(!el('historyDialog').open)el('historyDialog').showModal();
}
el('chatHistory').onclick=showHistory;
el('closeHistory').onclick=()=>el('historyDialog').close();
window.P0History={persist,get ready(){return historyReady}};
document.addEventListener('chat-input-change',scheduleSave);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&historyReady)persist().catch(()=>{})});
P0ChatStore.load().then(value=>{
 if(value){
  if(value.version!==1||!Array.isArray(value.sessions)||!Array.isArray(value.cards)||!Array.isArray(value.choices))throw Error('Invalid history');
  for(const [id,s] of value.sessions){if(typeof id!=='string'||typeof s.title!=='string'||!Array.isArray(s.history)||s.history.some(m=>!['user','assistant'].includes(m.role)||!(typeof m.content==='string'||Array.isArray(m.content))))throw Error('Invalid session')}
  P0PrintCards.restore(value.cards);P0Choices.restore(value.choices);for(const [id,s] of value.sessions)sessions.set(id,s);
  historyReady=true;restoreSession(value.current||crypto.randomUUID());
 }else historyReady=true;
 update();
}).catch(()=>{historyReady=false;update();feedback('历史记录读取失败，请重新打开 App；原记录未覆盖。')});
document.addEventListener('show-chat',()=>{update();P0ChatInput.resize();followOutput=true;scrollReply()});
window.addEventListener('pagehide',()=>{if(historyReady)persist().catch(()=>{});controller?.abort()});update();
})();
