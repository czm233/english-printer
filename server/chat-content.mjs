import agent from '../web/agent-protocol.js';
// Permit text and embedded raster photos only. Never fetch a client-supplied image URL.
export function validateMessages(messages) {
  const invalid=()=>{throw Object.assign(Error('对话格式或长度不正确，请新建对话后重试。'),{status:400})};
  if(!Array.isArray(messages)||messages.length<1||messages.length>40||messages.at(-1)?.role!=='user')invalid();
  let photos=0,pending=[];const toolIds=new Set();
  return messages.map((message,i)=>{
    if(!message||message.role!==(i%2===0?'user':'assistant'))invalid();
    const text=value=>typeof value==='string'&&value.trim()&&value.length<=16000;
    if(typeof message.content==='string'){if(pending.length||!text(message.content))invalid();return {role:message.role,content:message.content}}
    if(!Array.isArray(message.content)||!message.content.length||message.content.length>14)invalid();
    if(message.role==='assistant'){
      const content=message.content.map(block=>{
        if(block?.type==='text'&&text(block.text))return {type:'text',text:block.text};
        if(block?.type!=='tool_use'||!['print_label','offer_choices'].includes(block.name)||pending.length>=12||typeof block.id!=='string'||! /^[\w-]{1,200}$/.test(block.id)||toolIds.has(block.id))invalid();
        let input;try{input=agent.toolInput(block.name,block.input)}catch{invalid()}
        pending.push(block.id);toolIds.add(block.id);return {type:'tool_use',id:block.id,name:block.name,input};
      });
      return {role:message.role,content};
    }
    const expected=[...pending];pending=[];let results=0;
    let imageCount=0,textCount=0;
    const content=message.content.map(block=>{
      if(block?.type==='tool_result'){
        if(results>=expected.length||block.tool_use_id!==expected[results]||!text(block.content)||imageCount||textCount)invalid();
        results++;return {type:'tool_result',tool_use_id:block.tool_use_id,content:block.content};
      }
      if(block?.type==='text'){if(++textCount>1||!text(block.text))invalid();return {type:'text',text:block.text}}
      if(block?.type!=='image'||++imageCount>1)invalid();
      const source=block.source;
      if(source?.type!=='base64'||!['image/jpeg','image/png','image/webp','image/gif'].includes(source.media_type)||typeof source.data!=='string'||!source.data.length||source.data.length>2_000_000||source.data.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(source.data))invalid();
      const bytes=Buffer.from(source.data,'base64');
      const signatures={'image/jpeg':bytes[0]===255&&bytes[1]===216&&bytes[2]===255,'image/png':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'image/gif':/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()),'image/webp':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'};
      if(!signatures[source.media_type])invalid();
      if(++photos>8)throw Object.assign(Error('本轮照片较多，请新建对话后继续。'),{status:400});
      return {type:'image',source:{type:'base64',media_type:source.media_type,data:source.data}};
    });
    if(results!==expected.length)invalid();
    return {role:message.role,content};
  });
}
