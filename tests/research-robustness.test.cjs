require('ts-node/register/transpile-only');
const test=require('node:test'),assert=require('node:assert/strict');
const run=input=>require('../src/features/research-robustness').evaluateResearchRobustness(input);
const prices=Array.from({length:240},(_,i)=>100+i*.1+Math.sin(i/4));
const input={context:{market:'stocks',workspace:'research-lab',instrument:'stock:us:AAPL',strategyId:'rsi',strategyVersion:'v1',dataSource:'verified fixture',dataSnapshotHash:'archived-hash',feeRate:.001,slippage:.002,seed:42},prices,signals:Array.from({length:8},(_,i)=>[{timeIndex:25+i*25,direction:'buy'},{timeIndex:30+i*25,direction:'sell'}]).flat()};
test('saved-input robustness is reproducible and fixes data/configuration hashes and random seed',()=>{
 const a=run(input),b=run(JSON.parse(JSON.stringify(input)));assert.deepEqual(a,b);
 assert.equal(a.dataStatus,'historical');assert.equal(a.seed,42);assert.match(a.dataHash,/^[a-f0-9]{64}$/);
 assert.equal(a.controls.randomEntry.length,12);assert.equal(a.controls.timePlacebo.length,12);assert.equal(a.executionEnabled,false);
 assert.equal(a.ranking,null);assert.match(a.warnings.join(' '),/样本|20/);
 assert.equal(a.costScenarios.length,3);assert.equal(a.costScenarios[0].multiplier,1);
 assert.notEqual(run({...input,context:{...input.context,seed:43}}).configurationHash,a.configurationHash);
 for(const row of [...a.controls.randomEntry,...a.controls.timePlacebo])for(const sample of row.samples){assert.ok(sample.exitIndex>sample.entryIndex);assert.ok(sample.exitIndex<prices.length);assert.ok(!input.signals.filter(s=>s.direction==='buy').some(s=>s.timeIndex===sample.entryIndex));}
});
test('missing lineage, costs, seed, invalid prices and unsupported markets fail closed without comparisons',()=>{
 for(const bad of [
 {...input,context:{...input.context,dataSnapshotHash:undefined}},
 {...input,context:{...input.context,seed:undefined}},
 {...input,context:{...input.context,feeRate:undefined}},
 {...input,context:{...input.context,market:'options',instrument:'option:cboe:AAPL'}},
 {...input,prices:prices.map((v,i)=>i===9?NaN:v)},
 {...input,signals:[{timeIndex:prices.length,direction:'buy'}]},
 ]){const row=run(bad);assert.notEqual(row.dataStatus,'historical');assert.equal(row.controls,null);assert.equal(row.executionEnabled,false);}
});
test('regime grouping uses only pre-entry history and unmatched legacy signals stay unassociated',()=>{
 const a=run(input);assert.ok(a.regimes.every(r=>r.definition.includes('入场前')));
 const row=run({...input,signals:[{timeIndex:30,direction:'sell'},{timeIndex:40,direction:'buy'}]});
 assert.equal(row.dataStatus,'empty');assert.match(row.reason,/配对|未关联/);assert.equal(row.controls,null);
});

test('private manual robustness route only reads saved input and persists the resulting research evidence',async()=>{
 const express=require('express'),{createResearchRobustnessRouter}=require('../src/web/research-robustness-routes');
 const saved={experiment:{id:'exp-a',market:'stocks',instrument:'stock:us:AAPL'},input};let writes=0;
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={role:req.headers['x-role']};next();});
 app.use('/api/research/experiments',createResearchRobustnessRouter({get:id=>id==='exp-a'?saved:null,save:(id,row)=>{assert.equal(id,'exp-a');Object.assign(saved,row);writes++;}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/api/research/experiments/exp-a/robustness';
 try{
 assert.equal((await fetch(url,{method:'POST'})).status,403);assert.equal(writes,0);
 const response=await fetch(url,{method:'POST',headers:{'x-role':'admin'}});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 assert.equal((await response.json()).data.controls.randomEntry.length,12);assert.equal(writes,1);
 assert.equal((await fetch(url,{method:'POST',headers:{'x-role':'admin','content-type':'application/json'},body:JSON.stringify({prices:[1,2]})})).status,400);
 assert.equal(writes,1);saved.input={...input,context:{...input.context,market:'crypto',instrument:'crypto:binance:BTCUSDT'}};
 assert.equal((await fetch(url,{method:'POST',headers:{'x-role':'admin'}})).status,409);assert.equal(writes,1);
 }finally{await new Promise(r=>server.close(r));}
});
