import {mkdir,readFile,writeFile,appendFile,rename,rm,stat,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import schema from '../web/diagnostic-schema.js';
export class DiagnosticLog {
 constructor({directory=resolve('.local/diagnostics/server'),debug=process.env.NODE_ENV!=='production',maxBytes,fileCount}={}){
  this.directory=directory;this.debug=debug;this.maxBytes=maxBytes??(debug?1048576:262144);this.fileCount=fileCount??(debug?5:2);this.retention=(debug?7:3)*86400000;this.session=randomUUID();this.queue=Promise.resolve();this.pending=0;this.dropped=0;
 }
 record(event,fields={},level='info'){
  const safe=schema.clean({event,fields,level});if(!safe||(!this.debug&&!['warning','error'].includes(level)&&event!=='app.start'))return;
  if(this.pending>=128){this.dropped++;return}this.pending++;
  const row={schema:1,time:new Date().toISOString(),uptime_ms:Math.round(process.uptime()*1000),session:this.session,mode:this.debug?'debug':'release',runtime:process.version,...safe};
  this.queue=this.queue.then(async()=>{
   await mkdir(this.directory,{recursive:true,mode:0o700});
   for(let i=0;i<5;i++){const f=resolve(this.directory,i?`events.${i}.jsonl`:'events.jsonl'),s=await stat(f).catch(()=>null);if(s&&(i>=this.fileCount||Date.now()-s.mtimeMs>this.retention))await rm(f)}
   if(this.dropped){row.dropped=this.dropped;this.dropped=0}
   const data=JSON.stringify(row)+'\n',file=resolve(this.directory,'events.jsonl'),size=(await stat(file).catch(()=>({size:0}))).size;
   if(size+Buffer.byteLength(data)>this.maxBytes){await rm(resolve(this.directory,`events.${this.fileCount-1}.jsonl`),{force:true});for(let i=this.fileCount-2;i>=0;i--)await rename(resolve(this.directory,i?`events.${i}.jsonl`:'events.jsonl'),resolve(this.directory,`events.${i+1}.jsonl`)).catch(e=>{if(e.code!=='ENOENT')throw e})}
   await appendFile(file,data,{mode:0o600});await chmod(file,0o600);
  }).catch(()=>{this.dropped++}).finally(()=>{this.pending--});
 }
 flush(){return this.queue}
}
export const diagnostics=new DiagnosticLog();
