import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,utimes,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {DiagnosticLog} from '../server/diagnostics.mjs';
import schema from '../web/diagnostic-schema.js';
const secret='SENSITIVE-fixture-not-a-real-key';
test('metadata whitelist drops credentials, messages, arbitrary errors, paths and invalid IDs',()=>{
 const event=schema.clean({event:'web.error',fields:{apiKey:secret,message:secret,stack:secret,url:secret,request:secret,source:secret,line:18,column:3,error_type:'TypeError',status:401}});
 assert.deepEqual(event.fields,{line:18,column:3,error_type:'TypeError',status:401});
 assert.equal(schema.clean({event:secret}),null);
 assert.ok(!JSON.stringify(event).includes(secret));
});
test('server files rotate, expire, survive logger restart and production omits successful events',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'p0-logs-'));
 try{
  const log=new DiagnosticLog({directory,maxBytes:900,fileCount:3});
  for(let i=0;i<30;i++){log.record('model.headers',{status:200,apiKey:secret,request:secret});await log.flush()}
  const files=await readdir(directory);assert.equal(files.length,3);
  for(const f of files){assert.ok((await stat(join(directory,f))).size<=900);assert.equal((await stat(join(directory,f))).mode&0o777,0o600);assert.ok(!(await readFile(join(directory,f),'utf8')).includes(secret))}
  const production=new DiagnosticLog({directory,debug:false,maxBytes:900,fileCount:2});
  production.record('model.complete',{count:5});production.record('model.error',{status:401},'error');await production.flush();
  assert.ok((await readdir(directory)).length<=2);
  const rows=(await readFile(join(directory,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows.at(-1).event,'model.error');assert.equal(rows.at(-1).mode,'release');assert.ok(!rows.some(r=>r.event==='model.complete'));
  for(const f of await readdir(directory))await utimes(join(directory,f),0,0);
  production.record('app.start');await production.flush();assert.deepEqual(await readdir(directory),['events.jsonl']);
 }finally{await rm(directory,{recursive:true,force:true})}
});
test('native writer is exercised in Debug and Release with rotation and secret rejection',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'p0-native-logs-'));
 try{
  const main=join(folder,'main.swift');await writeFile(main,`
import Foundation
let folder = URL(fileURLWithPath:CommandLine.arguments[1])
let log = DiagnosticLog(folder:folder,maxBytes:1024,fileCount:3)
for i in 0..<30 {log.record("web.error",level:"error",["line":i,"message":"${secret}","request":"${secret}","source":"app.js"]);log.flush()}
log.record("model.complete",["count":10]);log.flush()
print(DiagnosticLog.verbose ? "debug":"release")
`);
  for(const mode of ['debug','release']){
   const exe=join(folder,mode),logs=join(folder,mode+'-logs');execFileSync('swiftc',[...(mode==='debug'?['-D','DEBUG']:[]),resolve('ios/EnglishPrinter/DiagnosticLog.swift'),main,'-o',exe],{stdio:'pipe'});
   assert.equal(execFileSync(exe,[logs],{encoding:'utf8'}).trim(),mode);
   const files=await readdir(logs);assert.ok(files.length<=3);let all='';for(const file of files){assert.ok((await stat(join(logs,file))).size<=1024);all+=await readFile(join(logs,file),'utf8')}
   assert.ok(!all.includes(secret));assert.equal(all.includes('model.complete'),mode==='debug');for(const line of all.trim().split('\n'))assert.equal(JSON.parse(line).mode,mode);
  }
 }finally{await rm(folder,{recursive:true,force:true})}
});
