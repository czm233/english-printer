// Run against tests/acceptance.mjs on 10292. All model/device operations are simulated.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');

const base='http://127.0.0.1:10292/';
const errors=[];
let browser;

async function open(context){
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base);await page.waitForFunction(()=>!document.getElementById('chatHistory').disabled);
 await page.locator('#chatTab').click();return page;
}
async function reload(page){
 await page.reload();await page.waitForFunction(()=>!document.getElementById('chatHistory').disabled);
 await page.locator('#chatTab').click();
}
async function persist(page){
 return page.evaluate(async()=>{try{await P0History.persist();return true}catch{return false}});
}
// Reading through P0ChatStore.load could refresh its concurrency token and hide a stale-tab bug.
async function stored(page){
 return page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('english-printer-chat',1);
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{
   const database=request.result,transaction=database.transaction('history','readonly');
   const snapshot=transaction.objectStore('history').get('snapshot');
   transaction.oncomplete=()=>{database.close();resolve(snapshot.result)};
   transaction.onerror=transaction.onabort=()=>{database.close();reject(transaction.error)};
  };
 }));
}
async function storageState(page,id){
 return page.evaluate(id=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('english-printer-chat',1);
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{
   const database=request.result,transaction=database.transaction('history','readonly'),store=transaction.objectStore('history');
   const snapshot=store.get('snapshot'),revision=store.get('revision'),claimed=store.get('print:'+id);
   transaction.oncomplete=()=>{database.close();resolve({snapshot:snapshot.result,revision:revision.result,claimed:claimed.result??null})};
   transaction.onerror=transaction.onabort=()=>{database.close();reject(transaction.error)};
  };
 }),id);
}
async function send(page,text){
 await page.locator('#chatInput').fill(text);await page.locator('#sendChat').click();
 await page.waitForFunction(()=>!document.getElementById('newChat').disabled);
 assert(await persist(page),'Fresh page must save its completed conversation');
}
async function card(page,kind){
 await send(page,kind==='batch'?'主机卡片测试':'卡片测试');
 await page.waitForSelector('[data-confirm-print]');
 if(kind==='batch')await page.waitForFunction(()=>document.querySelector('[data-confirm-print]')?.textContent.startsWith('拆分打印(0/'));
 const button=page.locator('[data-confirm-print]');
 const id=await button.getAttribute('data-confirm-print');
 const count=kind==='batch'?Number((await button.textContent()).match(/\/(\d+)/)[1]):1;
 assert(count>0);return {id,count};
}
async function settled(page){await page.waitForFunction(()=>!busy)}
async function consumed(page,id){
 const snapshot=await stored(page),parent=snapshot.cards.find(card=>card.id===id);
 assert(parent?.used,'The card must remain consumed in durable history');
 if(parent.batch){
  assert(parent.children.length>1);
  for(const childId of parent.children)assert(snapshot.cards.find(card=>card.id===childId)?.used,'Every batch child must be consumed');
 }
 return parent;
}
async function fixture(run){
 const context=await browser.newContext({viewport:{width:390,height:844}}),prints=[];
 context.on('request',request=>{if(request.url().endsWith('/api/printer/print'))prints.push(JSON.parse(request.postData()))});
 try{await run(context,prints)}finally{await context.close()}
}
async function sharedCard(kind,simultaneous){
 await fixture(async(context,prints)=>{
  const first=await open(context),{id,count}=await card(first,kind),second=await open(context);
  await second.waitForSelector('[data-confirm-print]');
  if(kind==='batch')await second.waitForFunction(()=>document.querySelector('[data-confirm-print]')?.textContent.startsWith('拆分打印(0/'));
  assert.equal(await second.locator('[data-confirm-print]').getAttribute('data-confirm-print'),id);
  if(simultaneous){
   // Both trusted clicks reach the save boundary before either page can commit its lock.
   for(const page of [first,second])await page.evaluate(()=>{
    const save=P0ChatStore.save;let wait=true;
    P0ChatStore.save=async(...args)=>{
     if(wait&&args[1]?.claim){wait=false;window.historyTestSaveWaiting=true;await new Promise(resolve=>window.historyTestReleaseSave=resolve)}
     return save(...args);
    };
   });
   await Promise.all([first,second].map(page=>page.locator('[data-confirm-print]').click({force:true})));
   await Promise.all([first,second].map(page=>page.waitForFunction(()=>window.historyTestSaveWaiting===true)));
   await Promise.all([first,second].map(page=>page.evaluate(()=>window.historyTestReleaseSave())));
   await Promise.all([first,second].map(settled));
  }else{
   await first.locator('[data-confirm-print]').click();await settled(first);
   assert.equal(prints.length,count,'First confirmation must send exactly one complete batch');
   // A production cross-tab notification may already have disabled the stale button.
   if(await second.locator('[data-confirm-print]').isEnabled())await second.locator('[data-confirm-print]').click();
   await settled(second);
  }
  assert.equal(prints.length,count,`${kind}: the same card may only issue one set of device requests`);
  assert.equal(new Set(prints.map(request=>request.requestId)).size,count,'Child UUIDs must be unique within the one accepted batch');
  const parent=await consumed(first,id);
  if(kind==='batch')assert.deepEqual(new Set(parent.children),new Set(prints.map(request=>request.requestId)));
  else assert.equal(prints[0].requestId,id);
  for(const page of [first,second]){
   await reload(page);assert(await page.locator('[data-confirm-print]').isDisabled(),'Reload must retain the consumed card');
  }
  assert.equal(prints.length,count,'Restoring history must not resume printing');
 });
 console.log(`PASS history concurrency: ${kind}, ${simultaneous?'simultaneous':'serial'} trusted clicks`);
}
function records(snapshot){return {sessions:snapshot.sessions,cards:snapshot.cards,choices:snapshot.choices}}
async function staleLifecycle(){
 await fixture(async(context,prints)=>{
  const first=await open(context),{id}=await card(first,'single'),stale=[];
  for(const mode of ['explicit','visibility','pagehide','navigation'])stale.push([mode,await open(context)]);
  await first.locator('[data-confirm-print]').click();await settled(first);assert.equal(prints.length,1);
  await first.locator('#newChat').click();await send(first,'并发保存的新对话');
  const before=await stored(first);assert.equal(before.sessions.length,2);await consumed(first,id);
  for(const [mode,page] of stale){
   const draft='尚未保存的输入 '+mode;await page.locator('#chatInput').fill(draft);
   if(mode==='visibility')await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;
   });
   if(mode==='pagehide')await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
   if(mode==='navigation')await page.goto('about:blank');
   else{
    assert.equal(await persist(page),false,`${mode}: a modified stale snapshot must report the conflict`);
    assert(await page.locator('#chatFeedback').isVisible(),'The stale page must show the save conflict');
    assert.equal(await page.locator('#chatInput').inputValue(),draft,'A save conflict must preserve the visible unsaved input');
    assert(await page.locator('#chatInput').isEnabled(),'The preserved draft must remain focusable for copying');
    await page.locator('#chatInput').focus();await page.locator('#chatInput').selectText();
    assert.deepEqual(await page.locator('#chatInput').evaluate(input=>[input.selectionStart,input.selectionEnd]),[0,draft.length]);
    assert(await page.locator('#sendChat').isDisabled(),'A stale page cannot send or replace its history');
   }
   assert.deepEqual(records(await stored(first)),records(before),`${mode}: a stale page must preserve new conversations and consumed cards`);
  }
  assert.equal(prints.length,1);
 });
 console.log('PASS history concurrency: stale save, visibility, pagehide, navigation preserve new conversations and consumed cards');
}
async function deletion(){
 await fixture(async(context)=>{
  const first=await open(context);await send(first,'待删除的历史对话');const second=await open(context);
  const deletedId=(await stored(first)).sessions[0][0];
  await first.locator('#chatHistory').click();first.once('dialog',dialog=>dialog.accept());
  await first.locator('.history-row button[aria-label^="删除对话"]').click();
  await first.waitForFunction(()=>document.querySelectorAll('.history-row').length===0);
  assert(!(await stored(first)).sessions.some(([id])=>id===deletedId));
  await persist(second);await second.goto('about:blank');
  assert(!(await stored(first)).sessions.some(([id])=>id===deletedId),'A stale tab must not resurrect a deleted conversation');
  await first.locator('#closeHistory').click();await reload(first);await first.locator('#chatHistory').click();
  assert.equal(await first.locator('.history-row').count(),0);
 });
 console.log('PASS history concurrency: deleted conversations cannot reappear from a stale tab');
}
async function clearedDraft(){
 await fixture(async(context)=>{
  const page=await open(context);
  await page.locator('#chatInput').fill('即将清空的草稿');assert(await persist(page));
  await page.locator('#chatInput').fill('');assert(await persist(page));await reload(page);
  assert.equal(await page.locator('#chatInput').inputValue(),'','Cleared text must stay cleared after reload');
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=2;return canvas.toDataURL('image/png').split(',')[1]});
  await page.locator('#chatPhoto').setInputFiles({name:'history-clear-test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>P0ChatInput.photo&&!P0ChatInput.pending);assert(await persist(page));
  await page.locator('#removePhoto').click();assert(await persist(page));await reload(page);
  assert.equal(await page.evaluate(()=>P0ChatInput.photo),null,'Removed draft photo must not return');
  assert(await page.locator('#photoPreview').isHidden());
 });
 console.log('PASS history concurrency: cleared draft text and removed photos stay cleared after reload');
}
async function failedStorage(kind){
 await fixture(async(context,prints)=>{
  const page=await open(context);await card(page,kind);
  await page.evaluate(()=>{P0ChatStore.save=()=>Promise.reject(Error('history concurrency test storage failure'))});
  await page.locator('[data-confirm-print]').click();await settled(page);
  assert.equal(prints.length,0,`${kind}: storage failure must prevent every device request`);
  assert(await page.locator('[data-confirm-print]').isDisabled());
  assert((await page.locator('.card-status').textContent()).trim(),'Storage failure must be visible');
 });
 console.log(`PASS history concurrency: ${kind} storage failure blocks device requests`);
}
async function rollbackConsumed(kind){
 await fixture(async(context,prints)=>{
  const page=await open(context),{id,count}=await card(page,kind),before=await stored(page);
  await page.locator('[data-confirm-print]').click();await settled(page);assert.equal(prints.length,count);
  const committed=await storageState(page,id);assert.equal(committed.claimed,true);
  // An old client writes only the historical snapshot; its write cannot erase the independent claim.
  await page.evaluate(snapshot=>new Promise((resolve,reject)=>{
   const request=indexedDB.open('english-printer-chat',1);
   request.onerror=()=>reject(request.error);
   request.onsuccess=()=>{
    const database=request.result,transaction=database.transaction('history','readwrite');
    transaction.objectStore('history').put(snapshot,'snapshot');
    transaction.oncomplete=()=>{database.close();resolve()};
    transaction.onerror=transaction.onabort=()=>{database.close();reject(transaction.error)};
   };
  }),before);
  await reload(page);
  if(kind==='batch')await page.waitForFunction(()=>document.querySelector('[data-confirm-print]')?.textContent.startsWith('拆分打印(0/'));
  if(await page.locator('[data-confirm-print]').isEnabled())await page.locator('[data-confirm-print]').click();
  await settled(page);assert.equal(prints.length,count,'A rolled-back card must never issue new child UUIDs or device requests');
  assert(await page.locator('[data-confirm-print]').isDisabled());
  const after=await storageState(page,id);assert.equal(after.claimed,true);assert.equal(after.revision,committed.revision,'A rejected duplicate claim must not advance the revision');
 });
 console.log(`PASS history concurrency: ${kind} independent consumption survives snapshot rollback`);
}
async function invalidBatchClaim(){
 await fixture(async(context,prints)=>{
  const page=await open(context),{id}=await card(page,'batch'),before=await storageState(page,id);
  for(const missing of [true,false]){
   const rejected=await page.evaluate(async({id,missing,snapshot})=>{
    const childId=crypto.randomUUID(),parent=snapshot.cards.find(card=>card.id===id);
    parent.used=true;parent.batch=true;parent.state='printing';parent.children=[childId];
    if(!missing)snapshot.cards.push({id:childId,toolId:parent.toolId,word:'computer',ipa:'/kəmˈpjutɚ/',used:false,state:'pending',status:''});
    try{await P0ChatStore.save(snapshot,{claim:id});return false}catch{return true}
   },{id,missing,snapshot:before.snapshot});
   assert(rejected,`${missing?'Missing':'Unlocked'} child UUID must reject the entire batch claim`);
   assert.deepEqual(await storageState(page,id),before,'An invalid batch cannot change the snapshot, revision or claim');
  }
  assert.equal(prints.length,0);
 });
 console.log('PASS history concurrency: missing and unlocked child UUIDs cannot be committed');
}
async function abortedTransaction(){
 await fixture(async(context,prints)=>{
  const page=await open(context),{id,count}=await card(page,'batch'),before=await storageState(page,id);
  await page.evaluate(id=>{
   const put=IDBObjectStore.prototype.put,save=P0ChatStore.save;
   // Keep the outage active so the UI's final status save cannot mask the failed transaction.
   P0ChatStore.save=(...args)=>window.historyTestTransactionAborted?Promise.reject(Error('test storage remains unavailable')):save(...args);
   IDBObjectStore.prototype.put=function(...args){
    const request=put.apply(this,args);
    if(this.name==='history'&&args[1]==='print:'+id){
     const transaction=this.transaction;
     request.addEventListener('success',()=>{window.historyTestTransactionAborted=true;transaction.abort()});
    }
    return request;
   };
  },id);
  await page.locator('[data-confirm-print]').click();await settled(page);
  assert(await page.evaluate(()=>window.historyTestTransactionAborted===true),'The test must abort after the claim put has run');
  assert.equal(prints.length,0,'An aborted durable claim must prevent every device request');
  assert.deepEqual(await storageState(page,id),before,'The aborted transaction must roll back the snapshot, revision and claim atomically');
  await reload(page);await page.waitForFunction(()=>document.querySelector('[data-confirm-print]')?.textContent.startsWith('拆分打印(0/'));
  assert(await page.locator('[data-confirm-print]').isEnabled());
  await page.locator('[data-confirm-print]').click();await settled(page);
  assert.equal(prints.length,count,'A rolled-back transaction must leave the unconsumed card usable after reload');
  await consumed(page,id);
 });
 console.log('PASS history concurrency: aborted claim rolls back snapshot, revision and marker without sending');
}
(async()=>{
 browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  await clearedDraft();
  for(const kind of ['single','batch'])for(const simultaneous of [false,true])await sharedCard(kind,simultaneous);
  await staleLifecycle();await deletion();
  for(const kind of ['single','batch'])await failedStorage(kind);
  for(const kind of ['single','batch'])await rollbackConsumed(kind);
  await invalidBatchClaim();await abortedTransaction();
  assert.deepEqual(errors,[]);console.log('PASS history concurrency: all isolated browser scenarios, simulated model and printer only.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
