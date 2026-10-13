import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import phonetics from '../web/phonetics.js';
const source=await readFile(new URL('../web/print-cards.js',import.meta.url),'utf8');
function planner(limit,lookup=async w=>'/'+w.replaceAll('-',' ')+'/'){
 const scope={window:{},document:{getElementById:()=>({addEventListener(){}}),addEventListener(){}},P0Phonetics:phonetics,phonetics:lookup,
  ctx:{measureText:text=>({width:text.length})},validate:(word,ipa)=>Math.max(word.length,ipa.length)>limit?'内容过长':''};
 vm.runInNewContext(source,scope);return async value=>JSON.parse(JSON.stringify(await scope.window.P0PrintCards.plan(value)));
}
test('split preserves compounds, order and evenly distributes equally short plans',async()=>{
 const plan=planner(14);
 assert.deepEqual((await plan({word:'flip-top water bottle',ipa:'/flip top water bottle/'})).map(p=>p.word),['flip-top','water bottle']);
 assert.deepEqual((await planner(14)({word:'aa bb cc dd ee',ipa:'/aa bb cc dd ee/'})).map(p=>p.word),['aa bb','cc dd ee']);
 const oversized={word:'extra-long-compound word',ipa:'/extra long compound word/'};
 assert.deepEqual(await plan(oversized),[oversized]);
});
test('fallback IPA keeps compound components aligned and rejects ambiguous missing pronunciation',async()=>{
 const plan=planner(13,async()=> '');
 for(const ipa of ['/flɪp tɑp wɔtɚ bɑtəl/','/flɪp;tɑp;wɔtɚ;bɑtəl/']){
  assert.deepEqual(await plan({word:'flip-top water bottle',ipa}),[{word:'flip-top',ipa:'/flɪp tɑp/'},{word:'water bottle',ipa:'/wɔtɚ bɑtəl/'}]);
 }
 const invalid={word:'flip-top water bottle',ipa:'/flɪp tɑp/'};
 assert.deepEqual(await plan(invalid),[invalid]);
});
