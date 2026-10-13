(()=>{
const native=window.webkit?.messageHandlers?.native,originalFetch=window.fetch.bind(window);
let debug=!!window.P0DiagnosticsDebug,windowStart=Date.now(),sent=0;
function record(event,fields={},level='info'){
 try{
  if(!debug&&!['warning','error'].includes(level))return;
  const now=Date.now();if(now-windowStart>60000){windowStart=now;sent=0}if(sent++>=100)return;
  const value=P0DiagnosticSchema.clean({event,fields,level});if(!value)return;
  if(native)native.postMessage({op:'diagnostic',body:value}).catch(()=>{});
  else originalFetch('/api/diagnostics',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value),keepalive:true}).catch(()=>{});
 }catch{} // Diagnostics cannot break the App or recursively log themselves.
}
window.P0Diagnostics={record};
function errorFields(error,event){
 const fields={error_type:P0DiagnosticSchema.lists.tokens.includes(error?.name)?error.name:'Error'};
 const source=String(event?.filename||'').split('/').at(-1)?.split('?')[0];
 if(P0DiagnosticSchema.lists.sources.includes(source))Object.assign(fields,{source,line:event.lineno||0,column:event.colno||0});
 // Parse locations only: error messages and entire stacks can contain user input or credentials.
 if(!fields.source&&typeof error?.stack==='string'){
  for(const line of error.stack.split('\n').slice(0,10)){
   const m=line.match(/(?:\/|@|\s)([a-z.-]+\.js):(\d+):(\d+)\)?$/i);
   if(m&&P0DiagnosticSchema.lists.sources.includes(m[1])){Object.assign(fields,{source:m[1],line:+m[2],column:+m[3]});break}
  }
 }
 return fields;
}
window.addEventListener('error',e=>record('web.error',errorFields(e.error,e),'error'));
window.addEventListener('unhandledrejection',e=>record('web.rejection',errorFields(e.reason),'error'));
document.addEventListener('page-change',e=>record('web.navigation',{page:e.detail}));
document.addEventListener('visibilitychange',()=>record('web.visibility',{state:document.hidden?'background':'active'}));
document.addEventListener('click',e=>{
 const button=e.target.closest?.('button');if(!button)return;
 const action=button.hasAttribute('data-choice-index')?'choose_option':button.hasAttribute('data-confirm-print')?'confirm_card':button.hasAttribute('data-speak-text')?'audio':button.id;
 if(P0DiagnosticSchema.lists.actions.includes(action))record('web.action',{action,request:button.dataset.confirmPrint});
});
function start(){
 record('web.ready');
 if(!debug)return;
 let last=performance.now();document.addEventListener('visibilitychange',()=>last=performance.now());
 setInterval(()=>{const now=performance.now(),delay=now-last-1000;last=now;if(!document.hidden&&delay>500)record('web.long_task',{ms:Math.round(delay)},'warning')},1000);
}
if(native)start();else originalFetch('/api/diagnostics/config').then(r=>r.json()).then(c=>{debug=c.debug===true;start()}).catch(()=>{});
window.fetch=async(input,options={})=>{
 let kind;try{const u=new URL(typeof input==='string'?input:input.url,location.href);kind=({'/api/chat':'chat','/api/config':'config','/api/printer/print':'print','/api/printer/connect':'connect','/api/printer/disconnect':'disconnect','/pronunciations.json':'dictionary'})[u.pathname];if(u.host==='api.mymemory.translated.net'&&u.pathname==='/get')kind='translation'}catch{}
 if(!kind)return originalFetch(input,options);
 const start=performance.now(),id=crypto.randomUUID();if(native)options={...options,p0TraceId:id};
 if(!['translation','dictionary'].includes(kind)){const headers=new Headers(options.headers||input?.headers);headers.set('X-Request-ID',id);options={...options,headers}}
 record('bridge.start',{request:id,kind});
 try{const r=await originalFetch(input,options);record('bridge.end',{request:id,kind,status:r.status,ms:Math.round(performance.now()-start)},!r.ok?'error':performance.now()-start>3000?'warning':'info');return r}
 catch(e){record('bridge.error',{request:id,kind,ms:Math.round(performance.now()-start),...errorFields(e)},'error');throw e}
};
})();
