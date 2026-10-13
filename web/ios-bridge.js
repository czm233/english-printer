// Loaded only by the packaged iOS web view. Web preview keeps its existing server APIs.
(()=>{
const handler=window.webkit?.messageHandlers?.native;if(!handler)return;
const rpc=(op,body={})=>handler.postMessage({op,...body});
document.addEventListener('DOMContentLoaded',()=>{
 document.querySelector('meta[name="viewport"]')?.setAttribute('content','width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover');
 document.documentElement.classList.add('native-ios');
});
if(!crypto.randomUUID)crypto.randomUUID=()=> '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(c)/4).toString(16));
document.addEventListener('click',event=>{
 if(event.target.closest('input,textarea,select,button,label,.entry,.translation-card'))return;
 if(document.activeElement?.matches('input,textarea'))document.activeElement.blur();
});
document.addEventListener('page-change',event=>rpc('navigation',{page:event.detail}).catch(()=>{}));
const streams=new Map(),speech=new Map(),encoder=new TextEncoder();
window.P0Native={setViewport(value){
 window.P0Viewport=value;
 document.documentElement.classList.add('native-ios');
 document.documentElement.classList.toggle('keyboard-open',value.keyboard);
 document.documentElement.style.setProperty('--vh',value.height+'px');
 window.dispatchEvent(new Event('native-viewport'));
},receive(kind,id,event){
 if(kind==='chat'){const item=streams.get(id);if(!item)return;item.controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));if(event.type==='done'||event.type==='error'){item.controller.close();item.cleanup();streams.delete(id)}}
 if(kind==='speech'){const r=speech.get(id);if(!r)return;if(event.type==='result')r.onresult?.({results:[[{transcript:event.text}]]});else if(event.type==='error')r.onerror?.({error:event.error});else if(event.type==='start')r.onstart?.();else if(event.type==='end'){speech.delete(id);r.onend?.()}}
}};
window.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,'englishprinter://app/');
 if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(url.pathname==='/api/chat'){
  const trace=options.p0TraceId||new Headers(options.headers).get('X-Request-ID');const id=/^[a-f0-9-]{36}$/i.test(trace||'')?trace:crypto.randomUUID();let controller;const stream=new ReadableStream({start(c){controller=c},cancel(){rpc('cancelChat',{id}).catch(()=>{});streams.delete(id)}});
  const abort=()=>{rpc('cancelChat',{id}).catch(()=>{});const item=streams.get(id);if(item){streams.delete(id);item.cleanup();controller.error(new DOMException('Aborted','AbortError'))}};
  const cleanup=()=>options.signal?.removeEventListener('abort',abort);streams.set(id,{controller,cleanup});options.signal?.addEventListener('abort',abort,{once:true});
  try{await rpc('chat',{id,body:JSON.parse(options.body)});return new Response(stream,{headers:{'content-type':'text/event-stream','x-request-id':id}})}catch(e){streams.delete(id);cleanup();return new Response(JSON.stringify({error:String(e.message||e)}),{status:400,headers:{'content-type':'application/json'}})}
 }
 try{
  const result=await rpc('request',{traceId:options.p0TraceId||new Headers(options.headers).get('X-Request-ID'),url:url.href,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
  if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
  return new Response(typeof result==='string'?result:JSON.stringify(result),{headers:{'content-type':'application/json'}});
 }catch(e){if(e.name==='AbortError')throw e;return new Response(JSON.stringify({error:String(e.message||e)}),{status:400,headers:{'content-type':'application/json'}})}
};
class NativeSpeechRecognition{
 constructor(){this.id=crypto.randomUUID()}
 start(){speech.set(this.id,this);rpc('speechStart',{id:this.id}).catch(()=>{if(speech.has(this.id)){this.onerror?.({error:'not-allowed'});speech.delete(this.id);this.onend?.()}})}
 stop(){rpc('speechStop',{id:this.id}).catch(()=>{})}
 abort(){speech.delete(this.id);rpc('speechCancel',{id:this.id}).catch(()=>{})}
}
window.SpeechRecognition=NativeSpeechRecognition;
})();
