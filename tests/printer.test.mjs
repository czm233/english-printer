import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrinterService, renderLabel, validateLabel } from '../server/printer.mjs';

const settings={font:10,border:0,top:2,bottom:2,left:1,right:1};
const body=()=>({requestId:randomUUID(),word:'hello',ipa:'/həˈləʊ/',settings:{...settings}});
class Device {
  connected=false; writes=0; printable=0; progress=0; dpi=203;
  async connect(){this.connected=true}
  async disconnect(){this.connected=false}
  async query(cmd){
    if(cmd===113)return {popShort:()=>this.dpi};
    if(cmd===114)return {Data:[96,0],popShort:()=>96};
    if(cmd===119)return {popEBV:()=>100};
    if(cmd===112){const code=this.progress?--this.progress:0;return {Data:[this.printable||code]}}
    throw Error('Unexpected query');
  }
  async write(bytes){assert.ok(bytes.length>0);this.writes++;this.progress=2;if(this.failWrite)throw Error('Transport dropped after write')}
  close(){}
}
const image={rgba:Buffer.alloc(240*96*4,255),png:Buffer.from('fake-test-image')};
test('real label renderer handles IPA and settings; rejects overflow before any hardware operation',async()=>{
  const oldPhrase=validateLabel({...body(),word:'glass teapot',ipa:'/ɡlæs; ˈtiˌpɑt/'});
  assert.equal(oldPhrase.ipa,'/ɡlæs ˈtiˌpɑt/');
  const newPhrase=validateLabel({...body(),word:'glass teapot',ipa:'/ɡlæs ˈtiˌpɑt/'});
  assert.deepEqual((await renderLabel(oldPhrase)).rgba,(await renderLabel(newPhrase)).rgba);
  const label=validateLabel(body());
  const original=await renderLabel(label);
  assert.equal(original.rgba.length,240*96*4);
  assert.equal(original.png.subarray(1,4).toString(),'PNG');
  const resized=await renderLabel(validateLabel({...body(),settings:{...settings,width:40,height:10,font:8,top:1,bottom:1}}));
  assert.equal(resized.width,320);assert.equal(resized.height,80);assert.equal(resized.rgba.length,320*80*4);
  assert.throws(()=>validateLabel({...body(),settings:{...settings,height:13}}),/尺寸/);
  assert.throws(()=>validateLabel({...body(),settings:{...settings,height:6,top:3,bottom:3}}),/边距/);
  const adjusted=await renderLabel({...label,settings:{...settings,font:8,border:.2,left:2,top:1}});
  assert.notDeepEqual(original.rgba,adjusted.rgba);
  await assert.rejects(renderLabel({...label,word:'a very long phrase that cannot fit inside this label'}),/超出标签/);
  assert.throws(()=>validateLabel({...body(),settings:{...settings,top:9}}),/无效/);
  assert.throws(()=>validateLabel({...body(),settings:{...settings,font:'10'}}),/无效/);
  assert.throws(()=>validateLabel({...body(),word:'hello\nprint again'}),/无效/);
});
test('persistent connection, paper checks, serialized printing, and durable duplicate protection',async()=>{
  const dir=await mkdtemp(resolve('work/printer-test-')),device=new Device();
  const p=new PrinterService({logger:{record(){}},transport:device,render:async()=>image,jobDir:dir});
  try {
    assert.equal((await p.status()).connected,false);
    assert.equal((await p.connect()).connected,true);
    device.printable=35;
    await assert.rejects(p.print(body()),/缺纸/);assert.equal(device.writes,0);
    device.printable=0;
    const job=body(),first=p.print(job),duplicate=p.print(job);
    await assert.rejects(p.print(body()),/正在处理/);
    const [a,b]=await Promise.all([first,duplicate]);
    assert.equal(a.state,'printed');assert.equal(a.requestId,b.requestId);assert.equal(device.writes,1);
    assert.equal(a.device.busy,false);assert.equal(b.device.busy,false);
    assert.equal((await stat(resolve(dir,job.requestId+'.json'))).mode&0o777,0o600);
    await assert.rejects(p.print({...job,word:'coffee'}),/不能改变/);
    const afterRestart=new PrinterService({logger:{record(){}},transport:new Device(),render:async()=>image,jobDir:dir});
    assert.equal((await afterRestart.print(job)).duplicate,true);assert.equal(afterRestart.transport.writes,0);
    device.failWrite=true;const uncertain=body();
    await assert.rejects(p.print(uncertain),/结果未确认/);assert.equal(device.writes,2);
    await assert.rejects(p.print(uncertain),/避免重复打印/);assert.equal(device.writes,2);
    assert.equal((await p.disconnect()).connected,false);
    device.dpi=300;
    await assert.rejects(p.print(body()),/尺寸/);assert.equal(device.writes,2);
  }finally{p.close();await rm(dir,{recursive:true,force:true})}
});
