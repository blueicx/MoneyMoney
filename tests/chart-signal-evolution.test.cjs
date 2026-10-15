const test=require('node:test'),assert=require('node:assert/strict'),analysis=require('../src/web/public/chart-analysis');
const context={market:'stocks',instrument:'stock:us:AAPL',timeframe:'5m',live:true,sourceFresh:true,sourceTime:10000,now:10000,barTimes:[1000],enabledStrategies:['volumeBreakout']},point={id:'p',market:'stocks',instrument:'stock:us:AAPL',timeframe:'5m',time:1000,strategy:'volumeBreakout',status:'forming',reason:'量比1.8',triggerPrice:10};
test('a chart point records formation, withdrawal, return and close confirmation without zoom creating events',()=>{
 assert.equal(typeof analysis.createStrategyPointTracker,'function');const tracker=analysis.createStrategyPointTracker();
 let result=tracker.observe([point],context);assert.equal(result.points[0].evolution.at(-1).state,'forming');
 result=tracker.observe([point],context);assert.equal(result.events.length,1);
 result=tracker.observe([],{...context,sourceTime:11000,now:11000});assert.equal(result.events.at(-1).state,'withdrawn');
 result=tracker.observe([point],{...context,sourceTime:12000,now:12000});assert.equal(result.events.at(-1).state,'forming');
 result=tracker.observe([{...point,status:'confirmed'}],{...context,sourceTime:13000,now:13000});assert.equal(result.events.at(-1).state,'confirmed');assert.equal(result.points[0].evolution.length,4);
});
test('stale feeds, replay, disabled layers, missing pages and old responses do not invent withdrawals',()=>{
 const tracker=analysis.createStrategyPointTracker();tracker.observe([point],context);
 for(const changed of [{sourceFresh:false},{live:false},{enabledStrategies:[]},{barTimes:[]},{sourceTime:9000}]){
  const r=tracker.observe([],{...context,...changed,now:11000});assert.ok(!r.events.some(e=>e.state==='withdrawn'));
 }
 const other=tracker.observe([],{...context,instrument:'stock:us:SNDK'});assert.equal(other.events.length,0);
 const replay=tracker.observe([point],{...context,live:false});assert.deepEqual(replay.points[0].evolution,[]);assert.deepEqual(replay.events,[]);
 assert.equal(tracker.observe([{...point,instrument:'crypto:binance:BTCUSDT'}],context).points.length,0);
});
