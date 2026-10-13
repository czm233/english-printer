const TRANSLATION_IDLE_MS=1500;

const $=id=>document.getElementById(id),ctx=$('canvas').getContext('2d'),ids=['font','width','height','top','bottom','left','right'];let busy=false,connected=false,deviceBusy=false,printerError='',translatedSource='',hasResult=false,translating=false,revision=0,translationTimer,composing=false;
try{const s=JSON.parse(localStorage.getItem('p0-settings-v2'));if(s)ids.forEach(id=>{const n=Number(s[id]),el=$(id);if(Number.isFinite(n)&&n>=Number(el.min)&&n<=Number(el.max))el.value=n})}catch{}
function config(){return {...Object.fromEntries(ids.map(id=>[id,Number($(id).value)])),border:0}}
function message(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error)}
function validate(word,ipa){const c=config();if(ids.some(id=>!$(id).value||!$(id).checkValidity()))return '请在设置中填写有效的字号和边距。';if(!word.trim()||!ipa.trim())return '音标未完整获取，请补全后打印。';if(c.width<=c.left+c.right||c.height<=c.top+c.bottom)return '边距不能占满标签尺寸。';ctx.font=`${c.font*203/72*4}px Arial`;for(const text of [word,ipa]){const m=ctx.measureText(text);if(m.width>(c.width-c.left-c.right)*32)return '内容过长，请缩小字号或缩短英文与音标。';if(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent>(c.height-c.top-c.bottom)*16)return '文字超出高度，请减小字号或上下边距。'}return ''}
function draw(){const c=config();$('canvas').width=(c.width||30)*32;$('canvas').height=(c.height||12)*32;$('canvas').style.aspectRatio=`${c.width||30}/${c.height||12}`;ctx.fillStyle='white';ctx.fillRect(0,0,$('canvas').width,$('canvas').height);ctx.fillStyle='#000';ctx.font=`${c.font*203/72*4}px Arial`;ctx.textAlign='center';ctx.textBaseline='alphabetic';const x=c.left*32,y=c.top*32,w=(c.width-c.left-c.right)*32,h=(c.height-c.top-c.bottom)*16;[$('sampleWord').value,P0Phonetics.format($('sampleIpa').value)].forEach((text,i)=>{const m=ctx.measureText(text);ctx.save();ctx.beginPath();ctx.rect(x,y+i*h,w,h);ctx.clip();ctx.fillText(text,x+w/2,y+i*h+h/2+(m.actualBoundingBoxAscent-m.actualBoundingBoxDescent)/2);ctx.restore()});if(c.border){ctx.strokeStyle='#000';ctx.lineWidth=c.border*32;ctx.strokeRect(x+c.border*16,y+c.border*16,w-c.border*32,h*2-c.border*32)}$('fontValue').value=c.font+' pt';$('settingsError').textContent=validate($('sampleWord').value,$('sampleIpa').value);try{localStorage.setItem('p0-settings-v2',JSON.stringify(c))}catch{}refresh()}
function refresh(){centerChinese();$('speakSample').disabled=busy||deviceBusy||!$('sampleWord').value.trim()||!('speechSynthesis' in window);$('speak').disabled=busy||translating||!hasResult||!$('word').value.trim()||!('speechSynthesis' in window);$('translatePrint').disabled=busy||translating||!$('chinese').value.trim();$('printAgain').disabled=busy||deviceBusy||translating||!hasResult||!!validate($('word').value,$('ipa').value)&&!canSplitCurrent();$('printAgain').textContent=canSplitCurrent()?'拆分打印':'打印';['chinese','word','ipa','clear','connect','swapLanguages',...ids,'sampleWord','sampleIpa'].forEach(id=>$(id).disabled=busy||deviceBusy);$('settingsError').textContent=printerError||validate($('sampleWord').value,$('sampleIpa').value);document.querySelectorAll('#translationOptions input').forEach(input=>input.disabled=busy||deviceBusy||translating);document.querySelectorAll('[data-text]').forEach(b=>b.disabled=busy);document.dispatchEvent(new Event('printer-state'))}
let direction='zh-en',meaningRevision=0;const translationDrafts={'zh-en':'','en-zh':''};
let currentPage='print',chatReturnPage='print';
function tab(name){if(name==='chat'&&currentPage!=='chat')chatReturnPage=currentPage;currentPage=name;document.querySelector('.app').classList.toggle('chat-open',name==='chat');document.querySelector('.tabs').hidden=name==='chat';document.dispatchEvent(new CustomEvent('page-change',{detail:name}));for(const page of ['print','chat','settings']){$(page+'Page').hidden=name!==page;$(page+'Tab').setAttribute('aria-selected',String(name===page))}document.activeElement?.blur();centerChinese();if(name==='chat')document.dispatchEvent(new Event('show-chat'))}
$('chatBack').onclick=()=>tab(chatReturnPage);
$('printTab').onclick=()=>tab('print');$('settingsTab').onclick=()=>tab('settings');$('chatTab').onclick=()=>tab('chat');
function setConnection(device){connected=!!device.connected;deviceBusy=!!device.busy;$('deviceState').textContent=connected?'已连接 · '+device.detail:'未连接';$('connect').textContent=connected?'断开':'连接'}
async function printerRequest(action,body){if(action==='print'&&body)body={...body,ipa:P0Phonetics.format(body.ipa)};const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),55000);try{const r=await fetch('/api/printer/'+action,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:ctrl.signal});const data=await r.json();if(!r.ok)throw Error(data.error||'打印机操作失败。');return data}catch(e){if(e instanceof TypeError||e.name==='AbortError')throw Error(action==='print'?'打印结果未确认，请检查是否出纸，避免重复打印。':'本机服务未连接，请检查服务后重试。');throw e}finally{clearTimeout(timer)}}
async function syncPrinter(){if(busy||document.hidden)return;try{setConnection(await printerRequest('status'));refresh()}catch{$('deviceState').textContent='本机服务未连接';connected=false;deviceBusy=false;refresh()}}
$('connect').onclick=async()=>{if(busy||deviceBusy)return;busy=true;printerError='';refresh();$('connect').textContent=connected?'断开中':'连接中';try{setConnection(await printerRequest(connected?'disconnect':'connect',{}))}catch(e){printerError=e.message;try{setConnection(await printerRequest('status'))}catch{connected=false;$('deviceState').textContent='连接失败'}}finally{busy=false;$('connect').textContent=connected?'断开':'连接';refresh()}};
async function getJson(url){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);try{const r=await fetch(url,{signal:ctrl.signal});if(!r.ok)throw Error('网络服务暂不可用，请稍后重试。');return await r.json()}finally{clearTimeout(timer)}}
async function requestTranslation(q,direction){const r=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q,direction}),signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw Error(data.error||'翻译失败，请重试。');return data}
let dictionaryPromise;
async function phonetics(english){if(!dictionaryPromise)dictionaryPromise=getJson('pronunciations.json').catch(e=>{dictionaryPromise=null;throw e});return P0Phonetics.lookup(english,await dictionaryPromise)}

function canSplitCurrent(){return hasResult&&validate($('word').value,$('ipa').value).startsWith('内容过长')&&$('word').value.trim().split(/\s+/).length>1}
async function printCurrent(){const err=validate($('word').value,$('ipa').value);if(err)throw Error(err);printerError='';message(connected?'正在打印…':'正在连接并打印…');const result=await printerRequest('print',{requestId:crypto.randomUUID(),word:$('word').value,ipa:$('ipa').value,settings:config()});setConnection(result.device);message(result.message);}
function clearOptions(){ $('translationOptions').replaceChildren();$('translationOptions').hidden=true;$('singleTranslation').hidden=direction==='en-zh'; }
function showOptions(options){
 $('translationPending').hidden=true;$('word').hidden=false;
 const list=$('translationOptions');list.replaceChildren();list.hidden=false;$('singleTranslation').hidden=true;
 options.forEach((option,index)=>{
  const row=document.createElement('div');row.className='translation-option';
  const radio=document.createElement('input');radio.type='radio';radio.name='translation';radio.value=String(index);radio.setAttribute('aria-label',option.word);
  const content=document.createElement('span');content.className='translation-option-content';
  for(const [text,cls] of [[option.word,'option-word'],[option.ipa||'未找到完整音标','option-ipa'],[option.note,'note']]){if(!text)continue;const line=document.createElement('span');line.className=cls;line.textContent=text;content.append(line)}
  radio.onchange=()=>{if(busy||deviceBusy||translating)return;stopSpeech();$('word').value=$('sampleWord').value=option.word;$('ipa').value=$('sampleIpa').value=option.ipa;hasResult=true;draw();message('')};
  row.append(radio,content);list.append(row);row.addEventListener('click',e=>{if(e.target.closest('button,input,.option-parts'))return;radio.click()});window.P0OptionParts?.attach(row,option,radio);
 });
}
async function translate(){
 if(direction==='en-zh')return translateEnglish();
 if(composing||!$('chinese').value.trim())return;if(busy){translationTimer=setTimeout(translate,TRANSLATION_IDLE_MS);return}
 stopSpeech();clearTimeout(translationTimer);const current=++revision,source=$('chinese').value.trim();translating=true;hasResult=false;clearOptions();$('translatePrint').hidden=true;refresh();$('word').value='';$('ipa').value='';showTranslationPending();
 try{
  let r;
  if(!P0Translations.has(source)){
   const response=await requestTranslation(source,'zh-en');
   if(current!==revision)return;
   r={responseData:{translatedText:response.text}};
  }
  const decoder=document.createElement('textarea');
  const options=P0Translations.candidates(source,r,text=>{decoder.innerHTML=text;return decoder.value});
  if(!options.length)throw Error('未得到有效英文，请换一种中文表达。');
  await Promise.all(options.map(async option=>{option.ipa=await phonetics(option.word)}));
  if(current!==revision)return;
  translatedSource=source;showOptions(options);message('');
  if(options.length===1){
   const option=options[0];$('translationOptions').querySelector('input').checked=true;
   $('word').value=$('sampleWord').value=option.word;$('ipa').value=$('sampleIpa').value=option.ipa;hasResult=true;draw();
   message('');
  }
 }catch(e){if(current===revision){$('translationPending').hidden=true;$('word').hidden=false;$('translatePrint').hidden=false;message(e.name==='AbortError'?'请求超时，请点击重新翻译。':e.message||'翻译失败，请重试。',true)}}
 finally{if(current===revision){translating=false;$('translatePrint').textContent='重试翻译';refresh()}}
}
async function translateMeaning(current,source){
 const attempt=++meaningRevision;renderTranslationLoading($('meaning'));$('translatePrint').hidden=true;
 try{
  const r=await requestTranslation(source,'en-zh');
  if(current!==revision||attempt!==meaningRevision)return;
  const decoder={value:r.text};
  const text=decoder.value.trim();setMeaning(/[\u3400-\u9fff]/.test(text)?text:'未找到翻译');
 }catch{if(current===revision&&attempt===meaningRevision){setMeaning('翻译失败');$('translatePrint').hidden=false}}
}
async function translateEnglish(){
 if(composing||!$('chinese').value.trim()||busy||deviceBusy)return;
 clearTimeout(translationTimer);const current=++revision,source=$('chinese').value.trim();
 translating=true;hasResult=false;refresh();showTranslationPending();translateMeaning(current,source);
 try{
  const ipa=await phonetics(source);if(current!==revision)return;
  $('word').value=$('sampleWord').value=source;$('ipa').value=$('sampleIpa').value=ipa;$('sourceIpa').textContent=ipa;
  hasResult=!!ipa;translatedSource=source;draw();const error=ipa?(canSplitCurrent()?'':validate(source,ipa)):'请检查英文拼写';message(error,!!error);
 }catch{if(current===revision){message('音标词典加载失败，请重试。',true);$('translatePrint').hidden=false}}
 finally{if(current===revision){setPhoneticsLoading(false);translating=false;refresh()}}
}
$('swapLanguages').onclick=()=>{
 if(busy||deviceBusy)return;
 const previous=direction;translationDrafts[previous]=$('chinese').value;
 const converted=previous==='zh-en'?(hasResult?$('word').value:''):(/[\u3400-\u9fff]/.test($('meaning').textContent)&&!['等待输入完毕…','翻译中…','翻译失败','未找到翻译'].includes($('meaning').textContent)?$('meaning').textContent:'');
 direction=previous==='zh-en'?'en-zh':'zh-en';const reverse=direction==='en-zh';
 $('sourceLanguage').textContent=reverse?'英语':'中文';$('targetLanguage').textContent=reverse?'中文':'英语';
 $('swapLanguages').setAttribute('aria-label',reverse?'切换为中译英':'切换为英译中');
 $('sourceTitle').textContent=reverse?'英文与音标':'中文';$('resultTitle').textContent=reverse?'中文':'英文与音标';
 $('chinese').placeholder=reverse?'输入或粘贴英文':'想把什么贴成英文？';$('chinese').maxLength=reverse?120:60;
 $('chinese').setAttribute('lang',reverse?'en':'zh-CN');$('chinese').setAttribute('autocapitalize',reverse?'none':'sentences');
 $('chinese').value=converted||translationDrafts[direction];$('sourceIpa').hidden=!reverse;$('chineseResult').hidden=!reverse;
 (reverse?$('sourceActions'):$('resultHeading')).append($('speak'));
 $('printPage').classList.toggle('english-source',reverse);composing=false;scheduleTranslation();
};
$('translatePrint').onclick=()=>{if(direction==='en-zh'&&hasResult)translateMeaning(revision,$('chinese').value.trim());else translate()};
$('printAgain').onclick=async event=>{if(!event.isTrusted||$('printAgain').disabled||busy||deviceBusy||translating||!hasResult||validate($('word').value,$('ipa').value)&&!canSplitCurrent())return;document.activeElement?.blur();stopSpeech();busy=true;refresh();try{if(canSplitCurrent())await P0OptionParts.print();else await printCurrent()}catch(e){message(e.message,true);try{setConnection(await printerRequest('status'))}catch{connected=false;deviceBusy=false}}finally{busy=false;refresh()}};
function setPhoneticsLoading(loading){$('sourceIpa').classList.toggle('loading',loading);$('sourceIpa').setAttribute('aria-busy',String(loading));$('sourceIpa').setAttribute('aria-label',loading?'音标加载中':'音标')}
function renderTranslationLoading(target,label='翻译中'){target.classList.add('translation-loading');target.setAttribute('aria-busy','true');target.innerHTML='<span class="loading-label"><span class="loading-ellipsis">…</span></span><span class="loading-dots" aria-hidden="true"><i></i><i></i><i></i></span>';target.querySelector('.loading-label').prepend(document.createTextNode(label))}
function setMeaning(text){$('meaning').classList.remove('translation-loading');$('meaning').removeAttribute('aria-busy');$('meaning').textContent=text}
function showTranslationPending(){message('');if(direction==='en-zh'){setPhoneticsLoading(true);renderTranslationLoading($('meaning'))}else{renderTranslationLoading($('translationPending'));$('translationPending').hidden=false;$('word').hidden=true}}
function resetResult(){setPhoneticsLoading(false); $('translationPending').hidden=true;$('word').hidden=false;meaningRevision++;setMeaning('');$('sourceIpa').textContent='';clearOptions();stopSpeech();$('translatePrint').hidden=true;clearTimeout(translationTimer);revision++;translating=false;$('word').value='';$('ipa').value='';$('ipa').placeholder='';hasResult=false;translatedSource='';$('translatePrint').textContent='重试翻译';message('');refresh()}
function showTyping(){if(!$('chinese').value.trim())return;if(direction==='en-zh'){setPhoneticsLoading(true);renderTranslationLoading($('meaning'),'等待输入完毕')}else{renderTranslationLoading($('translationPending'),'等待输入完毕');$('translationPending').hidden=false;$('word').hidden=true}}
function scheduleTranslation(){resetResult();showTyping();if(!composing&&$('chinese').value.trim()){translationTimer=setTimeout(translate,TRANSLATION_IDLE_MS)}}
$('chinese').oncompositionstart=()=>{composing=true;resetResult();showTyping()};$('chinese').oncompositionend=()=>{composing=false;scheduleTranslation()};$('chinese').oninput=scheduleTranslation;$('clear').onclick=()=>{$('chinese').value='';resetResult();$('chinese').focus()};document.querySelectorAll('[data-text]').forEach(b=>b.onclick=()=>{$('chinese').value=b.dataset.text;scheduleTranslation()});
['word','ipa'].forEach(id=>$(id).oninput=()=>{hasResult=!!translatedSource;$('sampleWord').value=$('word').value;$('sampleIpa').value=$('ipa').value;message(canSplitCurrent()?'':validate($('word').value,$('ipa').value),true);draw()});ids.forEach(id=>$(id).oninput=draw);
function editLabel(){setPhoneticsLoading(false);$('translationPending').hidden=true;$('word').hidden=false;clearOptions();stopSpeech();clearTimeout(translationTimer);revision++;translating=false;$('translatePrint').hidden=true;$('word').value=$('sampleWord').value;$('ipa').value=P0Phonetics.format($('sampleIpa').value);hasResult=!!$('word').value.trim();if(direction==='en-zh'){$('chinese').value=$('word').value;$('sourceIpa').textContent=$('ipa').value;translateMeaning(revision,$('word').value.trim())}message(canSplitCurrent()?'':validate($('word').value,$('ipa').value),true);draw()}
['sampleWord','sampleIpa'].forEach(id=>$(id).oninput=editLabel);$('sampleIpa').onblur=()=>{const ipa=P0Phonetics.format($('sampleIpa').value).slice(1,-1);$('sampleIpa').value=ipa?'/'+ipa+'/':'';editLabel()};
let speechGeneration=0,activeUtterance=null;
function stopSpeech(){speechGeneration++;if('speechSynthesis' in window)window.speechSynthesis.cancel();activeUtterance=null;$('speak').innerHTML='<i class="icon icon-volume" aria-hidden="true"></i>';$('speak').setAttribute('aria-pressed','false')}
$('speak').onclick=()=>{if(activeUtterance){stopSpeech();return}const text=$('word').value.trim();if(!text||!hasResult)return;stopSpeech();const generation=speechGeneration;const utterance=new SpeechSynthesisUtterance(text);activeUtterance=utterance;utterance.lang='en-US';utterance.rate=0.85;const voices=speechSynthesis.getVoices();const voice=voices.find(v=>v.lang.toLowerCase()==='en-us'&&v.localService)||voices.find(v=>v.lang.toLowerCase()==='en-us');if(voice)utterance.voice=voice;$('speak').innerHTML='<i class="icon icon-stop" aria-hidden="true"></i>';$('speak').setAttribute('aria-pressed','true');const done=()=>{if(generation!==speechGeneration)return;activeUtterance=null;$('speak').innerHTML='<i class="icon icon-volume" aria-hidden="true"></i>';$('speak').setAttribute('aria-pressed','false')};utterance.onend=done;utterance.onerror=e=>{if(generation!==speechGeneration)return;done();if(e.error!=='canceled'&&e.error!=='interrupted')message('朗读失败，请检查设备语音设置后重试。',true)};speechSynthesis.speak(utterance)};
['word','ipa'].forEach(id=>$(id).addEventListener('input',stopSpeech));window.addEventListener('pagehide',stopSpeech);
document.querySelector('.input-block>.entry').addEventListener('click',e=>{if(e.target!==$('chinese')&&!$('chinese').disabled)$('chinese').focus()});
function centerChinese(){const input=$('chinese');if(!input.getClientRects().length)return;input.style.height='0px';input.style.height=input.scrollHeight+'px'}
window.addEventListener('resize',centerChinese);$('chinese').addEventListener('input',centerChinese);
function keepFieldVisible(){
 const input=document.activeElement;if(!input?.matches('input,textarea'))return;
 const area=input.closest('.dialog-body,.settings-pane,#printPage');if(!area)return;
 const field=input.getBoundingClientRect(),box=area.getBoundingClientRect();
 if(field.bottom>box.bottom-12)area.scrollTop+=field.bottom-box.bottom+12;
 else if(field.top<box.top+12)area.scrollTop-=box.top+12-field.top;
}
let viewportFrame;
function viewport(){
 const native=window.P0Viewport;
 const height=native?.height||(window.visualViewport?.height||window.innerHeight);
 document.documentElement.style.setProperty('--vh',height+'px');
 const keyboard=native?native.keyboard:window.innerHeight-height>120;
 document.documentElement.classList.toggle('keyboard-open',keyboard);
 cancelAnimationFrame(viewportFrame);viewportFrame=requestAnimationFrame(()=>{centerChinese();keepFieldVisible()});
}
window.visualViewport?.addEventListener('resize',viewport);window.addEventListener('resize',viewport);
window.addEventListener('native-viewport',viewport);document.addEventListener('focusin',()=>requestAnimationFrame(keepFieldVisible));
viewport();draw();scheduleTranslation();
syncPrinter();setInterval(syncPrinter,8000);document.addEventListener('visibilitychange',syncPrinter);
