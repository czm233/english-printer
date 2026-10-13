import http from 'node:http';
import {createTranslator} from './translation.mjs';
import {randomUUID} from 'node:crypto';
import {diagnostics} from './diagnostics.mjs';
import { validateMessages } from './chat-content.mjs';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrinterService } from './printer.mjs';
import { forwardStream, sendEvent } from './stream.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(root, 'web');
const agentConfig=JSON.parse(await readFile(resolve(webRoot,'agent-config.json'),'utf8'));
const modelOptions=JSON.parse(await readFile(resolve(webRoot,'model-options.json'),'utf8'));
export function endpointFor(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error('请输入有效的 API URL。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('API URL 需要 HTTPS；本机测试可使用 HTTP。');
  if (u.username || u.password || u.search || u.hash) throw new Error('API URL 不能包含账号、查询参数或片段。');
  let path = u.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/messages')) path += path.endsWith('/v1') ? '/messages' : '/v1/messages';
  u.pathname = path;
  return u.href;
}
function fail(status, message) { return Object.assign(new Error(message), { status }); }
async function jsonBody(req,limit=256_000) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, '请求需要 JSON。');
  let chunks = [], size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail(413, '消息或照片过大，请缩减内容或新建对话。'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail(400, 'JSON 格式不正确。'); }
}
function send(res, status, body) {
  if(res.headersSent){sendEvent(res,'error',{message:body.error||'回复中断，请重试。'});res.end();return}
  if (!res.writableEnded && !res.destroyed) res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(body));
}
export function createApp({ configPath = resolve(root, '.local/model-config.json'), timeout = 120_000, translate = createTranslator({configPath:resolve(root,'.local/baidu-translation.json')}), printer, logger = diagnostics } = {}) {
  printer ??= new PrinterService({logger});
  let active = false, writing = false,diagnosticWindow=0,diagnosticCount=0;
  function effort(value){if(value===undefined)return 'low';if(!['low','high','max'].includes(value))throw fail(400,'请选择有效的思考强度。');return value}
  async function config() {
    try { const value=JSON.parse(await readFile(configPath,'utf8'));return {...value,effort:effort(value.effort)}; } catch (e) { if (e.code === 'ENOENT') return {url:'',model:'',apiKey:'',effort:'low'}; throw fail(500, '本机配置读取失败。'); }
  }
  const publicConfig = c => ({url:c.url,model:c.model,effort:c.effort,keyConfigured:!!c.apiKey,configured:!!(c.url&&c.model&&c.apiKey)});
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    const host = req.headers.host;
    if (!host || !/^(localhost|127\.0\.0\.1):\d+$/.test(host)) return send(res,403,{error:'只允许本机访问。'});
    const origin = `http://${host}`;
    if (req.headers.origin && req.headers.origin !== origin) return send(res,403,{error:'不允许跨站访问。'});
    const url = new URL(req.url,origin);
    const requested=req.headers['x-request-id'],trace=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requested||'')?requested:randomUUID(),started=performance.now();
    const kind=({'/api/translate':'translation','/api/chat':'chat','/api/config':'config','/api/printer/print':'print','/api/printer/connect':'connect','/api/printer/disconnect':'disconnect'})[url.pathname];
    if(kind){res.setHeader('X-Request-ID',trace);logger.record('bridge.start',{request:trace,kind});res.once('close',()=>logger.record('bridge.end',{request:trace,kind,status:res.statusCode,ms:Math.round(performance.now()-started)},!res.writableFinished||res.statusCode>=400?'error':'info'))}
    try {
      if(url.pathname==='/api/diagnostics/config'&&req.method==='GET')return send(res,200,{debug:logger.debug});
      if(url.pathname==='/api/diagnostics'&&req.method==='POST'){
        if(Date.now()-diagnosticWindow>60000){diagnosticWindow=Date.now();diagnosticCount=0}
        if(++diagnosticCount>120)return send(res,429,{error:'诊断事件过于频繁。'});
        const event=await jsonBody(req,8192);
        if(['web.ready','web.error','web.rejection','web.long_task','web.action','web.navigation','web.visibility','bridge.start','bridge.end','bridge.error','model.complete','model.error'].includes(event.event))logger.record(event.event,event.fields,event.level);
        return send(res,200,{ok:true});
      }
      if(url.pathname==='/api/translate'&&req.method==='POST')return send(res,200,await translate(await jsonBody(req,2048)));
      if (url.pathname === '/api/health'  && req.method === 'GET') return send(res,200,{ok:true,project:'english-printer',root});
      if (url.pathname === '/api/printer/status' && req.method === 'GET') return send(res,200,await printer.status());
      if (url.pathname.startsWith('/api/printer/') && req.method === 'POST') {
        const body = await jsonBody(req);
        if (url.pathname === '/api/printer/connect') return send(res,200,await printer.connect());
        if (url.pathname === '/api/printer/disconnect') return send(res,200,await printer.disconnect());
        if (url.pathname === '/api/printer/print') {logger.record('printer.start',{request:body.requestId,parent:trace});return send(res,200,await printer.print(body));}
      }
      if (url.pathname === '/api/config' && req.method === 'GET') return send(res,200,publicConfig(await config()));
      if (url.pathname === '/api/config' && req.method === 'POST') {
        if (active || writing) throw fail(409,'请等待当前请求完成后再保存。');
        const body = await jsonBody(req);
        if (active || writing) throw fail(409,'请等待当前请求完成后再保存。');
        writing = true;
        try {
          const old = await config(), next = {url:String(body.url||'').trim(),model:String(body.model||'').trim(),apiKey:String(body.apiKey||'').trim(),effort:effort(body.effort===undefined?old.effort:body.effort)};
          if (!next.url || !next.model) throw fail(400,'请填写 API URL 和模型。');
          if (next.url.length>2048 || next.model.length>200 || /\s/.test(next.model)) throw fail(400,'URL 或模型格式不正确。');
          let endpoint; try {endpoint=endpointFor(next.url);} catch(e) {throw fail(400,e.message);}
          // A saved credential is never silently forwarded to a different endpoint.
          if (!next.apiKey && old.url && endpoint === endpointFor(old.url)) next.apiKey=old.apiKey;
          if (!next.apiKey || next.apiKey.length>8192 || /[\r\n]/.test(next.apiKey)) throw fail(400,'请填写 API Key；更换 API URL 时需要重新填写。');
          await mkdir(dirname(configPath),{recursive:true,mode:0o700});
          await writeFile(configPath+'.tmp',JSON.stringify(next),{mode:0o600});
          await rename(configPath+'.tmp',configPath);
          return send(res,200,publicConfig(next));
        } finally { writing=false; }
      }
      if (url.pathname === '/api/chat' && req.method === 'POST') {
        const body = await jsonBody(req,17_000_000), c = await config();
        if (!c.url||!c.model||!c.apiKey) throw fail(400,'请先在设置中配置大模型。');
        const messages = validateMessages(body.messages), streaming=body.stream===true;
        if (active || writing) throw fail(409,'已有请求正在处理，请稍后重试。');
        active=true;
        logger.record("model.start",{request:trace,count:messages.length});
        const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),timeout);
        res.on('close',()=>ctrl.abort());
        try {
          let response;
          try {
            response=await fetch(endpointFor(c.url),{method:'POST',headers:{'content-type':'application/json','x-api-key':c.apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:c.model,max_tokens:2048,stream:streaming,messages,...(streaming?agentConfig:{system:agentConfig.system}),...(Object.hasOwn(modelOptions,c.model)?{...modelOptions[c.model],output_config:{...modelOptions[c.model].output_config,effort:c.effort}}:{})}),signal:ctrl.signal,redirect:'manual'});
          } catch { throw fail(502,ctrl.signal.aborted?'请求超时或已取消，请重试。':'无法连接模型服务，请检查 API URL 和网络。'); }
          logger.record("model.headers",{request:trace,status:response.status,ms:Math.round(performance.now()-started)});
          if (!response.ok) {
            const hints={400:'请求参数不被接受，请检查模型名称、协议及模型是否支持图片。',401:'API Key 无效或已过期。',403:'API Key 无权访问该模型。',404:'接口或模型不存在，请检查 URL 和模型。',429:'请求过于频繁或额度不足，请稍后重试。',529:'模型服务繁忙，请稍后重试。'};
            // Do not echo provider error text: it may include credentials or arbitrary HTML.
            await response.body?.cancel();
            throw fail(502,`模型服务返回 ${response.status}：${hints[response.status]||(response.status>=300&&response.status<400?'接口发生跳转，请填写最终 API URL。':'服务暂不可用，请稍后重试。')}`);
          }
          if(streaming)return await forwardStream(response,res,(event,fields,level)=>logger.record(event,{...fields,request:trace,ms:Math.round(performance.now()-started)},level||(performance.now()-started>(event==='model.first_text'?5000:30000)?'warning':'info')));
          let data; try {data=await response.json();} catch {throw fail(502,'模型服务未返回有效的 Messages JSON。');}
          const text = Array.isArray(data.content) ? data.content.filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n').trim() : '';
          if (!text) throw fail(502,'模型未返回文字内容，请确认使用 Anthropic Messages 协议。');
          return send(res,200,{text,stopReason:data.stop_reason||null});
        } finally {clearTimeout(timer);active=false;}
      }
      if (url.pathname.startsWith('/api/')) return send(res,404,{error:'接口不存在。'});
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res,405,{error:'不支持此操作。'});
      const name=decodeURIComponent(url.pathname === '/'?'/index.html':url.pathname), path=resolve(webRoot,'.'+name);
      if (!path.startsWith(webRoot+'/') || name.split('/').some(p=>p.startsWith('.'))) throw fail(404,'文件不存在。');
      let bytes; try {if (!(await stat(path)).isFile()) throw new Error();bytes=await readFile(path);} catch {throw fail(404,'文件不存在。');}
      const type={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain; charset=utf-8'}[extname(path)]||'application/octet-stream';
      res.writeHead(200,{'content-type':type,'cache-control':'no-cache'}).end(req.method==='HEAD'?undefined:bytes);
    } catch(e) { if(kind)logger.record(kind==='chat'?'model.error':'bridge.error',{request:trace,kind,status:e.status||500,ms:Math.round(performance.now()-started)},'error');send(res,e.status||500,{error:e.status?e.message:'本机服务发生错误，请稍后重试。'}); }
  });
  server.on('close',()=>printer.close());
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server=createApp();diagnostics.record('app.start');
  server.listen(10290,'127.0.0.1',()=>console.log('English Printer: http://127.0.0.1:10290'));
  server.on('error',()=>{console.error('无法启动本机服务，请检查 10290 端口。');process.exit(1);});
}
