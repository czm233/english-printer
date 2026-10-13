// App chrome is not document text; editing and message copying remain available.
(()=>{
 // enterkeyhint labels the key; textarea still inserts a newline unless handled.
 const composingFields=new WeakSet();
 const doneField=target=>target instanceof Element&&target.matches('textarea[enterkeyhint="done"]');
 document.addEventListener('compositionstart',event=>{if(doneField(event.target))composingFields.add(event.target)});
 document.addEventListener('compositionend',event=>{if(doneField(event.target))composingFields.delete(event.target)});
 function finish(event){
  if(!doneField(event.target)||event.isComposing||composingFields.has(event.target)||event.keyCode===229)return;
  event.preventDefault();event.target.blur();
 }
 document.addEventListener('keydown',event=>{if(event.key==='Enter')finish(event)});
 // iOS software keyboards may deliver beforeinput without an Enter keydown.
 document.addEventListener('beforeinput',event=>{
  if(event.inputType==='insertLineBreak'||event.inputType==='insertParagraph')finish(event);
 });
 const editable='textarea,input:not([readonly]):not([disabled]):not([type="range"]):not([type="file"]):not([type="radio"])';
 const canCopy=target=>{
  if(!(target instanceof Element))target=target?.parentElement;
  if(!target)return false;
  if(target.closest('button,[role="tab"],img,canvas,.icon,.print-card'))return false;
  return !!target.closest(editable+',.message');
 };
 document.addEventListener('contextmenu',event=>{if(!canCopy(event.target))event.preventDefault()});
 document.addEventListener('selectstart',event=>{if(!canCopy(event.target))event.preventDefault()});
 document.addEventListener('dragstart',event=>{
  if(!(event.target instanceof Element)||!event.target.closest(editable))event.preventDefault();
 });
})();
