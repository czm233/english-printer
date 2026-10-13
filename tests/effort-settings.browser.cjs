// Only run against the isolated fixture. Never saves real model credentials or prints.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true}),errors=[];let prints=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/printer/print',r=>{prints++;return r.fulfill({status:409,json:{error:'Test blocks all printing'}})});
 await page.goto('http://127.0.0.1:10292/');await page.evaluate(()=>fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'http://127.0.0.1:10291',model:'test-model',apiKey:'test-only-placeholder',effort:'low'})}));await page.reload();await page.waitForFunction(()=>!!document.querySelector('#modelName').value);
 await page.locator('#settingsTab').click();await page.locator('#modelSettingsTab').click();
 assert(await page.locator('#effortField').isHidden());
 await page.locator('#modelName').fill('glm-5.3-flash');assert(await page.locator('#modelEffort').isVisible());
 assert.equal(await page.locator('#modelEffort input:checked').inputValue(),'low');
 const boxes=await page.locator('.effort-options label').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return [r.y,r.width]}));assert(boxes.every(b=>Math.abs(b[0]-boxes[0][0])<1&&Math.abs(b[1]-boxes[0][1])<1));
 await page.getByRole('radio',{name:'low',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#modelEffort input:checked').inputValue(),'high');assert.equal(await page.locator('#modelEffort input:checked').count(),1);
 async function save(value){
  await page.getByRole('radio',{name:value,exact:true}).check();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/config')&&r.request().method()==='POST');
  await page.locator('#saveConfig').click();const data=await(await response).json();
  assert.equal(data.effort,value);assert.equal(data.keyConfigured,true);assert.equal(data.apiKey,undefined);
  await page.waitForFunction(()=>!document.querySelector('#saveConfig').disabled);
  assert.equal(await page.locator('#apiKey').inputValue(),'');
 }
 for(const effort of ['high','max','low']){
  await save(effort);await page.reload();await page.waitForFunction(()=>document.querySelector('#modelName').value==='glm-5.3-flash');
  await page.locator('#settingsTab').click();await page.locator('#modelSettingsTab').click();assert.equal(await page.locator('#modelEffort input:checked').inputValue(),effort);
 }
 // An in-flight save locks fields; failure preserves the selection and unsaved input.
 let failNext=true;await page.route('**/api/config',async r=>{
  if(r.request().method()==='POST'&&failNext){failNext=false;await new Promise(resolve=>setTimeout(resolve,400));return r.fulfill({status:500,json:{error:'模拟保存失败'}})}
  return r.continue();
 });
 await page.getByRole('radio',{name:'max',exact:true}).check();await page.locator('#apiKey').fill('test-only-unsaved-placeholder');
 await page.locator('#saveConfig').click();assert(await page.locator('#modelEffort input').first().isDisabled());assert(await page.locator('#apiKey').isDisabled());
 await page.waitForFunction(()=>!document.querySelector('#configError').hidden);
 assert.equal(await page.locator('#modelEffort input:checked').inputValue(),'max');assert.equal(await page.locator('#apiKey').inputValue(),'test-only-unsaved-placeholder');
 await page.locator('#apiKey').fill('');await save('low');
 // Simulated keyboard viewport: internal scroll keeps the selector and save reachable.
 for(const height of [844,664,360]){
  await page.setViewportSize({width:390,height});
  await page.locator('#modelEffort').scrollIntoViewIfNeeded();await page.locator('#modelEffort input:checked').focus();
  assert.equal(await page.locator('#modelEffort input:checked').evaluate(e=>e===document.activeElement),true);
  await page.getByRole('radio',{name:'high',exact:true}).check();await page.locator('#saveConfig').scrollIntoViewIfNeeded();
  assert(await page.locator('#saveConfig').isVisible());
  const box=await page.locator('#saveConfig').boundingBox();assert(box.y>=0&&box.y+box.height<=height);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(height!==360){await page.screenshot({path:`work/effort-settings-${height}.png`});}
 }
 await page.setViewportSize({width:390,height:664});await save('low');
 for(const height of [844,664]){
  await page.setViewportSize({width:390,height});
  for(const group of ['labelSettingsTab','modelSettingsTab']){
   await page.locator('#'+group).click();
   const styles=await page.locator('.settings-switch button').evaluateAll(es=>es.map(e=>[getComputedStyle(e).fontSize,getComputedStyle(e).fontWeight,getComputedStyle(e).lineHeight]));
   assert.deepEqual(styles,[['20px','500','26px'],['20px','500','26px']]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  const controls=await page.locator('.config-field input:not([type=radio])').evaluateAll(es=>es.map(e=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight]}));
  assert(controls.every(s=>JSON.stringify(s)===JSON.stringify(controls[0])));
  assert.equal(await page.locator('#modelEffort').evaluate(e=>getComputedStyle(e).userSelect),'none');
  for(const event of ['contextmenu','selectstart','dragstart'])assert.equal(await page.locator('#modelEffort').evaluate((e,event)=>e.dispatchEvent(new Event(event,{bubbles:true,cancelable:true})),event),false);
  assert.equal(await page.locator('#modelName').evaluate(e=>getComputedStyle(e).userSelect),'text');
  const tabs=await page.locator('#printTab,#settingsTab').evaluateAll(es=>es.map(e=>{const s=getComputedStyle(e),i=getComputedStyle(e.querySelector('.icon'));return [s.fontSize,s.fontWeight,s.lineHeight,i.width,i.height]}));assert.deepEqual(tabs[0],tabs[1]);
  await page.locator('#printTab').click();await page.locator('#clear').click();assert(await page.locator('#printAgain').isDisabled());
  await page.locator('#chatTab').click();await page.locator('#chatInput').fill('输入复制测试');assert.equal(await page.locator('#chatInput').evaluate(e=>getComputedStyle(e).userSelect),'text');await page.locator('#chatInput').fill('');
  await page.locator('#chatBack').click();await page.locator('#settingsTab').click();await page.locator('#modelSettingsTab').click();
 }
 // Model requests lock config controls until the streaming response completes.
 await page.locator('#chatTab').click();await page.locator('#chatInput').fill('等待首字测试');await page.locator('#sendChat').click();
 await page.waitForFunction(()=>document.querySelector('#newChat').disabled);
 await page.locator('#chatBack').click();assert(await page.locator('#modelEffort input').first().isDisabled());assert(await page.locator('#saveConfig').isDisabled());
 await page.waitForFunction(()=>!document.querySelector('#newChat').disabled);
 assert(await page.locator('#modelEffort input').first().isEnabled());assert.equal(prints,0);assert.deepEqual(errors,[]);
 console.log('PASS effort: low default, high/max/low persistence, secret-free API, failed-save input retention, loading locks, two viewport styles, short keyboard viewport, touch/copy/focus, no printing');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
