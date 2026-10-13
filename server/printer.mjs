import phonetics from '../web/phonetics.js';
import {diagnostics} from './diagnostics.mjs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdk = createRequire(import.meta.url)('../printer/lpapi.cjs');
const exec = promisify(execFile);
const fail = (status, message) => Object.assign(new Error(message), { status });
const states = { 0:'可打印', 1:'正在打印', 2:'正在走纸', 10:'无打印任务', 11:'标签未就绪', 12:'打印已取消', 20:'设备未就绪', 30:'电量不足', 31:'电压异常', 32:'打印头异常', 33:'打印头过热', 34:'纸仓盖未关闭', 35:'缺纸', 37:'缺少色带', 39:'打印头温度过低', 42:'未检测到标签', 43:'标签不匹配', 44:'标签已用尽', 50:'标签仓未关闭' };
const stateText = code => states[code] || '设备状态异常';
let building;
export async function buildNative() {
  if (!building) building = (async () => {
    await mkdir(resolve(root, '.local/bin'), { recursive:true, mode:0o700 });
    for (const name of ['bridge', 'label']) {
      const src = resolve(root, `printer/${name}.swift`), out = resolve(root, `.local/bin/p0-${name}`);
      const source = await stat(src), target = await stat(out).catch(() => null);
      if (!target || target.mtimeMs < source.mtimeMs) await exec('swiftc', [src, '-o', out], { timeout:60000 });
    }
  })().catch(e => { building = null; throw fail(503, '打印组件编译失败，请检查 Mac 的 Swift 开发环境。'); });
  return building;
}

export class BluetoothTransport {
  connected = false;
  child = null;
  pending = new Map();
  queries = new Map();
  readBuffer = [];
  starts = [];
  async start() {
    if (this.child) return;
    await buildNative();
    const child = spawn(resolve(root, '.local/bin/p0-bridge'), [], { cwd:root, stdio:['pipe','pipe','pipe'] });
    this.child = child;
    child.stdin.on('error', () => {});
    // CoreBluetooth diagnostics stay out of the UI and cannot contain API configuration.
    child.stderr.resume();
    const lines = createInterface({ input:child.stdout });
    lines.on('line', line => {
      let event; try { event = JSON.parse(line); } catch { return; }
      if (event.event === 'state') {
        this.connected = event.connected;
        if (!event.connected) {
          this.readBuffer.length = 0; this.starts.length = 0;
          for (const q of this.queries.values()) q.reject(fail(503, event.error || '设备已断开。'));
        }
      } else if (event.event === 'data') {
        const packets = sdk.DeviceConnection.parsePackageList(Buffer.from(event.data,'base64'), this.readBuffer, this.starts);
        for (const packet of packets) this.queries.get(packet.cmd)?.resolve(packet);
      } else if (event.id) {
        const p = this.pending.get(event.id);
        if (p) { this.pending.delete(event.id); clearTimeout(p.timer); event.ok ? p.resolve() : p.reject(fail(503, event.error || '蓝牙操作失败。')); }
      }
    });
    const closed = () => {
      if (this.child !== child) return;
      this.child = null; this.connected = false; lines.close();
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(fail(503, '蓝牙服务已断开，请重新连接设备。')); }
      this.pending.clear();
      for (const q of this.queries.values()) q.reject(fail(503, '蓝牙连接已断开。'));
      this.readBuffer.length = 0; this.starts.length = 0;
    };
    child.on('error', closed); child.on('exit', closed);
  }
  rpc(op, data, timeout=15000) {
    return new Promise((resolve, reject) => {
      if (!this.child) return reject(fail(503, '蓝牙服务未启动。'));
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id); this.child?.kill();
        reject(fail(504, '蓝牙响应超时，请检查打印机后重连。'));
      }, timeout);
      this.pending.set(id, {resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,op,...data})+'\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(fail(503, '蓝牙服务无法接收指令。')); }
      });
    });
  }
  async connect() { await this.start(); await this.rpc('connect',{},23000); }
  async disconnect() { if (this.child) await this.rpc('disconnect',{},6000); }
  write(data) { return this.rpc('write',{data:Buffer.from(data).toString('base64')}); }
  async query(command) {
    if (this.queries.has(command)) throw fail(409,'设备正在查询状态。');
    let timer;
    const response = new Promise((resolve,reject) => {
      this.queries.set(command,{resolve,reject});
      timer = setTimeout(() => reject(fail(504,'打印机未返回状态，请重连后重试。')),4000);
    });
    try { return (await Promise.all([this.write(new sdk.DzPackage(command).getBytes()),response]))[1]; }
    finally { clearTimeout(timer); this.queries.delete(command); }
  }
  close() { this.child?.stdin.end(); }
}

export function validateLabel(body) {
  if (!body || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId || '')) throw fail(400,'打印任务编号无效。');
  if (typeof body.word !== 'string' || typeof body.ipa !== 'string') throw fail(400,'请提供英文与音标。');
  const word=body.word.trim(), ipa=phonetics.format(body.ipa);
  if (!word || !ipa || word.length>120 || ipa.length>240 || /[\u0000-\u001f\u007f]/.test(word+ipa)) throw fail(400,'英文或音标内容无效。');
  const ranges={font:[6,12,.5],border:[0,.5,.1],top:[0,4,.5],bottom:[0,4,.5],left:[0,5,.5],right:[0,5,.5]}, settings={};
  for (const [key,[min,max,step]] of Object.entries(ranges)) {
    const n=body.settings?.[key];
    if (typeof n!=='number' || !Number.isFinite(n) || n<min || n>max || Math.abs(n/step-Math.round(n/step))>1e-8) throw fail(400,'标签字号、边距或边框无效。');
    settings[key]=n;
  }
  for(const [key,min,max,fallback] of [['width',10,100,30],['height',6,12,12]]){
    const n=body.settings?.[key]??fallback;
    if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||!Number.isInteger(n*2))throw fail(400,'标签尺寸无效。');
    settings[key]=n;
  }
  if(settings.width<=settings.left+settings.right||settings.height<=settings.top+settings.bottom)throw fail(400,'边距不能占满标签尺寸。');
  return {word,ipa,settings};
}

export async function renderLabel(label) {
  await buildNative();
  return new Promise((resolve,reject) => {
    const child=execFile(resolvePath('.local/bin/p0-label'),[],{cwd:root,timeout:10000,maxBuffer:1024*1024},(error,stdout,stderr)=> {
      if (error) return reject(fail(400,stderr.includes('内容超出')?'内容超出标签，请减小字号或缩短文字。':'标签生成失败，请检查文字和字号。'));
      try { const d=JSON.parse(stdout), rgba=Buffer.from(d.rgba,'base64'); if(d.width!==Math.round((label.settings.width??30)*8)||d.height!==Math.round((label.settings.height??12)*8)||rgba.length!==d.width*d.height*4) throw Error(); resolve({width:d.width,height:d.height,rgba,png:Buffer.from(d.png,'base64')}); }
      catch { reject(fail(500,'打印图像生成异常。')); }
    });
    child.stdin.end(JSON.stringify(label));
  });
}
function resolvePath(path) { return resolve(root,path); }

export class PrinterService {
  constructor({transport=new BluetoothTransport(),render=renderLabel,jobDir=resolvePath('.local/print-jobs'),logger=diagnostics}={}) {
    this.logger=logger;this.transport=transport; this.render=render; this.jobDir=jobDir;
    this.busy=false; this.info={}; this.lastCheck=0; this.inflight=new Map(); this.pageKey=randomInt(1,65000);
  }
  snapshot() { return {connected:this.transport.connected,busy:this.busy,name:'德佟 P0',detail:this.transport.connected?stateText(this.info.printable):'未连接',...this.info}; }
  async exclusive(fn) {
    if(this.busy) throw fail(409,'打印机正在处理任务，请稍后再操作。');
    this.busy=true; try{return await fn()}finally{this.busy=false}
  }
  async refresh() {
    const packet=await this.transport.query(112), data=packet.Data;
    this.info.printable=data[0]; this.lastCheck=Date.now();
    return data;
  }
  async ensureConnected() {
    await this.transport.connect();
    const dpi=await this.transport.query(113), width=await this.transport.query(114);
    this.info.dpi=dpi.popShort();
    this.info.width=width.Data.length>=5?width.Data[0]*256+width.Data[1]:width.popShort();
    await this.refresh();
    if(this.info.dpi!==203||this.info.width!==96) throw fail(409,'设备打印尺寸与已验证的 P0 不一致，已停止打印。');
  }
  async connect() { await this.exclusive(()=>this.ensureConnected()); return this.snapshot(); }
  async disconnect() { await this.exclusive(()=>this.transport.disconnect()); return this.snapshot(); }
  async status() {
    if(this.transport.connected&&!this.busy&&Date.now()-this.lastCheck>5000) {
      try {await this.exclusive(()=>this.refresh())}catch {return {...this.snapshot(),detail:'设备状态读取失败，请重连。'}}
    }
    return this.snapshot();
  }
  async print(body) {
    const label=validateLabel(body), fingerprint=createHash('sha256').update(JSON.stringify(label)).digest('hex'), id=body.requestId;
    this.logger.record('printer.start',{request:id});
    const existing=this.inflight.get(id);
    if(existing) {if(existing.fingerprint!==fingerprint)throw fail(409,'同一打印任务的内容不能改变。');return {...await existing.promise,device:this.snapshot()};}
    const promise=this.exclusive(()=>this.doPrint(id,fingerprint,label));
    this.inflight.set(id,{fingerprint,promise});
    try{return {...await promise,device:this.snapshot()}}finally{this.inflight.delete(id)}
  }
  async doPrint(id,fingerprint,label) {
    await mkdir(this.jobDir,{recursive:true,mode:0o700});
    const file=resolve(this.jobDir,id+'.json');
    const old=await readFile(file,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e});
    if(old) {
      if(old.fingerprint!==fingerprint)throw fail(409,'同一打印任务的内容不能改变。');
      this.logger.record('printer.stage',{request:id,stage:'duplicate'});
      if(['printed','sent'].includes(old.state))return {...old.result,duplicate:true,device:this.snapshot()};
      throw fail(409,'此任务已处理或结果不明，请先检查出纸，避免重复打印。');
    }
    let sending=false;
    try {
      this.logger.record('printer.stage',{request:id,stage:'render'});
      const image=await this.render(label);
      if(!this.transport.connected)await this.ensureConnected();
      if(this.info.dpi!==203||this.info.width!==96)throw fail(409,'设备打印尺寸与已验证的 P0 不一致，已停止打印。');
      const before=await this.refresh();
      if(before[0]!==0)throw fail(409,`打印机${stateText(before[0])}，请处理后再打印。`);
      const buffer=await this.transport.query(119);
      const units=buffer.popEBV(), free=500*(units===1?2:units);
      const pageKey=this.pageKey=this.pageKey%65534+1;
      const chunks=sdk.PrintPackage.encodeImageData({imageData:{width:image.width??240,height:image.height??96,data:new Uint8ClampedArray(image.rgba)},orientation:90,gapType:2,gapLength:3,printDarkness:255,printSpeed:255,pageKey,enableSuperBitmap:false},{printerDPI:203,printerWidth:96,hardwareFlags:0,softwareFlags:0});
      const bytes=Buffer.concat(chunks.map(c=>Buffer.from(c)));
      if(!bytes.length||bytes.length>free)throw fail(409,'打印机缓存不足，请稍后重试。');
      // Persist BEFORE writing to hardware. A repeated request cannot cause another label, even after restart.
      await writeFile(file,JSON.stringify({fingerprint,state:'sending',pageKey}),{flag:'wx',mode:0o600});
      await writeFile(resolve(this.jobDir,'last-label.png'),image.png,{mode:0o600});
      sending=true;this.logger.record('printer.stage',{request:id,stage:'sending',bytes:bytes.length});
      await this.transport.write(bytes);
      let state='sent', sawMotor=false;
      for(let i=0;i<25;i++) {
        await delay(400);
        const data=await this.refresh(), code=data[0];
        if(code>2)throw fail(502,`打印机${stateText(code)}。请先检查是否已出纸，避免重复打印。`);
        if(code===1||code===2)sawMotor=true;
        const matches=data.length>=6&&data[1]===data[2]&&(data[3]*256+data[4]===pageKey||data[4]*256+data[3]===pageKey);
        if(code===0&&(matches||sawMotor)){state='printed';break;}
        if(code===0&&i>=3)break;
      }
      const result={requestId:id,state,copies:1,device:this.snapshot(),message:state==='printed'?'已打印 1 张':'已发送 1 张，请查看出纸。'};
      await writeFile(file,JSON.stringify({fingerprint,state,result}),{mode:0o600});
      this.logger.record('printer.end',{request:id,stage:state},state==='printed'?'info':'warning');
      return result;
    } catch(error) {
      this.logger.record('printer.error',{request:id,stage:sending?'unknown_result':'render',status:error.status||500},'error');
      if(sending) {
        await writeFile(file,JSON.stringify({fingerprint,state:'unknown'}),{mode:0o600}).catch(()=>{});
        if(error.status!==502)throw fail(502,'打印结果未确认，请先检查是否已出纸，避免重复打印。');
      }
      throw error;
    }
  }
  close() {this.transport.close();}
}
