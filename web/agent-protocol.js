(()=>{
const phonetics=typeof module!=='undefined'&&module.exports?require('./phonetics.js'):globalThis.P0Phonetics;
function failure(code,message){return Object.assign(Error(message),{diagnosticCode:code})}
function input(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['word','ipa'].includes(k)))throw failure(6101,'打印参数无效，请让 AI 重新生成卡片。');
 const {word,ipa}=value;
 if(typeof word!=='string'||word.length>120||!word.trim()||! /^[A-Za-z]+(?:['’.-]?[A-Za-z]+)*(?:[ -][A-Za-z]+(?:['’.-]?[A-Za-z]+)*)*$/.test(word.trim()))throw failure(6102,'打印英文格式无效，请重新选词。');
 if(typeof ipa!=='string'||ipa.length>240)throw failure(6103,'音标格式无效，请让 AI 重新生成。');
 const normalized=phonetics.format(ipa).slice(1,-1).replace(/['’]/g,'ˈ');
 if(!normalized||! /[a-zæðθŋøœ\u0250-\u02af]/u.test(normalized)||! /^[a-zæðθŋøœ\u0250-\u02ff\u0300-\u036f\u1d00-\u1d7f ;ˈˌːˑ.()ɡ]+$/u.test(normalized))throw failure(6103,'音标格式无效，请让 AI 重新生成。');
 return {word:word.trim(),ipa:'/'+normalized+'/'};
}
function choices(value){
 const bad=()=>{throw failure(6110,'选择选项无效，请重试。')};
 const plain=(text,max)=>typeof text==='string'&&text.trim()&&text.length<=max&&!/[<>\u0000-\u001f]/.test(text);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['question','options','purpose','labels'].includes(k))||!plain(value.question,160)||!Array.isArray(value.options)||value.options.length<2||value.options.length>4||value.options.some(v=>!plain(v,80)))bad();
 const options=value.options.map(v=>v.trim());if(new Set(options.map(v=>v.toLowerCase())).size!==options.length)bad();
 if(value.purpose!==undefined&&!['clarify','label'].includes(value.purpose))bad();
 if(value.purpose==='label'){
  if(!Array.isArray(value.labels)||value.labels.length!==options.length)bad();
  const labels=value.labels.map(input);if(labels.some((v,i)=>v.word!==options[i]))bad();
  return {question:value.question.trim(),options,purpose:'label',labels};
 }
 if(value.labels!==undefined)bad();
 return {question:value.question.trim(),options};
}
function toolInput(name,value){if(name==='print_label')return input(value);if(name==='offer_choices')return choices(value);throw failure(6104,'未知的助手工具。')}
class Collector {
 constructor(){this.blocks=new Map()}
 accept(event){
  if(event.type==='tool_start'){
   if(this.blocks.size>=12||this.blocks.has(event.index)||[...this.blocks.values()].some(b=>b.id===event.id)||!['print_label','offer_choices'].includes(event.name)||typeof event.id!=='string'||! /^[\w-]{1,200}$/.test(event.id)||!Number.isInteger(event.index))throw failure(6104,'打印工具调用无效，请重试。');
   this.blocks.set(event.index,{id:event.id,name:event.name,input:event.input,json:'',closed:false});
  }else if(event.type==='tool_delta'){
   const b=this.blocks.get(event.index);if(!b||b.closed||typeof event.json!=='string')throw failure(6105,'打印参数流不完整，请重试。');b.json+=event.json;if(b.json.length>4096)throw failure(6106,'打印参数过长。');
  }else if(event.type==='tool_end'){
   const b=this.blocks.get(event.index);if(b)b.closed=true;
  }
 }
 finish(reason){
  if(!this.blocks.size){if(reason==='tool_use')throw failure(6107,'模型未返回有效打印工具，请检查模型兼容性。');return []}
  if(reason!=='tool_use')throw failure(6108,'打印参数未完整生成，请重试。');
  if([...this.blocks.values()].some(b=>b.name==='offer_choices')&&this.blocks.size!==1)throw failure(6110,'请一次只提供一组选择。');
  return [...this.blocks.values()].map(b=>{if(!b.closed)throw failure(6108,'打印参数未完整生成，请重试。');let value;try{value=b.json?JSON.parse(b.json):b.input}catch{throw failure(6109,'打印参数格式无效，请重试。')}return {type:'tool_use',id:b.id,name:b.name,input:toolInput(b.name,value)}});
 }
}
const api={input,choices,toolInput,Collector};if(typeof module!=='undefined'&&module.exports)module.exports=api;else globalThis.P0Agent=api;
})();
