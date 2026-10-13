const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/api/translate',r=>r.fulfill({json:{text:'good morning'}}));
 await page.goto('http://127.0.0.1:10290/');
 for(const height of [844,664]){
  await page.setViewportSize({width:390,height});const field=page.locator('#chinese');await field.fill('早上好');await field.press('Enter');
  assert.equal(await field.inputValue(),'早上好');assert.equal(await field.evaluate(e=>e===document.activeElement),false);
  await field.focus();assert.equal(await field.evaluate(e=>e.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertLineBreak'}))),false);assert.equal(await field.evaluate(e=>e===document.activeElement),false);
  await field.focus();await field.dispatchEvent('compositionstart');await field.dispatchEvent('keydown',{key:'Enter',keyCode:229,isComposing:true});assert.equal(await field.evaluate(e=>e===document.activeElement),true);await field.dispatchEvent('compositionend');await field.press('Enter');assert.equal(await field.evaluate(e=>e===document.activeElement),false);
  await page.locator('#swapLanguages').click();await field.fill('hello');await field.press('Enter');assert.equal(await field.inputValue(),'hello');assert.equal(await field.evaluate(e=>e===document.activeElement),false);await page.locator('#swapLanguages').click();
  for(const id of ['settingsTab','chatTab','printTab']){if(id==='printTab')await page.locator('#chatBack').click();await page.locator('#'+id).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 }
 await browser.close();console.log('PASS: Enter/beforeinput blur, no newline, IME confirmation preserved, both languages and viewport sizes');
})().catch(e=>{console.error(e);process.exit(1)});
