// Input adapters do not send messages: photos and recognized text wait for explicit Send.
(()=>{
const el=id=>document.getElementById(id);
let photo=null,photoRevision=0,loading=false,locked=false,voiceMode=false,recognition=null,holding=false,recognizing=false,voiceBase='',voiceText='',voiceFailed=false,voiceTimer;
const changed=()=>document.dispatchEvent(new Event('chat-input-change'));
const error=text=>document.dispatchEvent(new CustomEvent('chat-input-error',{detail:text}));
function resize(){const input=el('chatInput');if(input.hidden)return;input.style.height='0px';input.style.height=Math.min(116,Math.max(44,input.scrollHeight))+'px'}
function draw(){
  el('chatInput').hidden=voiceMode;el('holdToTalk').hidden=!voiceMode;
  el('voiceToggle').setAttribute('aria-label',voiceMode?'切换键盘输入':'切换语音输入');el('voiceToggle').setAttribute('aria-pressed',String(voiceMode));
  el('voiceToggle').firstElementChild.className='icon '+(voiceMode?'icon-keyboard':'icon-microphone');
  el('holdToTalk').textContent=recognizing?(holding?'松开结束':'正在识别…'):'按住说话';el('holdToTalk').setAttribute('aria-pressed',String(recognizing));
  el('photoPreview').hidden=!photo;if(photo)el('photoThumb').src=`data:${photo.source.media_type};base64,${photo.source.data}`;else el('photoThumb').removeAttribute('src');
  for(const id of ['chatInput','voiceToggle','choosePhoto','removePhoto','holdToTalk'])el(id).disabled=locked||loading;
  el('choosePhoto').setAttribute('aria-label',loading?'正在处理照片':'选择照片');resize();
}
function cancelVoice(){holding=false;recognizing=false;clearTimeout(voiceTimer);if(recognition){const old=recognition;recognition=null;old.abort()}draw();changed()}
function endVoice(){holding=false;if(recognition){try{recognition.stop()}catch{cancelVoice();error('语音未启动，请重新按住说话。')}}draw()}
function startVoice(){
  if(locked||loading||recognizing)return;
  const API=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!API){error('当前浏览器不支持语音输入，请切换键盘，或使用 Safari / Chrome。');return}
  error('');holding=true;recognizing=true;voiceFailed=false;voiceBase=el('chatInput').value;voiceText='';
  const r=new API();recognition=r;r.lang='zh-CN';r.continuous=false;r.interimResults=true;
  r.onstart=()=>{if(recognition!==r)return;if(!holding)r.stop()};
  r.onresult=event=>{if(recognition!==r)return;voiceText=Array.from(event.results).map(result=>result[0].transcript).join('')};
  r.onerror=event=>{if(recognition!==r)return;voiceFailed=true;const hints={'not-allowed':'麦克风权限未开启，请在浏览器中允许后重试。','service-not-allowed':'浏览器语音服务不可用，请使用键盘输入。','audio-capture':'未找到可用麦克风。','no-speech':'没有听清，请再试一次。','network':'语音服务未连接，请检查网络或使用键盘输入。'};if(event.error!=='aborted')error(hints[event.error]||'语音识别失败，请重试。')};
  r.onend=()=>{if(recognition!==r)return;recognition=null;recognizing=false;holding=false;clearTimeout(voiceTimer);if(voiceText.trim()&&!voiceFailed){el('chatInput').value=(voiceBase+(voiceBase?' ':'')+voiceText).slice(0,16000);voiceMode=false}else if(!voiceFailed)error('没有听清，请再试一次。');draw();changed()};
  try{r.start();voiceTimer=setTimeout(endVoice,45000)}catch{recognition=null;recognizing=false;holding=false;error('语音服务无法启动，请使用键盘输入。')}
  draw();changed();
}
el('voiceToggle').onclick=()=>{cancelVoice();voiceMode=!voiceMode;error('');draw();if(!voiceMode)el('chatInput').focus()};
el('holdToTalk').onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();el('holdToTalk').setPointerCapture(e.pointerId);startVoice()};
el('holdToTalk').onpointerup=endVoice;el('holdToTalk').onpointercancel=cancelVoice;
el('holdToTalk').oncontextmenu=e=>e.preventDefault();
el('holdToTalk').onkeydown=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();if(!e.repeat)startVoice()}};
el('holdToTalk').onkeyup=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();endVoice()}};
el('holdToTalk').onblur=()=>{if(recognizing)endVoice()};
el('choosePhoto').onclick=()=>el('chatPhoto').click();
el('chatPhoto').onchange=async()=>{
  const file=el('chatPhoto').files[0];el('chatPhoto').value='';if(!file)return;
  const revision=++photoRevision;loading=true;error('');draw();changed();let url;
  try{
    if(!file.type.startsWith('image/'))throw Error('请选择照片文件。');
    if(file.size>15*1024*1024)throw Error('照片超过 15 MB，请选择较小的照片。');
    url=URL.createObjectURL(file);const img=new Image();img.src=url;await img.decode();
    const scale=Math.min(1,1280/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL('image/jpeg',.85).split(',')[1];if(data.length>2_000_000)throw Error('照片压缩后仍过大，请选择较小的照片。');
    if(revision===photoRevision)photo={type:'image',source:{type:'base64',media_type:'image/jpeg',data}};
  }catch(e){if(revision===photoRevision)error(e.message.includes('照片')?e.message:'无法读取这张照片，请改用 JPEG 或 PNG。')}
  finally{if(url)URL.revokeObjectURL(url);if(revision===photoRevision){loading=false;draw();changed()}}
};
el('removePhoto').onclick=()=>{photo=null;draw();changed()};
el('chatInput').addEventListener('input',()=>{resize();changed()});
document.addEventListener('page-change',e=>{if(e.detail!=='chat')cancelVoice()});
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelVoice()});
window.addEventListener('pagehide',cancelVoice);
window.P0ChatInput={get photo(){return photo},get pending(){return loading||recognizing},resize,lock(value){locked=value;draw()},reset(){cancelVoice();photoRevision++;loading=false;photo=null;el('chatInput').value='';voiceMode=false;draw()},snapshot(){return {text:el('chatInput').value,photo}},restore(draft){cancelVoice();photoRevision++;loading=false;photo=draft?.photo||null;el('chatInput').value=draft?.text||'';voiceMode=false;draw()}};
draw();
})();
