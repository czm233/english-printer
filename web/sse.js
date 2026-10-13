// Shared incremental SSE framing. Handles split UTF-8, CRLF, comments and multiline data.
(()=>{
async function* readEvents(body){
  if(!body)throw Error('响应没有数据流。');
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='',event='',data=[];
  try{
    while(true){
      const {value,done}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
      if(buffer.length>262144)throw Error('数据流内容过长。');
      let match;
      while((match=/[\r\n]/.exec(buffer))){
        const i=match.index;if(buffer[i]==='\r'&&i===buffer.length-1&&!done)break;
        const line=buffer.slice(0,i);buffer=buffer.slice(i+(buffer[i]==='\r'&&buffer[i+1]==='\n'?2:1));
        if(!line){if(data.length)yield {event:event||'message',data:data.join('\n')};event='';data=[];continue}
        if(line.startsWith(':'))continue;
        const colon=line.indexOf(':'),field=colon<0?line:line.slice(0,colon);let content=colon<0?'':line.slice(colon+1);if(content.startsWith(' '))content=content.slice(1);
        if(field==='event')event=content;
        if(field==='data'){data.push(content);if(data.reduce((n,s)=>n+s.length,0)>262144)throw Error('数据流事件过长。')}
      }
      if(done)break;
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
const api={readEvents};if(typeof module!=='undefined'&&module.exports)module.exports=api;else globalThis.P0SSE=api;
})();
