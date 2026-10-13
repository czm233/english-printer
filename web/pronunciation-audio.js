// Buttons are created by the App after sanitization, never by model HTML.
(()=>{
function button(text){const b=document.createElement('button');b.type='button';b.className='icon-button pronunciation-audio';b.dataset.speakText=text;b.setAttribute('aria-label','朗读 '+text);b.disabled=!('speechSynthesis' in window);const icon=document.createElement('i');icon.className='icon icon-volume';icon.setAttribute('aria-hidden','true');b.append(icon);return b}
function speak(text){if(!text?.trim()||!('speechSynthesis' in window))return;stopSpeech();const u=new SpeechSynthesisUtterance(text);u.lang='en-US';u.rate=.85;speechSynthesis.speak(u)}
document.addEventListener('click',event=>{const b=event.target.closest('[data-speak-text]');if(b&&!b.disabled)speak(b.dataset.speakText)});
function decorate(target){
 for(const node of target.querySelectorAll('p,li,td')){
  if(!/\/[a-zæðθŋøœ\u0250-\u02ff][^/\n]{0,240}\//u.test(node.textContent))continue;
  const context=node.closest('tr')?.querySelector('td')?.textContent||node.textContent.split('/')[0];
  const words=context.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*(?: +[A-Za-z]+(?:['’-][A-Za-z]+)*)*/g);
  if(words?.length)node.append(button(words.at(-1)));
 }
}
document.getElementById('speakSample').onclick=()=>speak(document.getElementById('sampleWord').value);
window.P0Speech={button,speak,decorate};
})();
