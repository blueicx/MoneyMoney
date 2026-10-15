const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const now='2026-10-15T01:00:00Z',watched=[{market:'stocks',instrument:'stock:us:AAPL'},{market:'stocks',instrument:'stock:us:SNDK'},{market:'crypto',instrument:'crypto:binance:BTCUSDT'}];
const item={id:'e',market:'stocks',instrument:watched[0].instrument,kind:'event',title:'财报',source:'fixture',observedAt:now,scheduledAt:'2026-10-16T01:00:00Z',dataStatus:'delayed',evidenceRefs:['evidence-e']};
test('change map includes missing watchlist instruments, exact market isolation and structured changes only',()=>{
 const {buildWatchlistOperations}=require('../src/features/watchlist-operations');
 const result=buildWatchlistOperations([item,{...item,id:'p',kind:'price',scheduledAt:undefined,changePct:-3},{...item,id:'wrong',market:'crypto',changePct:99}],watched,'stocks',now);
 assert.equal(result.map.length,2);const a=result.map.find(r=>r.instrument===watched[0].instrument),b=result.map.find(r=>r.instrument===watched[1].instrument);
 assert.equal(a.changePct,-3);assert.equal(a.nextEventAt,item.scheduledAt);assert.equal(a.pending,2);assert.equal(b.changePct,null);assert.match(b.reason,/暂无/);
 assert.equal(result.calendar.scheduled.length,1);assert.equal(result.calendar.scheduled[0].evidenceRefs[0],'evidence-e');
});
test('risk calendar never invents a midnight or a future event from retrieval time and preserves source failure',()=>{
 const {buildWatchlistOperations}=require('../src/features/watchlist-operations');
 const result=buildWatchlistOperations([{...item,scheduledAt:'2026-10-16'},{...item,id:'failed',kind:'source',scheduledAt:undefined,dataStatus:'failed',reason:'来源超时'}],watched,'stocks',now);
 assert.equal(result.calendar.scheduled.length,0);assert.equal(result.calendar.unknownTime.length,1);assert.equal(result.calendar.sourceFailures.length,1);
 assert.match(result.calendar.reason,/时间/);assert.equal(result.map[0].dataStatus,'partial');
});
