const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let calls=[],mode='printed';
 await page.route('**/api/translate',r=>r.fulfill({json:{text:'You blush like a teapot'}}));
 await page.route('**/api/printer/print',async r=>{
  const body=r.request().postDataJSON();calls.push(body);await new Promise(resolve=>setTimeout(resolve,150));
  if(mode==='error'&&calls.length===2)return r.fulfill({status:409,json:{error:'打印机缺纸'}});
  await r.fulfill({json:{state:mode==='sent'?'sent':'printed',message:'已打印 1 张',device:{connected:true,busy:false,detail:'可打印'}}});
 });
 await page.goto('http://127.0.0.1:10292/');
 await page.locator('#chinese').fill('你脸红得像茶壶');
 await page.waitForFunction(()=>document.querySelector('#printAgain').textContent.startsWith('拆分打印(0/'));
 assert.equal(await page.locator('.translation-option').count(),1);
 assert.equal(await page.locator('.option-part').count(),0);
 assert.equal(await page.locator('.translation-option button').count(),0);
 const plan=await page.evaluate(()=>P0PrintCards.plan({word:document.querySelector('#word').value,ipa:document.querySelector('#ipa').value}));assert.ok(plan.length>1);
 await page.locator('#printAgain').dblclick();
 await page.waitForFunction(()=>/^已打印 \d+ 张$/.test(document.querySelector('#status').textContent));
 assert.equal(await page.locator('#printAgain').textContent(),`拆分打印(${plan.length}/${plan.length})`);assert.equal(calls.length,plan.length);assert.equal(new Set(calls.map(x=>x.requestId)).size,plan.length);
 assert.equal(calls.map(x=>x.word).join(' '),'You blush like a teapot');assert.ok(calls.every(x=>!x.ipa.includes(';')));
 calls=[];mode='sent';await page.locator('#printAgain').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已停止'));assert.equal(calls.length,1);
 calls=[];mode='error';await page.locator('#printAgain').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('缺纸'));assert.equal(calls.length,2);
 await page.locator('#printAgain').evaluate(b=>b.click());assert.equal(calls.length,2);
 for(const height of [844,664]){
  await page.setViewportSize({width:390,height});
  for(const id of ['printTab','chatTab','settingsTab']){
   if(id==='settingsTab')await page.locator('#chatBack').click();
   await page.locator('#'+id).click();
   if(id==='settingsTab')for(const group of ['labelSettingsTab','modelSettingsTab']){await page.locator('#'+group).click();await check()}
   else await check();
  }
  await page.locator('#printTab').click();await page.locator('#printAgain').scrollIntoViewIfNeeded();await page.screenshot({path:`work/batch-print-${height}.png`});
 }
 async function check(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const failures=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length&&!b.closest('.tabs')&&!b.querySelector('.icon')&&!b.classList.contains('icon-button')).filter(b=>{const s=getComputedStyle(b);return s.fontSize!=='20px'||s.fontWeight!=='500'}).map(b=>b.id));assert.deepEqual(failures,[]);}
 await page.locator('#swapLanguages').click();
 await page.locator('#chinese').fill('Super unbeatable refrigerator');
 await page.waitForFunction(()=>document.querySelector('#printAgain').textContent.startsWith('拆分打印(0/'));
 assert.equal(await page.locator('#status').textContent(),'');
 const reversePlan=await page.evaluate(()=>P0PrintCards.plan({word:document.querySelector('#word').value,ipa:document.querySelector('#ipa').value}));
 assert.equal(await page.locator('#printAgain').textContent(),`拆分打印(0/${reversePlan.length})`);
 for(const height of [844,664]){await page.setViewportSize({width:390,height});await page.locator('#printAgain').scrollIntoViewIfNeeded();await page.screenshot({path:`work/batch-count-${height}.png`});}
 await page.locator('#chinese').fill('hello');await page.waitForFunction(()=>document.querySelector('#printAgain').textContent==='打印'&&!document.querySelector('#printAgain').disabled);
 await page.locator('#swapLanguages').click();
 await page.locator('#chinese').fill('');assert.equal(await page.locator('#printAgain').isDisabled(),true);
 assert.equal(await page.locator('#clear').evaluate(e=>getComputedStyle(e).userSelect),'none');
 await page.locator('#chinese').fill('冰箱');await page.waitForFunction(()=>document.querySelectorAll('.translation-option').length===2);assert.equal(await page.locator('#printAgain').isDisabled(),true);await page.locator('input[name=translation]').first().check();assert.equal(await page.locator('#printAgain').textContent(),'打印');
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS: sequential batch, UUIDs, duplicate click, untrusted click, sent/error stops, options, two viewports and all page button styles');
})().catch(e=>{console.error(e);process.exit(1)});
