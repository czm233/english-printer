import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../web/chat-input.js',import.meta.url),'utf8');
function fixture(supported=true){
 class Element extends EventTarget{constructor(){super();this.value='';this.style={};this.attrs={};this.firstElementChild={};this.scrollHeight=44;this.hidden=false}setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}focus(){}setPointerCapture(){}}
 const elements=new Map(),document=new EventTarget();document.getElementById=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
 const sessions=[];
 class Speech {constructor(){sessions.push(this)}start(){}stop(){this.stopped=true}abort(){this.aborted=true}}
 const window=new EventTarget();if(supported)window.SpeechRecognition=Speech;
 const errors=[];document.addEventListener('chat-input-error',e=>errors.push(e.detail));
 vm.runInNewContext(source,{window,document,Event,CustomEvent,setTimeout,clearTimeout});
 const el=id=>document.getElementById(id);
 const press=()=>el('holdToTalk').onkeydown({key:' ',repeat:false,preventDefault(){}});
 const release=()=>el('holdToTalk').onkeyup({key:' ',preventDefault(){}});
 return {window,document,sessions,errors,el,press,release};
}
test('hold-to-talk yields editable text, stops on release and never sends automatically',()=>{
 const f=fixture();f.el('chatInput').value='原有草稿';f.el('voiceToggle').onclick();f.press();const r=f.sessions[0];r.onstart();r.onresult({results:[[{transcript:'冰箱'}]]});f.release();assert.equal(r.stopped,true);r.onend();
 assert.equal(f.el('chatInput').value,'原有草稿 冰箱');assert.equal(f.el('chatInput').hidden,false);assert.equal(f.window.P0ChatInput.pending,false);
});
test('release before microphone starts and navigation cancellation cannot leak later recognition',()=>{
 const f=fixture();f.el('voiceToggle').onclick();f.press();const r=f.sessions[0];f.release();r.onstart();assert.equal(r.stopped,true);
 f.document.dispatchEvent(new CustomEvent('page-change',{detail:'print'}));assert.equal(r.aborted,true);r.onresult({results:[[{transcript:'迟到结果'}]]});r.onend();assert.equal(f.el('chatInput').value,'');assert.equal(f.window.P0ChatInput.pending,false);
});
test('unsupported browser and denied microphone give actionable errors and keep drafts',()=>{
 const unsupported=fixture(false);unsupported.press();assert.match(unsupported.errors.at(-1),/不支持语音/);
 const f=fixture();f.el('chatInput').value='保留';f.press();const r=f.sessions[0];r.onerror({error:'not-allowed'});r.onend();assert.match(f.errors.at(-1),/权限/);assert.equal(f.el('chatInput').value,'保留');assert.equal(f.window.P0ChatInput.pending,false);
});
