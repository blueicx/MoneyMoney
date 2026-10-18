const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const {runResearchExperiment,rerunSavedExperiment}=require('../src/features/experiment-runner');
const input={context:{market:'stocks',workspace:'research',instrument:'stock:us:AAPL',timeframe:'1d',strategyId:'test',strategyVersion:'v1',dataSource:'saved',dataSnapshotHash:'a'.repeat(64),feeRate:.001,slippage:.001,seed:7},prices:Array.from({length:80},(_,i)=>100+i),signals:[{timeIndex:20,direction:'buy'},{timeIndex:35,direction:'sell'}]};
test('same-input manual reruns have independent IDs while original experiment and saved evidence remain immutable',()=>{
 const previous={...runResearchExperiment(input),input:structuredClone(input)},before=JSON.stringify(previous);
 const a=rerunSavedExperiment(previous),b=rerunSavedExperiment(previous);
 assert.notEqual(a.experiment.id,previous.experiment.id);assert.notEqual(a.experiment.id,b.experiment.id);
 assert.equal(a.rerunOf,previous.experiment.id);assert.equal(a.configurationId,previous.experiment.id);assert.equal(JSON.stringify(previous),before);
 assert.deepEqual(a.backtest.trades,b.backtest.trades);assert.equal(a.input.context.seed,7);assert.equal(a.input.context.dataSnapshotHash,'a'.repeat(64));
 a.input.prices[0]=1;assert.equal(previous.input.prices[0],100);
});
test('rerun context overrides are merged but cannot switch market, identity or timeframe, and unverified legacy input is refused',()=>{
 const previous={...runResearchExperiment(input),input:structuredClone(input)};
 const row=rerunSavedExperiment(previous,{context:{feeRate:.002}});assert.equal(row.input.context.feeRate,.002);assert.equal(row.input.context.instrument,input.context.instrument);
 for(const context of [{market:'crypto'},{instrument:'stock:us:SNDK'},{timeframe:'5m'}])assert.throws(()=>rerunSavedExperiment(previous,{context}),/身份|市场|周期/);
 assert.throws(()=>rerunSavedExperiment({...previous,input:{...input,context:{...input.context,instrument:'stock:us:SNDK'}}}),/关联|身份/);
 assert.throws(()=>rerunSavedExperiment(previous,{arbitrarySql:'select'}),/参数/);
 assert.throws(()=>rerunSavedExperiment({experiment:previous.experiment}),/输入/);
});
