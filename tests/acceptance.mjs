// Temporary browser acceptance fixture. All printer operations are simulated; no Bluetooth is opened.
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {DiagnosticLog} from '../server/diagnostics.mjs';
import {createApp} from '../server/server.mjs';import {validateLabel,renderLabel} from '../server/printer.mjs';import {mockServer} from './mock.mjs';
const dir=await mkdtemp(resolve('work/ui-acceptance-')),configPath=resolve(dir,'config.json'),mock=mockServer();
await writeFile(configPath,JSON.stringify({url:'http://127.0.0.1:10291',model:'test-model',apiKey:'test-only-placeholder'}),{mode:0o600});
let connected=false,prints=[];
const snapshot=()=>({connected,busy:false,name:'德佟 P0',detail:connected?'可打印':'未连接',dpi:203,width:96,printable:0});
const printer={status:async()=>snapshot(),connect:async()=>{connected=true;return snapshot()},disconnect:async()=>{connected=false;return snapshot()},close(){},async print(body){
 const label=validateLabel(body);await renderLabel(label);if(label.word.toLowerCase()==='paper')throw Object.assign(Error('打印机缺纸，请处理后再打印。'),{status:409});
 connected=true;prints.push(label);await writeFile(resolve(dir,'prints.json'),JSON.stringify(prints));await new Promise(r=>setTimeout(r,300));return {state:'printed',copies:1,device:snapshot(),message:'已打印 1 张'};
}};
const logger=new DiagnosticLog({directory:resolve(dir,'diagnostics')});const app=createApp({configPath,printer,logger,translate:async body=>({text:body.direction==='en-zh'?'玻璃茶壶':'glass teapot',provider:'test',cached:false,ms:1})});if(process.env.P0_OPTION_FIXTURE==='1'){
 const handlers=app.listeners('request');app.removeAllListeners('request');
 app.on('request',async(req,res)=>{
  if(req.url==='/translation-options.js'){
   const source=await readFile(resolve('web/translation-options.js'),'utf8');
   res.writeHead(200,{'Content-Type':'text/javascript'});res.end(source+`;(()=>{const original=P0Translations;window.P0Translations={has:s=>s==='拆分测试'||original.has(s),candidates:(s,...args)=>s==='拆分测试'?[{word:'super invincible refrigerator',note:''}]:original.candidates(s,...args)}})();`);return;
  }
  for(const handler of handlers)handler.call(app,req,res);
 });
}
await new Promise(r=>mock.listen(10291,'127.0.0.1',r));await new Promise(r=>app.listen(10292,'127.0.0.1',r));
console.log('Simulated acceptance: http://127.0.0.1:10292/');console.log('Test output: '+dir+'/prints.json');
async function close(){app.closeAllConnections();mock.closeAllConnections();await Promise.all([new Promise(r=>app.close(r)),new Promise(r=>mock.close(r))]);await logger.flush();await rm(dir,{recursive:true,force:true});process.exit(0)}process.on('SIGTERM',close);process.on('SIGINT',close);
