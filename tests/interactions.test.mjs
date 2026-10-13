import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../web/interactions.js',import.meta.url),'utf8');
test('chrome suppresses native menus while text-node message selections and editing remain usable',()=>{
 const listeners={};
 class Element {constructor(kind){this.kind=kind}closest(selector){
  if(selector.includes('button')&&['button','image'].includes(this.kind))return this;
  if(selector.includes('textarea')&&this.kind==='input')return this;
  if(selector.includes('.message')&&['message','image'].includes(this.kind))return this;
  return null;
 }}
 vm.runInNewContext(source,{Element,document:{addEventListener:(name,fn)=>listeners[name]=fn}});
 const blocked=(name,target)=>{let prevented=false;listeners[name]({target,preventDefault(){prevented=true}});return prevented};
 for(const kind of ['button','label','image'])for(const name of ['contextmenu','selectstart','dragstart'])assert.equal(blocked(name,new Element(kind)),true,`${kind} ${name}`);
 for(const kind of ['input','message'])for(const name of ['contextmenu','selectstart']){
  const element=new Element(kind);
  assert.equal(blocked(name,element),false);
  assert.equal(blocked(name,{parentElement:element}),false,'selection can target a text node');
 }
 assert.equal(blocked('dragstart',new Element('message')),true);
 assert.equal(blocked('dragstart',new Element('input')),false);
});

test('Done dismisses the textarea keyboard without newline, preserving IME and chat',()=>{
 const listeners={};class Element{constructor(done=true){this.done=done;this.blurs=0}matches(){return this.done}blur(){this.blurs++}}
 vm.runInNewContext(source,{Element,document:{addEventListener:(name,fn)=>listeners[name]=fn}});
 const field=new Element(),chat=new Element(false);
 function fire(name,target,extra={}){const e={target,prevented:false,preventDefault(){this.prevented=true},...extra};listeners[name](e);return e}
 assert.equal(fire('keydown',field,{key:'Enter'}).prevented,true);assert.equal(field.blurs,1);
 for(const inputType of ['insertLineBreak','insertParagraph'])assert.equal(fire('beforeinput',field,{inputType}).prevented,true);
 assert.equal(fire('keydown',chat,{key:'Enter'}).prevented,false);
 fire('compositionstart',field);assert.equal(fire('keydown',field,{key:'Enter'}).prevented,false);assert.equal(fire('beforeinput',field,{inputType:'insertLineBreak'}).prevented,false);fire('compositionend',field);
 assert.equal(fire('keydown',field,{key:'Enter',keyCode:229}).prevented,false);
 assert.equal(fire('beforeinput',field,{inputType:'insertParagraph',isComposing:true}).prevented,false);
 assert.equal(fire('beforeinput',field,{inputType:'insertFromPaste'}).prevented,false);
 assert.equal(fire('keydown',field,{key:'Enter'}).prevented,true);
});
