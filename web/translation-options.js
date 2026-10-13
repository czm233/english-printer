/* Exact-source alternatives only: fuzzy translation-memory matches are not synonyms. */
(function(root){
 const common={
  '冰箱':[['fridge','日常说法'],['refrigerator','完整名称']],
  '杯子':[['cup','茶杯、咖啡杯'],['mug','马克杯'],['glass','玻璃饮水杯']],
  '沙发':[['sofa','沙发'],['couch','日常说法']],
  '电视':[['TV','日常简称'],['television','完整名称']]
 };
 function candidates(source,response,decode=x=>x){
  if(Object.hasOwn(common,source.trim()))return common[source.trim()].map(([word,note])=>({word,note}));
  const values=[response?.responseData?.translatedText,...(response?.matches||[]).filter(m=>m.segment?.trim()===source.trim()).map(m=>m.translation)];
  const seen=new Set();return values.filter(v=>typeof v==='string').map(v=>decode(v).trim().replace(/[.!。！]+$/,'').trim()).filter(word=>{
   const key=word.toLowerCase();if(!/^[a-z][a-z\s'’()-]*$/i.test(word)||seen.has(key))return false;seen.add(key);return true;
  }).map(word=>({word,note:''}));
 }
 const api={candidates,has:source=>Object.hasOwn(common,source.trim())};
 if(typeof module!=='undefined')module.exports=api;root.P0Translations=api;
})(typeof globalThis==='undefined'?this:globalThis);
