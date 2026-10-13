import {test} from 'node:test';
import assert from 'node:assert/strict';
import options from '../web/translation-options.js';
test('translation alternatives exclude fuzzy matches, duplicate casing and invalid results',()=>{
 const response={responseData:{translatedText:'desk'},matches:[{segment:'桌子',translation:'Desk.'},{segment:'桌子',translation:'table'},{segment:'桌子上的书',translation:'book on the desk'},{segment:'桌子',translation:'<script>'}]};
 assert.deepEqual(options.candidates('桌子',response).map(x=>x.word),['desk','table']);
 assert.deepEqual(options.candidates('冰箱',{responseData:{translatedText:'refrigerators'}}).map(x=>x.word),['fridge','refrigerator']);
 assert.deepEqual(options.candidates('未知',{}),[]);
});
