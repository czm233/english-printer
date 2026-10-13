import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
test('native model config migrates old data, preserves keys, validates effort and applies shared request options',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'p0-effort-'));
 try{
  const main=join(dir,'main.swift'),exe=join(dir,'check');
  await writeFile(main,`import Foundation
func appError(_ message: String) -> NSError {NSError(domain:"Fixture",code:1)}
let base: [String:Any] = ["url":"https://example.com","model":"glm-5.3-flash","apiKey":"test-only-placeholder"]
let decoder = JSONDecoder(),encoder = JSONEncoder()
let old = try decoder.decode(ModelConfig.self,from:JSONSerialization.data(withJSONObject:base))
precondition(old.effort == "low" && old.apiKey == "test-only-placeholder")
let policy = try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]))) as! [String:[String:Any]]
for effort in ["low","high","max"] {
 var json = base;json["effort"] = effort
 let value = try decoder.decode(ModelConfig.self,from:JSONSerialization.data(withJSONObject:json))
 let roundtrip = try decoder.decode(ModelConfig.self,from:encoder.encode(value))
 precondition(roundtrip.effort == effort && roundtrip.apiKey == old.apiKey)
 precondition(value.publicValue["apiKey"] == nil && value.publicValue["effort"] as? String == effort)
 precondition((value.requestOptions(policy)["output_config"] as? [String:String])?["effort"] == effort)
 var other = value;other.model = "unknown-model";precondition(other.requestOptions(policy).isEmpty)
}
for invalid: Any in ["medium","",42,NSNull(),["low"]] {
 var json = base;json["effort"] = invalid
 do {let _ = try decoder.decode(ModelConfig.self,from:JSONSerialization.data(withJSONObject:json));fatalError("invalid effort accepted")} catch {}
}
print("PASS")
`);
  execFileSync('swiftc',[resolve('ios/EnglishPrinter/ModelConfig.swift'),main,'-o',exe],{stdio:'pipe'});
  assert.equal(execFileSync(exe,[resolve('web/model-options.json')],{encoding:'utf8'}).trim(),'PASS');
 }finally{await rm(dir,{recursive:true,force:true})}
});
