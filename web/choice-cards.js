// App-created choices send visible text only; they never reach the device channel.
(()=>{
const cards=new Map(),list=document.getElementById('messages');let locked=false;
function sync(blocked=locked){
 locked=blocked;
 list.querySelectorAll('[data-choice-card]').forEach(node=>{
  const card=cards.get(node.dataset.choiceCard);if(!card)return;
  node.querySelectorAll('[data-choice-index]').forEach(button=>{
   button.disabled=locked||card.closed;
   button.setAttribute('aria-pressed',String(Number(button.dataset.choiceIndex)===card.selected));
  });
 });
}
function create(tool,parent){
 const value=P0Agent.choices(tool.input),id=crypto.randomUUID();
 cards.set(id,{...value,selected:null,closed:false});
 render(id,parent);return id;
}
function render(id,parent){
 const value=cards.get(id);if(!value)return;
 const node=document.createElement('section');node.className='choice-card';node.dataset.choiceCard=id;
 const question=document.createElement('p');question.id='choice-'+id;question.textContent=value.question;
 const options=document.createElement('div');options.className='choice-options';options.setAttribute('role','group');options.setAttribute('aria-labelledby',question.id);
 value.options.forEach((label,index)=>{const button=document.createElement('button');button.type='button';button.className='speak';button.textContent=label;button.dataset.choiceIndex=index;options.append(button)});
 node.append(question,options);parent.append(node);sync();return id;
}
function expire(){list.querySelectorAll('[data-choice-card]').forEach(node=>{const card=cards.get(node.dataset.choiceCard);if(card)card.closed=true});sync()}
function result(id){const card=cards.get(id);return card?.selected!=null?'用户选择：'+card.options[card.selected]:card?.closed?'用户通过其他回复继续，选项已失效。':'等待用户选择，也可直接输入回答。'}
function restore(values){cards.clear();for(const [id,v] of values){const value=P0Agent.choices({question:v.question,options:v.options,...(v.purpose?{purpose:v.purpose,labels:v.labels}:{})});if(typeof id!=='string'||!(v.selected===null||Number.isInteger(v.selected)&&v.selected>=0&&v.selected<value.options.length))throw Error('Invalid choice');cards.set(id,{...value,selected:v.selected,closed:!!v.closed})}}
const api={create,render,sync,expire,result,snapshot:()=>[...cards],restore,onSelect:null};
list.addEventListener('click',async event=>{
 const button=event.target.closest('[data-choice-index]');if(!event.isTrusted||!button||button.disabled||locked)return;
 const card=cards.get(button.closest('[data-choice-card]')?.dataset.choiceCard),index=Number(button.dataset.choiceIndex);
 if(!card||card.closed||!Number.isInteger(index)||!card.options[index])return;
 card.selected=index;card.closed=true;sync();
 let accepted=false;try{accepted=await api.onSelect?.(card.options[index],card.purpose==='label'?card.labels[index]:null)}catch{}
 if(accepted!==true){card.selected=null;card.closed=false;sync()}
});
window.P0Choices=api;
})();
