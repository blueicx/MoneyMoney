const test=require('node:test'),assert=require('node:assert/strict'),api=require('../src/web/public/chart-research');
const scope={market:'stocks',instrument:'stock:us:AAPL',timeframe:'1m',source:'saved'},bars=Array.from({length:110},(_,i)=>({time:i*60000,open:100+i,close:100+i,high:101+i,low:99+i,volume:100,closed:true}));
const p=(id,i=30)=>({...scope,id,strategy:'maCross',strategyVersion:'v1',side:'buy',time:bars[i].time,price:bars[i].close,status:'confirmed'});
test('strategy regime map groups only pre-entry environments and recomputes matured outcomes from exact saved bars',()=>{
 const input={...scope,bars,points:[p('one'),p('two',40),p('immature',109),{...p('bad'),market:'crypto'},p('one')],horizon:5,costBps:10};
 const r=api.buildStrategyRegimeMap(input);assert.equal(r.groups.length,1);assert.equal(r.groups[0].samples,2);assert.equal(r.groups[0].pending,1);assert.equal(r.groups[0].winRate,null);assert.equal(r.groups[0].trend,'rising');assert.equal(r.groups[0].volatility,'low');assert.equal(r.ranking,null);assert.equal(r.orderChanges,0);
 const less=api.buildStrategyRegimeMap({...input,asOf:bars[42].time});assert.equal(less.groups[0].samples,1);assert.equal(less.groups[0].pending,1);
 const missingCost=api.buildStrategyRegimeMap({...input,costBps:null});assert.equal(missingCost.groups[0].meanNetReturnPct,null);
 const invalid=api.buildStrategyRegimeMap({...input,bars:bars.map((b,i)=>i===33?{...b,gap:true}:b)});assert.equal(invalid.groups[0].unavailable,1);
});
test('regime map rejects excessive input and preserves version/direction with low-sample warnings',()=>{
 const r=api.buildStrategyRegimeMap({...scope,bars,points:[p('a'),{...p('b'),strategyVersion:'v2',side:'sell'}],horizon:1,costBps:0});assert.equal(r.groups.length,2);assert.equal(r.groups[1].positive,0);assert.match(r.groups[1].reason,/20/);
 assert.equal(api.buildStrategyRegimeMap({...scope,bars,points:[],horizon:7}).dataStatus,'failed');
 assert.equal(api.buildStrategyRegimeMap({...scope,bars:Array(5001).fill(bars[0]),points:[],horizon:1}).dataStatus,'failed');
 assert.equal(api.buildStrategyRegimeMap({...scope,market:'options',bars,points:[],horizon:1}).dataStatus,'unsupported');
});
