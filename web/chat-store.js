// Native storage is independent of the versioned application bundle URL.
(()=>{
let database,revision=null,baseline,writeQueue=Promise.resolve();
const conflict=()=>Object.assign(Error('聊天记录已在其他标签页更新，请重新打开此页。'),{code:'HISTORY_CONFLICT'});
function validateClaim(value,id){
 const cards=new Map((value?.cards||[]).map(card=>[card.id,card])),card=cards.get(id);
 if(!/^[a-f0-9-]{36}$/i.test(id)||!card?.used||card.children?.some(child=>!cards.get(child)?.used))throw Error('打印卡片未完整保存，未发送打印。');
}
async function db(){
 if(!database)database=new Promise((resolve,reject)=>{const r=indexedDB.open('english-printer-chat',1);r.onupgradeneeded=()=>r.result.createObjectStore('history');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 return database;
}
async function access(value,write,claim){
 if(claim)validateClaim(value,claim);
 if(window.P0Native){const r=await fetch('/api/history',{method:write?'POST':'GET',...(write?{body:JSON.stringify(value)}:{})});if(!r.ok)throw Error('history storage');return r.json()}
 const serialized=write?JSON.stringify(value):null;
 // An unchanged old page may close without saving; it must never rebase its in-memory data.
 if(write&&!claim&&serialized===baseline)return {ok:true};
 const d=await db();return new Promise((resolve,reject)=>{
  const t=d.transaction('history',write?'readwrite':'readonly'),s=t.objectStore('history');
  const version=s.get('revision'),snapshot=s.get('snapshot');let nextRevision,error;
  const abort=e=>{error=e;t.abort()};
  snapshot.onsuccess=()=>{
   const current=version.result??0;
   if(!write)return;
   // Comparing the snapshot also detects writes from a page opened before revision tracking.
   if(revision===null||revision!==current||JSON.stringify(snapshot.result||null)!==baseline){abort(conflict());return}
   const commit=()=>{nextRevision=current+1;s.put(value,'snapshot');s.put(nextRevision,'revision')};
   if(claim){
    const consumed=s.get('print:'+claim);
    consumed.onsuccess=()=>{
     if(consumed.result){abort(Object.assign(Error('此卡片已在其他标签页确认，请先检查出纸。'),{code:'PRINT_ALREADY_CLAIMED'}));return}
     s.put(true,'print:'+claim);commit();
    };
   }else commit();
  };
  t.oncomplete=()=>{
   if(write){revision=nextRevision;baseline=serialized}
   else if(revision===null){revision=version.result??0;baseline=JSON.stringify(snapshot.result||null)}
   resolve(write?{ok:true}:snapshot.result||null);
  };
  const failed=()=>reject(error||t.error||Error('历史记录保存失败，请重试。'));
  t.onerror=failed;t.onabort=failed;
 });
}
async function traced(value,write,claim){
 const request=crypto.randomUUID(),started=performance.now();
 try{const result=await access(value,write,claim);window.P0Diagnostics?.record(write?'history.write':'history.read',{request,ms:Math.round(performance.now()-started),status:200});return result}
 catch(error){window.P0Diagnostics?.record(write?'history.write':'history.read',{request,ms:Math.round(performance.now()-started),status:500},'error');throw error}
}
window.P0ChatStore={load:()=>traced(null,false),save(value,{claim}={}){
 const snapshot=structuredClone(value);
 const run=writeQueue.catch(()=>{}).then(()=>traced(snapshot,true,claim));writeQueue=run;return run;
}};
})();
