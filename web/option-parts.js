// Main-page batches are explicitly confirmed by the user's split-print click.
(()=>{
let key='',plan=null,planning=false,planError='',completed=0,generation=0;
function sync(){
 const next=canSplitCurrent()?JSON.stringify([revision,$('word').value,$('ipa').value,config()]):'';
 if(next!==key){
  if(planError&&$('status').textContent===planError)message('');
  if(next&&$('status').textContent.startsWith('内容过长'))message('');
  key=next;plan=null;planError='';completed=0;planning=false;const token=++generation;
  if(next){
   planning=true;
   P0PrintCards.plan({word:$('word').value,ipa:$('ipa').value}).then(values=>{
    if(token!==generation)return;
    if(values.length<2||values.some(p=>validate(p.word,p.ipa)))throw Error('无法拆分，请在设置中缩小字号。');
    plan=values;
   }).catch(()=>{if(token===generation)planError='无法拆分，请在设置中缩小字号。'}).finally(()=>{
    if(token!==generation)return;planning=false;refresh();if(planError)message(planError,true);
   });
  }
 }
 if(!next)return;
 $('printAgain').textContent=plan?`拆分打印(${completed}/${plan.length})`:planning?'正在计算…':'拆分打印';
 $('printAgain').disabled=busy||deviceBusy||translating||!plan;
}
document.addEventListener('printer-state',sync);
function attach(row,option){
 const note=document.createElement('p');note.className='note error option-split';note.setAttribute('role','status');row.append(note);
 function update(){
  if(!row.isConnected){document.removeEventListener('printer-state',update);return}
  const error=validate(option.word,option.ipa);
  note.textContent=error.startsWith('内容过长')?(option.word.split(/\s+/).length>1?'':'单个单词过长，请在设置中缩小字号。'):error;
  note.hidden=!note.textContent;
 }
 document.addEventListener('printer-state',update);update();
}
async function print(){
 const settings=config();
 if(!plan||planning||plan.some(p=>validate(p.word,p.ipa)))throw Error('无法拆分，请在设置中缩小字号。');
 const parts=plan.map(p=>({...p,requestId:crypto.randomUUID()}));
 completed=0;sync();
 for(const part of parts){
  message(`正在打印 ${completed+1}/${parts.length}…`);
  const start=performance.now();
  P0Diagnostics.record('printer.start',{request:part.requestId,stage:'sending'});
  try{
   localStorage.setItem('p0-option-print-'+part.requestId,'consumed');
   const response=await printerRequest('print',{...part,settings});
   setConnection(response.device);
   P0Diagnostics.record('printer.end',{request:part.requestId,state:response.state==='printed'?'printed':'unknown_result',ms:Math.round(performance.now()-start)});
   if(response.state!=='printed'){
    message(`已确认打印 ${completed}/${parts.length} 张；当前张结果未确认，请检查出纸。已停止。`,true);return;
   }
   completed++;sync();
  }catch(error){P0Diagnostics.record('printer.error',{request:part.requestId,stage:'sending',ms:Math.round(performance.now()-start)},'error');throw Error(`已确认打印 ${completed}/${parts.length} 张；${error.message} 已停止，请先检查出纸。`)}
 }
 message(`已打印 ${completed} 张`);
}
window.P0OptionParts={attach,print};sync();
})();
