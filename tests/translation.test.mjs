import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {createTranslator} from '../server/translation.mjs';
test('Baidu signs on server, caches per direction, validates input and sanitizes errors',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'p0-translate-')),configPath=join(dir,'config.json');
 try{
 await writeFile(configPath,JSON.stringify({appId:'test-app',secretKey:'test-only-secret'}),{mode:0o600});let calls=0;
 const translate=createTranslator({configPath,fetcher:async(url,options)=>{calls++;assert.equal(new URL(url).hostname,'fanyi-api.baidu.com');const p=options.body;assert.equal(p.get('sign'),createHash('md5').update('test-app'+p.get('q')+p.get('salt')+'test-only-secret').digest('hex'));assert.equal(options.redirect,'error');return {ok:true,json:async()=>({trans_result:[{dst:'glass teapot'}]})}}});
 assert.equal((await translate({q:'茶壶',direction:'zh-en'})).cached,false);assert.equal((await translate({q:'茶壶',direction:'zh-en'})).cached,true);assert.equal(calls,1);
 await translate({q:'茶壶',direction:'en-zh'});assert.equal(calls,2);
 await assert.rejects(()=>translate({q:'a',direction:'invalid'}),/无效/);
 const bad=createTranslator({configPath,fetcher:async()=>({ok:true,json:async()=>({error_code:'54001',error_msg:'test-only-secret'})})});await assert.rejects(()=>bad({q:'a',direction:'zh-en'}),e=>e.message.includes('签名失败')&&!e.message.includes('test-only-secret'));
 const network=createTranslator({configPath,fetcher:async()=>{throw Error('test-only-secret')}});await assert.rejects(()=>network({q:'a',direction:'zh-en'}),e=>e.status===504&&!e.message.includes('test-only-secret'));
 }finally{await rm(dir,{recursive:true,force:true})}
});
