import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {execFileSync} from 'node:child_process';import schema from '../web/diagnostic-schema.js';
test('native history file survives separate processes; atomic writes, permissions and malformed data preserve existing content',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'p0-history-'));
 try{
 const main=join(dir,'main.swift'),exe=join(dir,'history-test'),file=join(dir,'store/history.json');
 await writeFile(main,`import Foundation
@main struct Check {static func main() async throws {
 let store=ChatHistoryStore(file:URL(fileURLWithPath:CommandLine.arguments[1]))
 switch CommandLine.arguments[2] {
 case "write":let _=try await store.access(method:"POST",body:["version":1,"current":"fixture","sessions":[["fixture",["title":"本地测试"]]],"cards":[],"choices":[]])
 case "read":let value=try await store.access(method:"GET",body:[:]) as! [String:Any];precondition(value["current"] as? String == "fixture")
 case "invalid":do {let _=try await store.access(method:"POST",body:["version":999]);fatalError("accepted invalid schema")}catch{}
 case "corrupt":do {let _=try await store.access(method:"GET",body:[:]);fatalError("accepted corrupt file")}catch{}
 default:fatalError()
 }
}}
`);
 execFileSync('swiftc',['-parse-as-library',resolve('ios/EnglishPrinter/ChatHistoryStore.swift'),main,'-o',exe]);
 execFileSync(exe,[file,'write']);const original=await readFile(file);execFileSync(exe,[file,'read']);execFileSync(exe,[file,'invalid']);assert.deepEqual(await readFile(file),original);assert.equal((await stat(file)).mode&0o777,0o600);
 await writeFile(file,'broken');execFileSync(exe,[file,'corrupt']);assert.equal(await readFile(file,'utf8'),'broken');
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('history diagnostic events allow timing metadata but never message or photo data',()=>{
 for(const event of ['history.read','history.write']){const row=schema.clean({event,fields:{ms:4,status:500,content:'private',photo:'private',sessions:'private'}});assert.deepEqual(row.fields,{ms:4,status:500})}
});
