// Only a trusted click on an App-created card reaches the printer channel.
(()=>{
const cards=new Map(),el=id=>document.getElementById(id);
function result(card){return card?.children?card.children.map(id=>{const child=cards.get(id);return child.word+'：'+result(child)}).join('；'):card?.status||'待用户点击确认，尚未打印。'}
function sync(){
 const list=el('messages'),follow=list.scrollHeight-list.scrollTop-list.clientHeight<80;
 document.querySelectorAll('[data-print-card]').forEach(node=>{
  const c=cards.get(node.dataset.printCard);if(!c)return;
  const button=node.querySelector('[data-confirm-print]'),note=node.querySelector('.card-status');
  const validation=c.used?'':validate(c.word,c.ipa);
  const needsSplit=!c.used&&validation.startsWith('内容过长')&&c.word.trim().split(/\s+/).length>1;
  const key=needsSplit?JSON.stringify(config()):'';
  if(c.planKey!==key){
   c.planKey=key;c.plan=null;c.splitError='';c.planning=needsSplit;
   if(needsSplit)plan(c).then(values=>{
    if(c.planKey!==key||c.used)return;
    if(values.length<2||values.some(v=>validate(v.word,v.ipa)))throw Error('无法拆分，请缩小字号或缩短英文。');
    c.plan=values;
   }).catch(()=>{if(c.planKey===key)c.splitError='无法拆分，请缩小字号或缩短英文。'}).finally(()=>{if(c.planKey===key){c.planning=false;sync()}});
  }
  button.hidden=c.state==='split';
  button.disabled=c.used||busy||deviceBusy||window.P0History?.ready===false||!!validation&&!(needsSplit&&c.plan);
  const completed=(c.children||[]).filter(id=>cards.get(id)?.state==='printed').length;
  button.textContent=c.batch?`拆分打印(${completed}/${c.children.length})`:needsSplit?(c.plan?`拆分打印(0/${c.plan.length})`:c.planning?'正在计算…':'拆分打印'):c.used?(c.state==='printing'?'打印中…':'已确认'):'确认打印';
  if(!c.batch)for(const id of c.children||[]){if(!node.querySelector('[data-print-card="'+id+'"]'))render(id,node,false)}
  note.textContent=c.used?c.status:(c.splitError||(needsSplit?'':validation));note.classList.toggle('error',c.state==='failed'||!!note.textContent&&!c.used);

 });
 if(follow)list.scrollTop=list.scrollHeight;
}
async function prepare(tool){
 const value=P0Agent.input(tool.input),local=await phonetics(value.word);
 if(local)value.ipa=local;
 return [value];
}
async function plan(value){
 // Whitespace separates printable words; hyphenated compounds stay intact.
 const words=value.word.trim().split(/\s+/),provided=P0Phonetics.format(value.ipa).slice(1,-1).split(/ +/);
 const counts=words.map(w=>w.split('-').length),componentCount=counts.reduce((a,b)=>a+b,0);
 let offset=0;
 const fallback=words.map((word,i)=>{
  const count=provided.length===words.length?1:counts[i],start=offset;offset+=count;
  return provided.length===words.length||provided.length===componentCount?'/'+provided.slice(start,offset).join(' ')+'/':'';
 });
 const parts=await Promise.all(words.map(async(word,i)=>(await phonetics(word))||fallback[i]));
 if(words.length<2||parts.some(p=>!p))return [value];
 // Fewest sheets first, then balance actual occupied widths (English and IPA).
 // Squared widths penalize a very full sheet paired with a nearly empty one.
 const plans=Array(words.length+1).fill(null),scores=Array(words.length+1).fill(Infinity);
 plans[words.length]=[];scores[words.length]=0;
 for(let i=words.length-1;i>=0;i--)for(let j=i+1;j<=words.length;j++){
  const part={word:words.slice(i,j).join(' '),ipa:'/'+parts.slice(i,j).map(p=>p.slice(1,-1)).join(' ')+'/'};
  if(validate(part.word,part.ipa)||!plans[j])continue;
  const width=Math.max(ctx.measureText(part.word).width,ctx.measureText(part.ipa).width),score=width*width+scores[j];
  const count=plans[j].length+1;
  if(!plans[i]||count<plans[i].length||count===plans[i].length&&score<scores[i]){
   plans[i]=[part,...plans[j]];scores[i]=score;
  }
 }
 return plans[0]||[value];
}
function create(tool,parent){
 const value=P0Agent.input(tool.input),id=crypto.randomUUID();
 const c={id,toolId:tool.id,...value,used:false,state:'pending',status:'待用户点击确认，尚未打印。'};cards.set(id,c);
 render(id,parent);return id;
}
function render(id,parent,synchronize=true){
 const c=cards.get(id);if(!c)return;
 const node=document.createElement('section');node.className='print-card';node.dataset.printCard=id;
 const word=document.createElement('div');word.className='card-word';word.textContent=c.word;
 const ipa=document.createElement('div');ipa.className='card-ipa';ipa.textContent=c.ipa;
 const button=document.createElement('button');button.type='button';button.className='primary';button.dataset.confirmPrint=id;button.textContent='确认打印';
 const note=document.createElement('p');note.className='card-status note';note.setAttribute('role','status');
 const pronunciation=document.createElement('div');pronunciation.className='card-pronunciation';pronunciation.append(ipa,P0Speech.button(c.word));node.append(word,pronunciation,button,note);parent.append(node);c.node=node;if(!c.batch)for(const child of c.children||[])render(child,node,false);if(synchronize)sync();return id;
}
async function confirmBatch(c){
 const values=c.plan,settings=config();
 if(!values||values.some(v=>validate(v.word,v.ipa)))return;
 c.batch=true;c.used=true;c.state='printing';c.status='';busy=true;
 c.children=values.map(value=>{
  const id=crypto.randomUUID();cards.set(id,{id,toolId:c.toolId,...value,used:true,state:'failed',status:'尚未发送；批次已锁定。'});return id;
 });
 refresh();
 let completed=0;
 try{
  if(!window.P0History)throw Error('历史记录尚未就绪，未发送打印。');
  // Lock the parent and every UUID durably before the first device request.
  await P0History.persist({claim:c.id});
  for(const id of c.children){
   const part=cards.get(id);part.state='printing';part.status='打印结果未确认，请先检查出纸。';
   await P0History.persist();
   const start=performance.now();P0Diagnostics.record('printer.start',{request:id,stage:'sending'});
   let response;
   try{response=await printerRequest('print',{requestId:id,word:part.word,ipa:part.ipa,settings})}
   catch(error){P0Diagnostics.record('printer.error',{request:id,ms:Math.round(performance.now()-start)},'error');part.state='failed';part.status='打印结果未确认，请先检查出纸。';throw error}
   setConnection(response.device);
   P0Diagnostics.record('printer.end',{request:id,state:response.state==='printed'?'printed':'unknown_result',ms:Math.round(performance.now()-start)});
   part.state=response.state==='printed'?'printed':'sent';part.status=part.state==='printed'?'已打印':'已发送，请查看出纸。';
   if(part.state!=='printed')throw Error('当前张结果未确认，请先检查出纸。');
   completed++;sync();await P0History.persist();
  }
  c.state='printed';c.status=`已打印 ${completed} 张`;
 }catch(error){c.state='failed';c.status=`已确认打印 ${completed}/${values.length} 张；${error.message||'结果未确认，请先检查出纸。'} 已停止。`}
 finally{busy=false;refresh();window.P0History?.persist().catch(()=>{})}
}
async function confirm(id){
 const c=cards.get(id);if(!c||c.used||busy||deviceBusy||!window.P0History?.ready)return;
 if(c.plan)return confirmBatch(c);
 // Consume before any await, including validation. Failure never re-enables this card.
 c.used=true;c.state='printing';c.status='正在检查并打印…';busy=true;refresh();sync();
 try{
  await P0History.persist({claim:c.id});
  const error=validate(c.word,c.ipa);if(error)throw Error(error);
  const response=await printerRequest('print',{requestId:c.id,word:c.word,ipa:c.ipa,settings:config()});
  setConnection(response.device);
  c.state=response.state==='printed'?'printed':'sent';
  c.status=response.state==='printed'?`${c.word} 已打印`:`${c.word} 已发送，请查看出纸。`;
 }catch(error){c.state='failed';c.status=error.message||'打印结果未确认，请先检查出纸。'}
 finally{busy=false;refresh();sync();window.P0History?.persist().catch(()=>{})}
}
// Delegation also handles restored history clones; the model cannot supply these attributes.
el('messages').addEventListener('click',event=>{
 const button=event.target.closest('[data-confirm-print]');
 if(event.isTrusted&&button&&!button.disabled)confirm(button.dataset.confirmPrint);
});
document.addEventListener('printer-state',sync);
function messages(history,content){
 const source=[...history,{role:'user',content}],output=[];
 let pending=[];
 for(const m of source){
  if(m.role==='assistant'&&Array.isArray(m.content)){
   const blocks=m.content.map(b=>{if(b.type!=='tool_use')return b;pending.push(b);return {type:'tool_use',id:b.id,name:b.name,input:b.input}});
   output.push({role:m.role,content:blocks});
  }else if(m.role==='user'&&pending.length){
   const results=pending.map(b=>({type:'tool_result',tool_use_id:b.id,content:b.name==='offer_choices'?P0Choices.result(b._choiceId):(b._cardIds||[b._cardId]).map(id=>{const c=cards.get(id);return (c?.word||'')+'：'+result(c)}).join('；')}));pending=[];
   output.push({role:'user',content:[...results,...(typeof m.content==='string'?[{type:'text',text:m.content}]:m.content)]});
  }else output.push(m);
 }
 return output;
}
function snapshot(){return [...cards.values()].map(({id,toolId,word,ipa,used,state,status,children,batch})=>({id,toolId,word,ipa,used,state,status,children,batch}))}
function restore(values){
 const loaded=new Map();for(const v of values){
  if(!/^[a-f0-9-]{36}$/i.test(v.id)||loaded.has(v.id)||typeof v.used!=='boolean'||!['pending','printing','printed','sent','failed','split'].includes(v.state)||typeof v.status!=='string')throw Error('Invalid card');
  const value=P0Agent.input({word:v.word,ipa:v.ipa});
  loaded.set(v.id,{...v,...value,used:v.used||v.state!=='pending',...(v.state==='printing'?{state:'failed',status:'打印结果未确认，请先检查出纸。'}:{})});
 }
 for(const c of loaded.values())if(c.children){if(!Array.isArray(c.children)||c.children.some(id=>!loaded.has(id)||id===c.id||loaded.get(id).children))throw Error('Invalid child card')}
 for(const c of loaded.values())if(c.batch&&(!c.used||!Array.isArray(c.children)||!c.children.length||c.children.some(id=>!loaded.get(id).used)))throw Error('Invalid batch');
 cards.clear();for(const [id,c] of loaded)cards.set(id,c);
}
window.P0PrintCards={plan,prepare,create,render,snapshot,restore,messages,sync};
})();
