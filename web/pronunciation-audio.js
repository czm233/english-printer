// Buttons are created by the App after sanitization, never by model HTML.
(()=>{
let speechGeneration=0,activeUtterance=null,activeButton=null,watchdogTimer=null,cachedVoice=null;

function updateVoices(){
 if(!('speechSynthesis' in window))return;
 try{
  const list=window.speechSynthesis.getVoices()||[];
  if(list.length){
   cachedVoice=list.find(v=>v.lang.toLowerCase()==='en-us'&&v.localService)
    ||list.find(v=>v.lang.toLowerCase()==='en-us')
    ||list.find(v=>v.lang.toLowerCase().startsWith('en'))
    ||null;
  }
 }catch{}
}
updateVoices();
if('speechSynthesis' in window){
 try{
  window.speechSynthesis.addEventListener('voiceschanged',updateVoices);
  if('onvoiceschanged' in window.speechSynthesis)window.speechSynthesis.onvoiceschanged=updateVoices;
 }catch{}
}

function safeCancel(){
 if(!('speechSynthesis' in window))return;
 try{
  if(window.speechSynthesis.speaking||window.speechSynthesis.pending||window.speechSynthesis.paused){
   window.speechSynthesis.cancel();
  }
 }catch{}
}

function setButtonState(btn,playing){
 if(!btn)return;
 btn.setAttribute('aria-pressed',playing?'true':'false');
 btn.classList.toggle('speaking',playing);
 btn.innerHTML=`<i class="icon icon-volume" aria-hidden="true"></i>`;
 const isSpeak=btn.id==='speak',isSample=btn.id==='speakSample',text=btn.dataset?.speakText||'';
 if(playing){
  if(isSpeak)btn.setAttribute('aria-label','正在朗读英文');
  else if(isSample)btn.setAttribute('aria-label','正在朗读预览英文');
  else if(text)btn.setAttribute('aria-label','正在朗读 '+text);
 }else{
  if(isSpeak)btn.setAttribute('aria-label','朗读英文');
  else if(isSample)btn.setAttribute('aria-label','朗读预览英文');
  else if(text)btn.setAttribute('aria-label','朗读 '+text);
 }
}

function resetAllButtons(){
 if(activeButton){setButtonState(activeButton,false);activeButton=null}
 document.querySelectorAll('#speak, #speakSample, [data-speak-text]').forEach(btn=>{
  if(btn.getAttribute('aria-pressed')==='true')setButtonState(btn,false);
 });
}

function stop(){
 speechGeneration++;
 clearTimeout(watchdogTimer);
 watchdogTimer=null;
 if(activeUtterance){
  activeUtterance.onend=null;activeUtterance.onerror=null;activeUtterance.onstart=null;
  activeUtterance=null;
 }
 safeCancel();
 resetAllButtons();
}

function isPlaying(){
 return !!activeUtterance||(activeButton&&activeButton.getAttribute('aria-pressed')==='true');
}

function speak(text,button=null,{onError=null}={}){
 const rawText=typeof text==='string'?text.trim():'';
 if(!rawText||!('speechSynthesis' in window))return;

 // Repeat click on the button that is already playing: keep playing (no stop, no replay).
 if(isPlaying()&&button&&activeButton===button)return;

 speechGeneration++;
 clearTimeout(watchdogTimer);
 watchdogTimer=null;
 if(activeUtterance){
  activeUtterance.onend=null;activeUtterance.onerror=null;activeUtterance.onstart=null;
  activeUtterance=null;
 }
 safeCancel();
 resetAllButtons();

 const generation=speechGeneration;
 activeButton=button;
 if(activeButton)setButtonState(activeButton,true);

 try{
  const utterance=new SpeechSynthesisUtterance(rawText);
  activeUtterance=utterance;
  utterance.lang='en-US';
  utterance.rate=0.85;

  if(!cachedVoice)updateVoices();
  if(cachedVoice)utterance.voice=cachedVoice;

  const finish=err=>{
   if(generation!==speechGeneration)return;
   clearTimeout(watchdogTimer);
   watchdogTimer=null;
   activeUtterance=null;
   resetAllButtons();
   if(err&&err.error!=='canceled'&&err.error!=='interrupted'&&typeof onError==='function'){
    onError(err);
   }
  };

  utterance.onend=()=>finish();
  utterance.onerror=e=>finish(e);

  watchdogTimer=setTimeout(()=>{
   if(generation!==speechGeneration)return;
   safeCancel();
   finish(new Error('timeout'));
  },6000);

  window.speechSynthesis.speak(utterance);
 }catch(e){
  finish(e);
 }
}

function button(text){
 const b=document.createElement('button');
 b.type='button';
 b.className='icon-button pronunciation-audio';
 b.dataset.speakText=text;
 b.setAttribute('aria-label','朗读 '+text);
 b.setAttribute('aria-pressed','false');
 b.disabled=!('speechSynthesis' in window);
 const icon=document.createElement('i');
 icon.className='icon icon-volume';
 icon.setAttribute('aria-hidden','true');
 b.append(icon);
 return b;
}

document.addEventListener('click',event=>{
 const b=event.target.closest('[data-speak-text]');
 if(b&&!b.disabled)speak(b.dataset.speakText,b);
});

function decorate(target){
 for(const node of target.querySelectorAll('p,li,td')){
  if(!/\/[a-zæðθŋøœ\u0250-\u02ff][^/\n]{0,240}\//u.test(node.textContent))continue;
  const context=node.closest('tr')?.querySelector('td')?.textContent||node.textContent.split('/')[0];
  const words=context.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*(?: +[A-Za-z]+(?:['’-][A-Za-z]+)*)*/g);
  if(words?.length)node.append(button(words.at(-1)));
 }
}

const sampleBtn=document.getElementById('speakSample');
if(sampleBtn){
 sampleBtn.setAttribute('aria-pressed','false');
 sampleBtn.onclick=()=>{
  const word=document.getElementById('sampleWord')?.value?.trim();
  if(word)speak(word,sampleBtn);
 };
}

document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
window.addEventListener('pagehide',stop);
document.addEventListener('page-change',stop);

window.stopSpeech=stop;
window.P0Speech={button,speak,stop,decorate,isPlaying,setButtonState,updateVoices};
})();
