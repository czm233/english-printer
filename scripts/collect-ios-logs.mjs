// Copy only the diagnostics directory, never the whole app container or Keychain.
import {execFileSync} from 'node:child_process';
import {mkdir,readdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const device=process.argv[2];
const signing=await readFile(resolve(root,'ios/Signing.local.xcconfig'),'utf8').catch(()=> '');
const bundle=process.env.IOS_BUNDLE_ID||signing.match(/^PRODUCT_BUNDLE_IDENTIFIER\s*=\s*(\S+)/m)?.[1]||'com.example.englishprinter';
if(!device){console.error('用法：node scripts/collect-ios-logs.mjs <已配对的设备 ID>');process.exit(1)}
const destination=resolve(root,'.local/diagnostics/ios',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(destination,{recursive:true,mode:0o700});
try{
 execFileSync('xcrun',['devicectl','device','copy','from','--device',device,'--domain-type','appDataContainer','--domain-identifier',bundle,'--source','Library/Application Support/Diagnostics','--destination',destination,'--timeout','30'],{stdio:'pipe',timeout:35000});
 const rows=[];let incomplete=0;
 async function scan(dir){for(const name of await readdir(dir,{withFileTypes:true})){const file=resolve(dir,name.name);if(name.isDirectory())await scan(file);else if(/^events(?:\.\d+)?\.jsonl$/.test(name.name)){await chmod(file,0o600);for(const line of (await readFile(file,'utf8')).split('\n').filter(Boolean))try{rows.push(JSON.parse(line))}catch{incomplete++}}}}
 await scan(destination);
 rows.sort((a,b)=>String(a.time).localeCompare(String(b.time))||a.uptime_ms-b.uptime_ms);
 const counts={};for(const row of rows)counts[row.event]=(counts[row.event]||0)+1;
 const summary={events:rows.length,incompleteLines:incomplete,sessions:[...new Set(rows.map(r=>r.session))],modes:[...new Set(rows.map(r=>r.mode))],builds:[...new Set(rows.map(r=>r.build))],first:rows[0]?.time,last:rows.at(-1)?.time,counts};
 await writeFile(resolve(destination,'summary.json'),JSON.stringify(summary,null,2),{mode:0o600});
 console.log('日志已保存：'+destination);console.log(JSON.stringify(summary,null,2));
 if(!rows.length){console.error('尚无日志：请启动已包含诊断功能的新版 App，再执行采集。');process.exitCode=2}
}catch{console.error('采集失败。请确认手机已解锁、信任本机并开启开发者模式，新版 App 已启动过。未复制其他应用数据。');process.exitCode=1}
