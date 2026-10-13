import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import sse from '../web/sse.js';
test('SSE parser preserves split UTF-8, CRLF and multiline data, ignores comments and incomplete events',async()=>{
 const bytes=new TextEncoder().encode(': heartbeat\r\nevent: delta\r\ndata: 你好\r\ndata: /frɪdʒ/\r\n\r\nevent: done\ndata: {}\n\ndata: unfinished');
 const stream=new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close()}}),events=[];
 for await(const e of sse.readEvents(stream))events.push(e);
 assert.deepEqual(events,[{event:'delta',data:'你好\n/frɪdʒ/'},{event:'done',data:'{}'}]);
});
test('custom pronunciation supports Fridge and phrases, rejects unknown or partially parseable words',async()=>{
 const scope={};vm.runInNewContext(await readFile('web/phonetics.js','utf8'),scope);
 const dict=JSON.parse(await readFile('web/pronunciations.json','utf8')),lookup=scope.P0Phonetics.lookup;
 assert.equal(lookup('Fridge',dict),'/fɹɪdʒ/');assert.equal(lookup('fridge',dict),'/fɹɪdʒ/');
 assert.equal(lookup('glass teapot',dict),'/ɡlæs ˈtiˌpɑt/');
 const phrase=lookup('good morning',dict);assert.ok(!phrase.includes(';'));assert.ok(phrase.startsWith('/')&&phrase.endsWith('/'));assert.equal(phrase.split('/').length,3);
 for(const s of ['zzzznotaword','fridge 123','冰箱 fridge',''])assert.equal(lookup(s,dict),'');
});
