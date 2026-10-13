// CMU ARPABET → broad American IPA. Reject unknown tokens rather than invent a pronunciation.
(()=>{
const phones={AA:'ɑ',AE:'æ',AH:'ʌ',AO:'ɔ',AW:'aʊ',AY:'aɪ',B:'b',CH:'tʃ',D:'d',DH:'ð',EH:'ɛ',ER:'ɝ',EY:'eɪ',F:'f',G:'ɡ',HH:'h',IH:'ɪ',IY:'i',JH:'dʒ',K:'k',L:'l',M:'m',N:'n',NG:'ŋ',OW:'oʊ',OY:'ɔɪ',P:'p',R:'ɹ',S:'s',SH:'ʃ',T:'t',TH:'θ',UH:'ʊ',UW:'u',V:'v',W:'w',Y:'j',Z:'z',ZH:'ʒ'};
function arpabet(raw){const tokens=raw.split(' '),vowels=tokens.filter(t=>/[012]$/.test(t)).length;let out='',onset=0;for(const token of tokens){const key=token.replace(/[012]/g,''),stress=token.slice(-1);if(!phones[key])return '';if(/[012]/.test(stress)){if(vowels>1&&stress!=='0')out=out.slice(0,onset)+(stress==='1'?'ˈ':'ˌ')+out.slice(onset);out+=key==='AH'&&stress==='0'?'ə':key==='ER'&&stress==='0'?'ɚ':phones[key];onset=out.length}else out+=phones[key]}return out}
function lookup(english,dict){const normalized=english.toLowerCase().replace(/’/g,"'").trim();if(!normalized||/[^a-z\s'.,!?;:()\-]/.test(normalized))return '';const words=normalized.match(/[a-z]+(?:'[a-z]+)*/g)||[];if(!words.length||words.length>12)return '';const result=words.map(w=>Object.hasOwn(dict,w)?arpabet(dict[w]):'');return result.every(Boolean)?'/'+result.join(' ')+'/':''}
// One shared display convention; semicolons are accepted only as legacy input.
function format(ipa){const inner=ipa.trim().replace(/^\/+|\/+$/g,'').replace(/[;；\s]+/g,' ').trim();return inner?'/'+inner+'/':''}
function inline(text){return text.replace(/\/[a-zæðθŋøœ\u0250-\u02ff\u0300-\u036f\u1d00-\u1d7f ;；ˈˌːˑ.()ɡ]+\//gu,format)}
const api={arpabet,lookup,format,inline};globalThis.P0Phonetics=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
