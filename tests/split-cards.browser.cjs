// Run against tests/acceptance.mjs; all printing is simulated.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
 let calls=[],mode='printed';const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/printer/print',async route=>{calls.push(route.request().postDataJSON());await new Promise(r=>setTimeout(r,200));await route.fulfill(mode==='error'?{status:409,json:{error:'打印机缺纸'}}:{json:{state:mode,device:{connected:true,busy:false,detail:'可打印'},message:'已打印'}})});
 await page.goto('http://127.0.0.1:10292/');await page.waitForFunction(()=>!document.getElementById('chatHistory').disabled);await page.locator('#chatTab').click();
 const compoundPlan=await page.evaluate(async()=>{
  const word='flip-top water bottle',ipa=await phonetics(word);
  const plan=await P0PrintCards.plan({word,ipa});
  return {plan,errors:plan.map(p=>validate(p.word,p.ipa))};
 });
 assert.deepEqual(compoundPlan.plan.map(p=>p.word),['flip-top','water bottle']);
 assert.deepEqual(compoundPlan.errors,['','']);
 assert.ok(compoundPlan.plan.every(p=>!p.ipa.includes(';')));
 async function card(){
  await page.locator('#newChat').click();await page.locator('#chatInput').fill('主机卡片测试');await page.locator('#sendChat').click();
  await page.waitForFunction(()=>!document.getElementById('newChat').disabled&&document.querySelector('[data-confirm-print]')?.textContent.startsWith('拆分打印(0/'));
  await page.evaluate(()=>{window.testCard=document.querySelector('[data-confirm-print]').dataset.confirmPrint});
  return page.locator('[data-confirm-print]');
 }
 let button=await card();const label=await button.textContent();const total=Number(label.match(/\/(\d+)/)[1]);assert.ok(total>1);assert.equal(await page.locator('[data-split-card]').count(),0);assert.equal(await page.locator('.card-status').last().textContent(),'');
 for(const height of [844,664]){await page.setViewportSize({width:390,height});await button.scrollIntoViewIfNeeded();await page.screenshot({path:`work/ai-batch-${height}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(await button.evaluate(b=>{const s=getComputedStyle(b);return [s.fontSize,s.fontWeight,s.userSelect]}),['20px','500','none']);}
 await button.evaluate(b=>b.click());assert.equal(calls.length,0);
 await button.dblclick();await page.waitForFunction(()=>document.querySelector('[data-confirm-print]').textContent.includes('(1/'));
 await page.waitForFunction(()=>document.querySelector('.card-status').textContent.startsWith('已打印'));
 assert.equal(calls.length,total);assert.equal(new Set(calls.map(c=>c.requestId)).size,total);assert.equal(await page.locator('[data-print-card]').count(),1);assert.equal(await button.textContent(),`拆分打印(${total}/${total})`);assert.ok(await button.isDisabled());
 await page.evaluate(()=>{const snapshot=P0PrintCards.snapshot();P0PrintCards.restore(snapshot);document.getElementById('messages').replaceChildren();P0PrintCards.render(testCard,document.getElementById('messages'))});assert.ok(await page.locator('[data-confirm-print]').isDisabled());assert.equal(await page.locator('[data-confirm-print]').textContent(),`拆分打印(${total}/${total})`);
 await page.reload();await page.waitForFunction(()=>!document.getElementById('chatHistory').disabled);await page.locator('#chatTab').click();
 for(const state of ['sent','error']){mode=state;calls=[];button=await card();await button.click();await page.waitForFunction(()=>[...document.querySelectorAll('.card-status')].at(-1).textContent.includes('已停止'));assert.equal(calls.length,1);assert.ok(await button.isDisabled());}
 calls=[];button=await card();await page.evaluate(()=>{window.originalPersist=P0History.persist;P0History.persist=async()=>{throw Error('保存失败')}});await button.click();await page.waitForFunction(()=>[...document.querySelectorAll('.card-status')].at(-1).textContent.includes('保存失败'));assert.equal(calls.length,0);assert.ok(await button.isDisabled());await page.evaluate(()=>P0History.persist=originalPersist);
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS AI batch: count/progress, sequential UUIDs, trusted clicks, hidden parts, history locks, sent/error/save-failure stops, two viewports');
})().catch(e=>{console.error(e);process.exit(1)});
