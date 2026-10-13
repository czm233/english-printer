import sse from '../web/sse.js';
const fail=message=>Object.assign(new Error(message),{status:502});
export function sendEvent(res,type,data={}){if(!res.destroyed&&!res.writableEnded)res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`)}
export async function forwardStream(response,res,log=()=>{}){
  if(!response.headers.get('content-type')?.includes('text/event-stream')){await response.body?.cancel();throw fail('模型服务未返回流式响应，请确认支持 Anthropic 流式协议。')}
  res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','x-accel-buffering':'no'});res.flushHeaders();
  sendEvent(res,'start');
  let text='',stopReason=null,lastBlock=null,toolCount=0,toolBytes=0;
  function delta(part,index){if(typeof part!=='string'||!part)return;if(lastBlock!==null&&index!==lastBlock)part='\n'+part;lastBlock=index;if(!text)log('model.first_text',{});text+=part;if(text.length>64000)throw fail('回复过长，请缩小问题范围。');sendEvent(res,'delta',{text:part})}
  try{
    for await(const event of sse.readEvents(response.body)){
      let d;try{d=JSON.parse(event.data)}catch{throw fail('模型流式响应格式不正确。')}
      const type=d.type||event.event;
      if(type==='error')throw fail(d.error?.type==='overloaded_error'?'模型服务繁忙，请稍后重试。':'模型服务中断，请重试。');
      if(type==='content_block_start'&&d.content_block?.type==='text')delta(d.content_block.text,d.index);
      if(type==='content_block_delta'&&d.delta?.type==='text_delta'&&typeof d.delta.text==='string')delta(d.delta.text,d.index);
      if(type==='content_block_start'&&d.content_block?.type==='tool_use'){
        if(++toolCount>12)throw fail('一次最多生成 12 张打印卡片。');
        sendEvent(res,'tool_start',{index:d.index,id:d.content_block.id,name:d.content_block.name,input:d.content_block.input});
      }
      if(type==='content_block_delta'&&d.delta?.type==='input_json_delta'){
        toolBytes+=(d.delta.partial_json?.length||0);if(toolBytes>49152)throw fail('打印参数过长。');
        sendEvent(res,'tool_delta',{index:d.index,json:d.delta.partial_json});
      }
      if(type==='content_block_stop')sendEvent(res,'tool_end',{index:d.index});
      if(type==='message_delta')stopReason=d.delta?.stop_reason||stopReason;
      if(type==='message_stop'){
        if(!text.trim()&&!toolCount)throw fail('模型未返回文字内容。');
        log('model.complete',{characters:text.length,tools:toolCount});sendEvent(res,'done',{stopReason});res.end();return;
      }
      // Thinking, signatures, usage, ping and future event types are not printable reply text.
    }
    throw fail('回复中途断开，请重试。');
  }catch(error){if(error.status)throw error;throw fail('回复中断或超时，请重试。')}
}
