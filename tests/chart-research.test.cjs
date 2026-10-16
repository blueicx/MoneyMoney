const test=require('node:test'),assert=require('node:assert/strict');
const modulePath='../src/web/public/chart-research.js';
const scope={market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d'};
function point(id,overrides={}){return {id,...scope,strategy:'macdCross',strategyVersion:'v1',side:'buy',time:1000,status:'confirmed',outcomes:[{horizon:1,status:'matured',returnPct:2,netReturnPct:1,mfePct:3,maePct:-1}],...overrides};}
test('quality matrix deduplicates IDs, excludes forming/other market and separates versions and immature horizons',()=>{
 const {buildQualityMatrix}=require(modulePath);
 const points=Array.from({length:20},(_,i)=>point('p'+i));
 const r=buildQualityMatrix({points:[...points,points[0],point('f',{status:'forming'}),point('x',{market:'crypto'}),point('v',{strategyVersion:'v2',outcomes:[{horizon:1,status:'pending'}]})],...scope});
 assert.equal(r.groups.length,2);assert.equal(r.groups[0].samples,20);assert.equal(r.groups[0].winRate,1);assert.equal(r.duplicatePoints,1);assert.equal(r.groups[1].pending,1);assert.equal(r.groups[1].winRate,null);
 assert.equal(buildQualityMatrix({points:points.slice(0,19),...scope}).groups[0].winRate,null);
 assert.equal(buildQualityMatrix({points:points.map(p=>({...p,outcomes:p.outcomes.map(o=>({...o,netReturnPct:null}))})),...scope}).groups[0].winRate,null);
});
test('matrix rejects invalid outcome numbers and does not treat absent cost as zero',()=>{
 const {buildQualityMatrix}=require(modulePath);
 const r=buildQualityMatrix({points:[point('bad',{outcomes:[{horizon:1,status:'matured',returnPct:NaN,netReturnPct:0,mfePct:3,maePct:-1}]}),point('ok',{outcomes:[{horizon:1,status:'matured',returnPct:2,netReturnPct:null,mfePct:3,maePct:-1}]})],...scope});
 assert.equal(r.groups[0].samples,1);assert.equal(r.groups[0].meanNetReturnPct,null);assert.equal(r.groups[0].invalid,1);assert.equal(r.ranking,null);
});
test('consensus groups same candle and status without turning correlated indicators into a probability',()=>{
 const {explainSignalAgreement}=require(modulePath);
 const r=explainSignalAgreement({points:[point('a'),point('b',{strategy:'emaPullback'}),point('c',{strategy:'cciReversal',side:'sell'}),point('d',{time:2000}),point('e',{status:'forming'})],...scope});
 const row=r.groups.find(g=>g.time===1000&&g.status==='confirmed');assert.equal(row.conflict,true);assert.equal(row.buy.length,2);assert.equal(row.sell.length,1);assert.equal(row.independentEvidenceCount,null);assert.equal(row.probability,null);assert.match(row.reason,/相关/);
});
function bars(n=250){return Array.from({length:n},(_,i)=>{const c=100+i*.03+Math.sin(i/8)*4;return {time:Date.UTC(2025,0,1)+i*86400000,open:c,close:c,high:c+1,low:c-1,volume:100+i%13,closed:true};});}
test('parameter lab is deterministic, hashes inputs and rejects mismatched market, invalid parameters and excessive grids',async()=>{
 const {evaluateParameterLab}=require(modulePath);const input={...scope,bars:bars(),source:'saved test provider',strategy:'macdCross',parameterSets:[{fast:8,slow:21,signal:5},{fast:12,slow:26,signal:9}],horizon:5,costBps:10};
 const r=await evaluateParameterLab(input);assert.equal(r.dataStatus,'historical');assert.equal(r.rows.length,2);assert.match(r.dataHash,/^[a-f0-9]{64}$/);assert.deepEqual(await evaluateParameterLab(input),r);assert.equal(r.ranking,null);assert.equal(r.orderChanges,0);
 assert.notEqual((await evaluateParameterLab({...input,costBps:20})).configurationHash,r.configurationHash);
 assert.equal((await evaluateParameterLab({...input,market:'crypto'})).dataStatus,'unsupported');
 assert.equal((await evaluateParameterLab({...input,parameterSets:[{fast:50,slow:20}]})).dataStatus,'failed');
 assert.equal((await evaluateParameterLab({...input,parameterSets:Array(13).fill({})})).dataStatus,'failed');
});
test('lab purges forward observations crossing split boundaries, uses completed data only and never changes chart settings',async()=>{
 const {evaluateParameterLab}=require(modulePath),data=bars(300);data.at(-1).closed=false;
 const input={...scope,bars:data,source:'saved test provider',strategy:'donchianBreakout',parameterSets:[{lookback:10}],horizon:5,costBps:null};const original=JSON.stringify(input);
 const r=await evaluateParameterLab(input);assert.equal(r.barCount,299);assert.equal(JSON.stringify(input),original);
 for(const split of r.rows[0].splits){assert.equal(split.winRate,null);for(const o of split.observations){assert.ok(o.entryIndex>=split.start&&o.exitIndex<split.end);assert.ok(o.exitIndex>o.entryIndex);}}
 const at=data[220].time;
 const a=await evaluateParameterLab({...input,asOf:at});const b=await evaluateParameterLab({...input,bars:[...data,...bars(10).map((x,i)=>({...x,time:data.at(-1).time+(i+1)*86400000,close:x.close*2,high:x.high*2,low:x.low*2,open:x.open*2}))],asOf:at});assert.deepEqual(a,b);
});
test('cross-timeframe alignment uses only matching identities and candles closed at the cursor time',()=>{
 const {alignTimeframeEvidence}=require(modulePath);const r=alignTimeframeEvidence({market:'stocks',instrument:'stock:us:AAPL',at:10000,series:[{...scope,points:[{time:1000,closeTime:5000,closed:true,value:1},{time:6000,closeTime:11000,closed:true,value:2}]},{...scope,market:'crypto',points:[{time:1000,closeTime:2000,closed:true,value:9}]}]});assert.equal(r.rows[0].point.value,1);assert.equal(r.rows.length,1);assert.equal(r.modelCalls,0);
});
test('asOf lab does not use the final candle close just because its open is before the cutoff',async()=>{
 const {evaluateParameterLab}=require(modulePath),data=bars(250),at=data[220].time;
 const r=await evaluateParameterLab({...scope,bars:data,asOf:at,source:'saved',strategy:'macdCross',parameterSets:[{}],horizon:1,costBps:null});
 assert.equal(r.barCount,220,'the candle opening exactly at asOf is not yet known closed');
});
test('quality matrix uses only pre-entry closed bars for market regime and exports exact reproducible input',async()=>{
 const api=require('../src/web/public/chart-research.js');
 const bars=Array.from({length:100},(_,i)=>({time:i*60000,open:100+i,high:102+i,low:99+i,close:101+i,closed:true}));
 const point={id:'rising',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1m',strategy:'maCross',strategyVersion:'v1',side:'buy',status:'confirmed',time:bars[30].time,outcomes:[{horizon:1,status:'matured',returnPct:1,netReturnPct:0.9,mfePct:1,maePct:0}]};
 const input={market:'stocks',instrument:'stock:us:AAPL',timeframe:'1m',bars,points:[point],source:'test'};
 assert.equal(api.buildQualityMatrix(input).groups[0].regime,'rising');
 assert.equal(api.buildQualityMatrix({...input,bars:bars.map((b,i)=>i>=30?{...b,close:1}:b)}).groups[0].regime,'rising');
 const result=await api.evaluateParameterLab({...input,strategy:'macdCross',parameterSets:[{}],horizon:1,costBps:1});
 assert.deepEqual(result.evidencePack.bars,bars);assert.equal(result.evidencePack.configuration.dataHash,result.dataHash);assert.equal(result.evidencePack.orderChanges,0);
});
test('parameter experiment freezes bars before asynchronous hashing',async()=>{
 const api=require('../src/web/public/chart-research.js');
 const bars=Array.from({length:100},(_,i)=>({time:i*60000,open:100+i,high:102+i,low:99+i,close:101+i,closed:true})),original=JSON.parse(JSON.stringify(bars));
 const pending=api.evaluateParameterLab({market:'stocks',instrument:'stock:us:AAPL',timeframe:'1m',bars,source:'saved',strategy:'macdCross',parameterSets:[{}],horizon:1,costBps:1});
 bars[5].close=0;
 assert.deepEqual((await pending).evidencePack.bars,original);
});
test('unavailable signal outcomes are invalid coverage, not observations waiting to mature',()=>{
 const {buildQualityMatrix}=require(modulePath);
 const r=buildQualityMatrix({...scope,points:[point('gap',{outcomes:[{horizon:1,status:'unavailable',reason:'数据缺口'}]})]});
 assert.equal(r.groups[0].invalid,1);assert.equal(r.groups[0].pending,0);assert.equal(r.groups[0].samples,0);
});
