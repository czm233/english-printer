import {test} from 'node:test';
import assert from 'node:assert/strict';
import ipa from '../web/phonetics.js';
import agent from '../web/agent-protocol.js';
test('legacy and model phrase IPA use spaces without losing stress or length marks',()=>{
 for(const value of ['/ɡlæs; ˈtiˌpɑt/',' /ɡlæs；  ˈtiˌpɑt/ ','ɡlæs ˈtiˌpɑt']){
  assert.equal(ipa.format(value),'/ɡlæs ˈtiˌpɑt/');
  assert.equal(agent.input({word:'glass teapot',ipa:value}).ipa,'/ɡlæs ˈtiˌpɑt/');
 }
 assert.equal(ipa.format('/ˈtiː; pɑt/'),'/ˈtiː pɑt/');
 assert.equal(ipa.format(''),'');
 assert.equal(ipa.inline('解释；说明 /ɡlæs; ˈtiˌpɑt/；结束'),'解释；说明 /ɡlæs ˈtiˌpɑt/；结束');
 assert.throws(()=>agent.input({word:'glass teapot',ipa:'/ɡlæs, ˈtiˌpɑt/'}));
 assert.throws(()=>agent.input({word:'glass teapot',ipa:'/ɡlæs|ˈtiˌpɑt/'}));
});
