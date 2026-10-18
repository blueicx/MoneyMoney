const test=require('node:test'),assert=require('node:assert/strict');const api=require('../src/web/public/chart-research');
const scope={market:'stocks',instrument:'stock:us:AAPL',timeframe:'5m'},start=Date.parse('2026-10-15T14:00:00Z');
const bar=t=>({time:t,open:100,high:101,low:99,close:100,volume:1,closed:true});
test('loaded coverage calendar reports raw duplicate/invalid records, bounded dates and unknown completeness',()=>{
 const bars=[bar(start),bar(start),{...bar(start+300000),high:1},bar(start+86400000)];
 const r=api.buildLoadedCoverage({...scope,bars,source:'saved',asOf:start+86400000});
 assert.equal(r.days.length,2);assert.equal(r.days[0].records,3);assert.equal(r.days[0].uniqueTimes,2);assert.equal(r.days[0].invalidOhlc,1);
 assert.equal(r.days[0].coveragePct,null);assert.equal(r.source,'saved');assert.equal(r.timezone,'UTC');assert.equal(r.days[1].records,1);
 assert.equal(api.buildLoadedCoverage({...scope,bars,asOf:start}).days.length,1);
 assert.equal(api.buildLoadedCoverage({...scope,market:'crypto',bars}).dataStatus,'unsupported');
 assert.equal(api.buildLoadedCoverage({...scope,bars:Array(5001).fill(bar(start))}).dataStatus,'failed');
});
test('calendar audit is used only for exact instrument/timeframe/asOf/from-to and never removes source gaps',()=>{
 const bars=[bar(start),bar(start+3600000)],g={from:start,to:start+3600000,verification:'calendar-closure',reason:'verified',sourceUrl:'https://exchange.example/calendar'};
 const input={...scope,bars,sessionAudit:{...scope,asOf:null,gaps:[g]}};
 const r=api.auditChartData(input);assert.equal(r.gaps.length,0);assert.equal(r.sessionIntervals.length,1);
 assert.equal(api.auditChartData({...input,sessionAudit:{...input.sessionAudit,instrument:'stock:us:MU'}}).gaps.length,1);
 assert.equal(api.auditChartData({...input,asOf:start+3600000}).gaps.length,1);
 assert.equal(api.auditChartData({...input,bars:[bars[0],{...bars[1],gap:true}]}).gaps.length,1);
 assert.equal(api.buildGapBackfillPreview({...scope,gap:g}).request,null);
});
test('coverage calendar shows unobserved dates but never labels them lost sessions or fills the source',()=>{
 const result=api.buildLoadedCoverage({...scope,bars:[bar(start),bar(start+2*86400000)],source:'saved'});
 assert.equal(result.days.length,3);assert.equal(result.days[1].records,0);assert.equal(result.days[1].dataStatus,'empty');assert.equal(result.days[1].firstTime,null);assert.equal(result.days[1].coveragePct,null);
 const bounded=api.buildLoadedCoverage({...scope,bars:[bar(start-1000*86400000),bar(start)]});assert.equal(bounded.days.length,366);assert.equal(bounded.earlierDatesOmitted,true);
});
