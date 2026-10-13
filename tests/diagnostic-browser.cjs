const {chromium}=require('playwright');
if(!process.argv[2])throw Error('传入 tests/acceptance.mjs 本次临时目录中的 diagnostics/events.jsonl 路径');
const fs=require('node:fs/promises'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const p=await b.newPage({viewport:{width:390,height:844}});const request=crypto.randomUUID().toUpperCase(),errors=[];p.on('pageerror',e=>errors.push(e.name));
  await p.route('https://api.mymemory.translated.net/**',r=>r.fulfill({json:{responseStatus:200,responseData:{translatedText:'good morning'}}}));
  await p.goto('http://127.0.0.1:10292/');await p.waitForFunction(()=>!!window.P0Diagnostics);await p.locator('#chatTab').click();
  await p.locator('#chatInput').fill('诊断链路测试');await p.locator('#sendChat').click();await p.waitForFunction(()=>document.getElementById('sendChat').getAttribute('aria-label')==='发送');assert.match(await p.locator('.message.assistant').last().textContent(),/诊断链路测试/);
  await p.evaluate(request=>{
   P0Diagnostics.record('web.error',{request,source:'assistant.js',line:123,column:4,error_type:'TypeError',apiKey:'DO-NOT-STORE-fixture',message:'DO-NOT-STORE-fixture',stack:'DO-NOT-STORE-fixture',url:'https://DO-NOT-STORE-fixture'},'error');
   dispatchEvent(new ErrorEvent('error',{error:new TypeError('DO-NOT-STORE-fixture'),filename:'http://127.0.0.1/assistant.js?key=DO-NOT-STORE-fixture',lineno:456,colno:7}));
   dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:Promise.resolve(),reason:new Error('DO-NOT-STORE-fixture')}));
  },request);
  let rows=[];
  for(let i=0;i<30;i++){const data=await fs.readFile(process.argv[2],'utf8');assert.ok(!data.includes('DO-NOT-STORE-fixture'));rows=data.trim().split('\n').map(JSON.parse);if(rows.some(r=>r.fields.request===request))break;await new Promise(r=>setTimeout(r,100))}
  const row=rows.find(r=>r.fields.request===request);assert.ok(row);assert.equal(row.fields.line,123);assert.equal(row.fields.source,'assistant.js');assert.ok(!row.fields.message);
  assert.ok(rows.some(r=>r.event==='web.error'&&r.fields.line===456));assert.ok(rows.some(r=>r.event==='web.rejection'));
  const last=rows.filter(r=>r.event==='model.complete'&&r.fields.request).at(-1);assert.ok(last);assert.ok(rows.some(r=>r.event==='model.first_text'&&r.fields.request===last.fields.request));
  assert.deepEqual(errors,[]);console.log('PASS real browser: chat works, native-safe metadata schema, JS errors/rejections persist, no sensitive fields, request correlation');
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
