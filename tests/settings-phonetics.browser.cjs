// Uses only the isolated fixture; every device/translation request is intercepted.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true}),errors=[],prints=[];
  page.on('pageerror',error=>errors.push(error.message));
  let releaseTranslation,markTranslationStarted;const translationStarted=new Promise(resolve=>markTranslationStarted=resolve);
  await page.route('**/api/translate',route=>{
   if(route.request().postDataJSON().q==='过期翻译测试')return new Promise(resolve=>{releaseTranslation=()=>resolve(route.fulfill({json:{text:'fridge'}}));markTranslationStarted()});
   return route.fulfill({json:{text:route.request().postDataJSON().direction==='en-zh'?'测试中文':'fridge'}});
  });
  await page.route('**/api/printer/**',route=>{
   const device={connected:true,busy:false,detail:'测试设备'};
   if(route.request().url().endsWith('/print')){prints.push(route.request().postDataJSON());return route.fulfill({json:{state:'printed',message:'已打印 1 张',device}})}
   return route.fulfill({json:device});
  });
  await page.goto('http://127.0.0.1:10292/');
  await page.locator('#chinese').fill('冰箱');
  await page.waitForSelector('input[name=translation]');await page.locator('input[name=translation]').first().check();
  assert.equal(await page.locator('#word').inputValue(),'fridge');
  await page.locator('#settingsTab').click();
  await page.evaluate(()=>{window.realSettingsPhonetics=phonetics;window.labelLookups=[];phonetics=word=>new Promise((resolve,reject)=>labelLookups.push({word,resolve,reject}))});
  const settle=(index,ipa)=>page.evaluate(({index,ipa})=>labelLookups[index].resolve(ipa),{index,ipa});
  const state=()=>page.evaluate(()=>({word:$('word').value,sample:$('sampleWord').value,ipa:$('ipa').value,sampleIpa:$('sampleIpa').value,disabled:$('printAgain').disabled,loading:translating}));
  await page.locator('#sampleWord').fill('cat');
  assert.deepEqual(await state(),{word:'cat',sample:'cat',ipa:'',sampleIpa:'',disabled:true,loading:true});
  assert(await page.locator('#sampleWord').isEnabled());
  await page.locator('#sampleWord').fill('dog');await settle(1,'/dɔɡ/');
  await page.waitForFunction(()=>!translating);await settle(0,'/kæt/');
  assert.deepEqual(await state(),{word:'dog',sample:'dog',ipa:'/dɔɡ/',sampleIpa:'/dɔɡ/',disabled:false,loading:false});
  await page.locator('#printTab').click();await page.locator('#printAgain').click();
  assert.equal(prints.length,1);assert.equal(prints[0].word,'dog');assert.equal(prints[0].ipa,'/dɔɡ/');
  await page.locator('#settingsTab').click();

  // A deliberate edit belongs to the current word and cannot be overwritten by
  // the older automatic lookup. Merely blurring an untouched empty IPA field
  // must not cancel the lookup either.
  await page.locator('#sampleWord').fill('cat');
  await page.locator('#sampleIpa').focus();await page.locator('#width').focus();
  await settle(2,'/kæt/');await page.waitForFunction(()=>!translating);
  assert.equal(await page.locator('#sampleIpa').inputValue(),'/kæt/');
  await page.locator('#sampleWord').fill('cat');
  await page.locator('#sampleIpa').fill('kɑt');await page.locator('#width').focus();
  await settle(3,'/kæt/');assert.equal(await page.locator('#sampleIpa').inputValue(),'/kɑt/');
  assert.equal(await page.locator('#ipa').inputValue(),'/kɑt/');assert(await page.locator('#printAgain').isEnabled());
  await page.locator('#printTab').click();await page.locator('#printAgain').click();
  assert.equal(prints.at(-1).ipa,'/kɑt/');assert.equal(prints.at(-1).word,'cat');
  await page.locator('#settingsTab').click();
  await page.locator('#sampleWord').fill('dog');await page.locator('#sampleWord').fill('');
  await settle(4,'/dɔɡ/');assert.deepEqual(await state(),{word:'',sample:'',ipa:'',sampleIpa:'',disabled:true,loading:false});
  await page.locator('#sampleWord').fill('cat');await page.evaluate(()=>labelLookups[5].reject(Error('fixture dictionary failure')));
  await page.waitForFunction(()=>!translating);assert(await page.locator('#printAgain').isDisabled());assert.equal(await page.locator('#ipa').inputValue(),'');
  assert.match(await page.locator('#status').textContent(),/词典加载失败/);
  await page.evaluate(()=>phonetics=realSettingsPhonetics);
  for(const word of ['zzzznotaword','cat zzzznotaword']){
   await page.locator('#sampleWord').fill(word);await page.waitForFunction(()=>!translating);
   assert.equal(await page.locator('#ipa').inputValue(),'');assert.equal(await page.locator('#sampleIpa').inputValue(),'');assert(await page.locator('#printAgain').isDisabled());
  }

  // Direction changes and normal translation also invalidate settings lookups.
  await page.evaluate(()=>phonetics=word=>new Promise(resolve=>labelLookups.push({word,resolve})));
  await page.locator('#sampleWord').fill('cat');await page.evaluate(()=>phonetics=realSettingsPhonetics);
  await page.locator('#printTab').click();await page.locator('#swapLanguages').click();await page.locator('#chinese').fill('dog');
  await page.waitForFunction(()=>!translating&&$('word').value==='dog'&&!!$('ipa').value);
  const dogIpa=await page.locator('#ipa').inputValue();await settle(6,'/kæt/');
  assert.equal(await page.locator('#ipa').inputValue(),dogIpa);assert.equal(await page.locator('#sourceIpa').textContent(),dogIpa);
  await page.locator('#settingsTab').click();await page.locator('#sampleWord').fill('cat');await page.waitForFunction(()=>!translating);
  assert.equal(await page.locator('#chinese').inputValue(),'cat');assert.equal(await page.locator('#sourceIpa').textContent(),'/kæt/');
  await page.locator('#sampleWord').fill('');assert.equal(await page.locator('#chinese').inputValue(),'');assert.equal(await page.locator('#sourceIpa').textContent(),'');assert.equal(await page.locator('#meaning').textContent(),'');
  await page.locator('#printTab').click();await page.locator('#swapLanguages').click();await page.locator('#chinese').fill('冰箱');
  await page.waitForSelector('input[name=translation]');await page.locator('input[name=translation]').first().check();
  assert.equal(await page.locator('#sampleWord').inputValue(),'fridge');assert.equal(await page.locator('#sampleIpa').inputValue(),await page.locator('#ipa').inputValue());
  await page.locator('#chinese').fill('过期翻译测试');await translationStarted;
  await page.locator('#settingsTab').click();await page.locator('#sampleWord').fill('dog');await page.waitForFunction(()=>!translating);
  const translated=page.waitForResponse(response=>response.url().endsWith('/api/translate')&&response.request().postDataJSON().q==='过期翻译测试');
  releaseTranslation();await translated;await page.waitForTimeout(100);
  assert.equal(await page.locator('#word').inputValue(),'dog');assert.equal(await page.locator('#sampleWord').inputValue(),'dog');assert.equal(await page.locator('#ipa').inputValue(),dogIpa);
  await page.locator('#printTab').click();

  for(const height of [844,664]){
   await page.setViewportSize({width:390,height});
   await checkLayout();await page.locator('#settingsTab').click();
   await page.locator('#sampleWord').fill('zzzznotaword');await page.waitForFunction(()=>!translating);await checkLayout();await page.screenshot({path:`work/settings-phonetics-error-${height}.png`});
   await page.locator('#settingsError').scrollIntoViewIfNeeded();
   assert(await page.locator('#settingsError').evaluate(e=>{const r=e.getBoundingClientRect(),p=e.closest('.settings-pane').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom}));
   await page.screenshot({path:`work/settings-phonetics-scrolled-${height}.png`});
   await page.locator('#sampleWord').fill('');await checkLayout();
   await page.evaluate(()=>phonetics=word=>new Promise(resolve=>labelLookups.push({word,resolve})));
   await page.locator('#sampleWord').fill('cat');await checkLayout();
   await page.evaluate(()=>{labelLookups.at(-1).resolve('/kæt/');phonetics=realSettingsPhonetics});await page.waitForFunction(()=>!translating);await checkLayout();
   await page.locator('#sampleWord').focus();assert(await page.locator('#sampleWord').evaluate(e=>e===document.activeElement));
   for(const event of ['contextmenu','selectstart','dragstart'])assert.equal(await page.locator('#sampleWord').evaluate((e,event)=>e.dispatchEvent(new Event(event,{bubbles:true,cancelable:true})),event),true);
   for(const event of ['contextmenu','selectstart','dragstart'])assert.equal(await page.locator('#connect').evaluate((e,event)=>e.dispatchEvent(new Event(event,{bubbles:true,cancelable:true})),event),false);
   await page.evaluate(()=>{window.P0Viewport={height:360,keyboard:true};window.dispatchEvent(new Event('native-viewport'))});
   await page.locator('#sampleIpa').focus();await page.locator('#sampleIpa').scrollIntoViewIfNeeded();
   assert(await page.locator('.tabs').isHidden());assert(await page.locator('#sampleIpa').evaluate(e=>{const r=e.getBoundingClientRect();return e===document.activeElement&&r.y>=0&&r.bottom<=360}));
   await page.evaluate(()=>{delete window.P0Viewport;window.dispatchEvent(new Event('native-viewport'))});
   assert(await page.locator('.tabs').isVisible());
   await page.locator('#modelSettingsTab').click();await checkLayout();
   await page.locator('#chatTab').click();await checkLayout();
   await page.locator('#chatInput').fill('复制测试');assert.equal(await page.locator('#chatInput').evaluate(e=>getComputedStyle(e).userSelect),'text');await page.locator('#chatInput').fill('');
   await page.locator('#chatBack').click();await page.locator('#labelSettingsTab').click();await page.locator('#printTab').click();
  }
  async function checkLayout(){
   const result=await page.evaluate(()=>{
    const visible=e=>e.getClientRects().length,style=e=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight]};
    const buttons=[...document.querySelectorAll('button')].filter(e=>visible(e)&&!e.closest('.tabs'));
    const tabs=[...document.querySelectorAll('#printTab,#settingsTab')].map(e=>{const s=getComputedStyle(e),i=getComputedStyle(e.querySelector('.icon'));return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight,i.width,i.height]});
    return {overflow:document.documentElement.scrollWidth>innerWidth,buttons:buttons.map(style),tabs,body:[...document.querySelectorAll('#sampleWord,#sampleIpa,#word,#ipa,#chinese,#chatInput,#apiUrl,#modelName')].filter(visible).map(style),titles:[...document.querySelectorAll('#sourceTitle,#resultTitle,.chat-heading .section-title')].filter(visible).map(style),notes:[...document.querySelectorAll('#settingsError,#status,#configError,#chatError')].filter(visible).map(style)};
   });
   assert.equal(result.overflow,false);assert.deepEqual(result.tabs[0],result.tabs[1]);assert.equal(result.tabs[0][1],'14px');assert.equal(result.tabs[0][4],'26px');
   for(const s of result.buttons)assert.deepEqual(s.slice(1),['20px','500','26px']);
   for(const s of result.body)assert.deepEqual(s.slice(1),['16px','400','24px']);
   for(const s of result.titles)assert.deepEqual(s.slice(1),['20px','600','26px']);
   for(const s of result.notes)assert.deepEqual(s.slice(1),['13px','400','19.5px']);
  }
  assert.deepEqual(errors,[]);assert.equal(prints.length,2);
  console.log('PASS: settings word/IPA invalidation, delayed stale lookups, manual IPA, failure, unknown/partial words, clear, direction changes, simulated print payloads, two viewport styles and touch editing');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
