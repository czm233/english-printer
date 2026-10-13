// Native storage is independent of the versioned application bundle URL.
(()=>{
let database;
async function db(){
 if(!database)database=new Promise((resolve,reject)=>{const r=indexedDB.open('english-printer-chat',1);r.onupgradeneeded=()=>r.result.createObjectStore('history');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 return database;
}
async function access(value,write){
 if(window.P0Native){const r=await fetch('/api/history',{method:write?'POST':'GET',...(write?{body:JSON.stringify(value)}:{})});if(!r.ok)throw Error('history storage');return r.json()}
 const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('history',write?'readwrite':'readonly'),s=t.objectStore('history'),r=write?s.put(value,'snapshot'):s.get('snapshot');t.oncomplete=()=>resolve(write?{ok:true}:r.result||null);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)});
}
async function traced(value,write){
 const request=crypto.randomUUID(),started=performance.now();
 try{const result=await access(value,write);window.P0Diagnostics?.record(write?'history.write':'history.read',{request,ms:Math.round(performance.now()-started),status:200});return result}
 catch(error){window.P0Diagnostics?.record(write?'history.write':'history.read',{request,ms:Math.round(performance.now()-started),status:500},'error');throw error}
}
window.P0ChatStore={load:()=>traced(null,false),save:value=>traced(value,true)};
})();
