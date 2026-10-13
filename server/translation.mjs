import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createTranslator({configPath,fetcher=fetch,timeout=8000}={}){
 const cache=new Map();
 return async function translate(body){
  if(!body||typeof body.q!=='string'||!body.q.trim()||body.q.length>120||!['zh-en','en-zh'].includes(body.direction))throw fail(400,'翻译内容或方向无效。');
  let c;try{c=JSON.parse(await readFile(configPath,'utf8'))}catch{throw fail(503,'百度翻译配置不可用，请检查本机配置文件。')}
  if(!c.appId?.trim()||!c.secretKey?.trim())throw fail(503,'请填写百度通用翻译 APP ID 和密钥。');
  const q=body.q.trim(),key=JSON.stringify([c.appId,body.direction,q]),cached=cache.get(key);
  if(cached&&Date.now()-cached.time<86400000)return {...cached.value,cached:true};
  const [from,to]=body.direction.split('-'),salt=randomUUID(),sign=createHash('md5').update(c.appId.trim()+q+salt+c.secretKey.trim()).digest('hex');
  const start=performance.now();let r,d;
  try{
   r=await fetcher('https://fanyi-api.baidu.com/api/trans/vip/translate',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({q,from,to,appid:c.appId.trim(),salt,sign}),signal:AbortSignal.timeout(timeout),redirect:'error'});
   d=await r.json();
  }catch{throw fail(504,'百度翻译请求超时或网络异常，请重试。')}
  if(!r.ok)throw fail(502,'百度翻译服务暂不可用，请重试。');
  if(d.error_code){const errors={'52003':'百度翻译账号未授权，请检查服务开通状态。','54001':'百度翻译签名失败，请检查 APP ID 和密钥。','54003':'百度翻译请求过于频繁，请稍后重试。','54004':'百度翻译余额或额度不足，请检查账号。','58002':'百度翻译服务未开通，请检查账号。'};throw fail(502,errors[d.error_code]||'百度翻译失败，请检查账号服务状态后重试。')}
  const rows=d.trans_result;
  if(!Array.isArray(rows)||!rows.length||rows.some(x=>typeof x.dst!=='string'||!x.dst.trim()||x.dst.length>2000))throw fail(502,'百度未返回有效译文，请重试。');
  const value={text:rows.map(x=>x.dst).join('\n'),provider:'baidu',ms:Math.round(performance.now()-start)};
  if(cache.size>=200)cache.delete(cache.keys().next().value);cache.set(key,{time:Date.now(),value});return {...value,cached:false};
 };
}
