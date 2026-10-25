const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const {translateEnglishTitles}=require('../src/features/market-translation');
test('an optional translation deadline aborts active reads, stops the queue and retains cached titles',async()=>{
 const original=global.fetch;let slow=false,calls=0,aborts=0;
 global.fetch=async(url,options={})=>{
  if(String(url).includes('/text?'))return{ok:true,headers:{getSetCookie:()=>['fixture=session']},text:async()=>'{"uuid":"fixture","secretCode":123}'};
  calls++;
  if(slow)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,100);const abort=()=>{clearTimeout(timer);aborts++;reject(Object.assign(Error('cancelled'),{name:'AbortError'}));};if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});});
  return {ok:true,json:async()=>({data:{translate:{dit:'已缓存译文',errorCode:'0'}}})};
 };
 try {
  await translateEnglishTitles(['Budget cached title'],1);
  slow=true;calls=0;
  const result=await translateEnglishTitles(['Budget cached title',...Array.from({length:8},(_,i)=>'Budget pending title '+i)],9,{budgetMs:30});
  assert.equal(result.get('budget cached title'),'已缓存译文');
  assert.equal(calls,3,'deadline must prevent remaining titles or provider fallbacks starting');
  assert.equal(aborts,3,'all active provider reads must be aborted, not left running behind a Promise.race');
  assert.equal(result.has('Budget pending title 0'),false,'missing translation preserves the original title');
  await new Promise(r=>setTimeout(r,120));assert.equal(calls,3,'no background queue after return');
 } finally {global.fetch=original;}
});

test('existing callers without a deadline still receive the complete requested batch',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;return {ok:true,json:async()=>({data:{translate:{dit:'完整译文',errorCode:'0'}}})};};
 try {const titles=Array.from({length:5},(_,i)=>'Compatibility budget title '+i),result=await translateEnglishTitles(titles,5);for(const title of titles)assert.equal(result.get(title),'完整译文');assert.equal(calls,5);}finally{global.fetch=original;}
});

test('the deadline also aborts the final fallback and invalid budgets never start a provider call',async()=>{
 const original=global.fetch;let active=0,aborts=0;global.fetch=async(url,options={})=>{
  if(String(url).includes('/text?'))return{ok:true,headers:{getSetCookie:()=>['fixture=session']},text:async()=>'{"uuid":"fixture","secretCode":123}'};
  if(!String(url).includes('mymemory'))throw Error('fixture provider unavailable');
  active++;await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,200);const abort=()=>{clearTimeout(timer);aborts++;reject(options.signal.reason);};if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true});});
  throw Error('fixture must be cancelled');
 };
 try {const result=await translateEnglishTitles(['Fallback budget title'],1,{budgetMs:30});assert.equal(active,1);assert.equal(aborts,1);assert.equal(result.has('Fallback budget title'),false);for(const budgetMs of [0,-1,NaN,Infinity,1.5,10001])await assert.rejects(translateEnglishTitles([],0,{budgetMs}),/budget/);}finally{global.fetch=original;}
});
