const test=require('node:test'),assert=require('node:assert/strict');
const {sourceObservation,evaluatePublicSourceEvidence}=require('../scripts/lib/soak-source-evidence.cjs');
const now=Date.parse('2026-10-26T03:00:00Z');
function payloads(at=now){return {stocks:{success:true,source:'Yahoo',dataStatus:'delayed',updatedAt:new Date(at).toISOString(),data:[{close:10,time:at-60*3600000}]},crypto:{success:true,source:'Binance Public',dataStatus:'cached',updatedAt:new Date(at).toISOString(),data:[{close:100,time:at-3600000}]},options:{success:true,source:'Deribit Public API',dataStatus:'live',data:{fetchedAt:new Date(at).toISOString(),spot:100,expiries:[{rows:[{instrumentName:'BTC',bidPrice:1,askPrice:2}]}]}},prediction:{success:true,data:{updatedAt:new Date(at).toISOString(),markets:[{platform:'Kalshi',yesPrice:.5}],sources:{kalshi:{ok:true,count:1,checkedAt:new Date(at).toISOString()}}}}};}
const network=(at=now)=>['query1.finance.yahoo.com','api.binance.com','www.deribit.com','api.elections.kalshi.com'].map(host=>({phase:'response',allowed:true,host,status:200,at}));
const observations=(at=now,ms=100)=>Object.entries(payloads(at)).map(([m,p])=>sourceObservation(m,p,200,ms,at));
test('public-source acceptance rejects no traffic, all failures, fixture data, and heartbeat gaps',()=>{
 assert.equal(evaluatePublicSourceEvidence([],[],86400000).status,'failed');
 const failed=['stocks','crypto','options','prediction'].map(m=>({market:m,measuredMs:1,ok:false}));assert.equal(evaluatePublicSourceEvidence(failed,[],1).status,'failed');
 assert.equal(sourceObservation('stocks',{...payloads().stocks,source:'ISOLATED_FIXTURE'},200,1,now).ok,false);
 const samples=[...observations(now,1),...observations(now+400000,400001)];assert.match(evaluatePublicSourceEvidence(samples,network(),400001).reasons.join(),/gap/);
});
test('valid quote evidence and recent same-provider responses are both required for every rolling source window',()=>{
 const samples=observations();assert.ok(samples.every(s=>s.ok));assert.equal(evaluatePublicSourceEvidence(samples,[],100).status,'failed');assert.equal(evaluatePublicSourceEvidence(samples,network(),100).status,'passed');
 const spoof=network().map(x=>({...x,host:x.host+'.evil.example'}));assert.equal(evaluatePublicSourceEvidence(samples,spoof,100).status,'failed');
 const binancePublic=network().map(x=>({...x,host:x.host==='api.binance.com'?'data-api.binance.vision':x.host}));assert.equal(evaluatePublicSourceEvidence(samples,binancePublic,100).status,'passed');
 assert.equal(evaluatePublicSourceEvidence(samples,network().map(({at,...x})=>x),100).status,'failed');
 const long=Array.from({length:25},(_,i)=>observations(now+i*60000,i*60000)).flat();assert.equal(evaluatePublicSourceEvidence(long,network(),24*60000).status,'failed','one initial request cannot prove a longer run');
 const freshNetwork=Array.from({length:25},(_,i)=>network(now+i*60000)).flat();assert.equal(evaluatePublicSourceEvidence(long,freshNetwork,24*60000).status,'passed');
});
test('ancient, missing, future and unknown provenance fail; fetch time never replaces bar time',()=>{
 assert.equal(sourceObservation('stocks',payloads(now+1).stocks,200,1,now).ok,false,'even a future millisecond cannot prove an observed fetch');
 for(const m of ['stocks','crypto','options','prediction']){const p=payloads(now-86400000)[m];assert.equal(sourceObservation(m,p,200,1,now).ok,false);assert.equal(sourceObservation(m,payloads(now+60000)[m],200,1,now).ok,false);}
 for(const m of ['stocks','crypto']){const p=payloads()[m];p.data[0].time=Date.parse('2001-01-01');assert.equal(sourceObservation(m,p,200,1,now).ok,false);p.data[0].time=now+60000;assert.equal(sourceObservation(m,p,200,1,now).ok,false);}
 const p=payloads().crypto;delete p.updatedAt;assert.equal(sourceObservation('crypto',p,200,1,now).ok,false);
 const s=observations()[0];assert.equal(s.sourceTime,null);assert.notEqual(s.latestBarAt,s.serverFetchedAt);assert.ok(s.fetchAgeMs===0);
});
test('mixed prediction results require network proof for every included provider',()=>{
 const p=payloads().prediction;p.data.markets.push({platform:'Polymarket',yesPrice:.3});p.data.sources.polymarket={ok:true,count:1,checkedAt:new Date(now).toISOString()};const mixed=sourceObservation('prediction',p,200,100,now),samples=observations().filter(x=>x.market!=='prediction').concat(mixed);
 assert.equal(evaluatePublicSourceEvidence(samples,network(),100).status,'failed');
 assert.equal(evaluatePublicSourceEvidence(samples,network().concat({phase:'response',allowed:true,host:'gamma-api.polymarket.com',status:200,at:now}),100).status,'passed');
 p.data.sources.kalshi.ok=false;assert.equal(sourceObservation('prediction',p,200,100,now).ok,false);p.data.sources.kalshi.ok=true;
 p.data.markets.push({platform:'Unknown source',yesPrice:.5});assert.equal(sourceObservation('prediction',p,200,100,now).ok,false);
});
