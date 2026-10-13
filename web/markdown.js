(()=>{
const tags=['p','br','strong','em','del','s','ul','ol','li','blockquote','pre','code','h1','h2','h3','h4','h5','h6','hr','a','table','thead','tbody','tr','th','td'];
function render(target,text){
  // Model content is untrusted. Only sanitized Markdown output enters the DOM.
  const positions=[...target.querySelectorAll('.table-scroll')].map(e=>e.scrollLeft);
  target.innerHTML=DOMPurify.sanitize(marked.parse(text,{gfm:true,breaks:true}),{ALLOWED_TAGS:tags,ALLOWED_ATTR:['href','title','start','align'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
  target.querySelectorAll('a').forEach(a=>{const href=a.getAttribute('href')||'';if(!/^https?:\/\//i.test(href)){a.removeAttribute('href');return}a.target='_blank';a.rel='noopener noreferrer'});
  target.querySelectorAll('table').forEach((table,i)=>{const wrap=document.createElement('div');wrap.className='table-scroll';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','表格，可左右滑动');table.before(wrap);wrap.append(table);wrap.scrollLeft=positions[i]||0});
  // Normalize only IPA text nodes; preserve links, code and the stored conversation.
  const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode())if(!node.parentElement.closest('a,pre,code'))node.textContent=P0Phonetics.inline(node.textContent);
  P0Speech.decorate(target);
}
globalThis.P0Markdown={render};
})();
