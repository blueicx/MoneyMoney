const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('research validity keeps scoped observation history without changing the experiment or alert gate',()=>{
 const {ResearchValidityTracker}=require('../src/features/research-validity'),data=new Map(),store={get:key=>data.get(key)||null,set:(key,value)=>data.set(key,value),transaction:fn=>fn()};
 const tracker=new ResearchValidityTracker(store),identity={id:'e',market:'stocks',instrument:'stock:us:AAPL',strategyVersion:'v1'},original=JSON.stringify(identity);
 const stale={status:'stale',reason:'数据修订',findings:[{kind:'data-revision',at:'2026-10-15T01:00:00Z',hash:'a'.repeat(64)}]};
 assert.equal(tracker.observe(identity,stale,[], '2026-10-15T02:00:00Z').status,'needs-review');
 assert.equal(tracker.observe(identity,stale,[], '2026-10-15T03:00:00Z').history.length,1);
 const next=tracker.observe(identity,{status:'current',reason:'固定快照',findings:[]},[{status:'paused',reason:'成本偏差'}],'2026-10-15T04:00:00Z');
 assert.equal(next.status,'needs-review');assert.equal(next.history.length,2);assert.equal(next.strategyChanges,0);assert.equal(JSON.stringify(identity),original);
 assert.equal(tracker.observe({...identity,id:'other',market:'crypto',instrument:'crypto:binance:BTCUSDT'},{status:'unknown',reason:'无快照',findings:[]},[]).history.length,1);
});
test('future data revisions cannot invalidate a research conclusion before publication',()=>{
 const {assessResearchFreshness}=require('../src/features/research-freshness');
 const result=assessResearchFreshness({market:'stocks',instrument:'stock:us:AAPL',createdAt:'2026-10-01T00:00:00Z',asOf:'2026-10-15T00:00:00Z',dataSnapshotHash:'a'.repeat(64),revisions:[{market:'stocks',instrument:'AAPL',contentHash:'b'.repeat(64),publishedAt:'2026-10-16T00:00:00Z'}]});
 assert.equal(result.status,'current');
});
