const test=require('node:test'),assert=require('node:assert/strict'),analysis=require('../src/web/public/chart-analysis.js');
const bars=Array.from({length:25},(_,i)=>({time:1000+i*60000,open:100+i,close:100+i,high:102+i,low:99+i,volume:100,closed:true}));
const options={bars,signals:[{index:0,strategy:'volumeBreakout',side:'buy',price:100}],market:'stocks',instrument:'stock:us:AAPL',timeframe:'1m',source:'Nasdaq',sourceTime:1000};
test('confirmed signal identity survives pagination and outcomes use completed forward bars with explicit costs',()=>{
 const [point]=analysis.buildStrategyChartPoints({...options,costBps:20});
 assert.ok(point.id);assert.equal(point.outcomes.length,4);
 assert.equal(point.outcomes[0].returnPct,1);assert.equal(point.outcomes[0].netReturnPct,.8);
 assert.equal(point.outcomes[0].mfePct,3);assert.equal(point.outcomes[0].maePct,0);
 const [rebuilt]=analysis.buildStrategyChartPoints({...options,bars:[{...bars[0],time:-59000},...bars],signals:[{...options.signals[0],index:1}]});
 assert.equal(point.id,rebuilt.id);assert.equal(rebuilt.outcomes[0].netReturnPct,null,'missing cost assumption must not mean free trading');
});
test('forming, incomplete, corrupt or gapped future observations cannot produce mature statistics',()=>{
 const [forming]=analysis.buildStrategyChartPoints({...options,bars:bars.slice(0,1).map(b=>({...b,closed:false})),live:true});assert.equal(forming.outcomes[0].status,'unconfirmed');
 const [incomplete]=analysis.buildStrategyChartPoints({...options,bars:bars.slice(0,2).map((b,i)=>({...b,closed:i===0})),live:true});assert.equal(incomplete.outcomes[0].status,'pending');
 const [gap]=analysis.buildStrategyChartPoints({...options,bars:bars.map((b,i)=>i===2?{...b,gap:true}:b)});assert.equal(gap.outcomes[1].status,'unavailable');assert.equal(gap.outcomes[1].returnPct,null);
 const [corrupt]=analysis.buildStrategyChartPoints({...options,bars:bars.map((b,i)=>i===1?{...b,high:90}:b)});assert.equal(corrupt.outcomes[0].status,'unavailable');
 const [future]=analysis.buildStrategyChartPoints({...options,asOf:1000});assert.equal(future.outcomes[0].status,'pending');
});

test('point-in-time observations require evidence that a forward candle closed before the cutoff',()=>{
 const [during]=analysis.buildStrategyChartPoints({...options,asOf:bars[1].time+100});
 assert.equal(during.outcomes[0].status,'pending','the open timestamp is not the close timestamp');
 const [nextOpen]=analysis.buildStrategyChartPoints({...options,asOf:bars[2].time});
 assert.equal(nextOpen.outcomes[0].status,'matured');
 const [explicit]=analysis.buildStrategyChartPoints({...options,bars:bars.map(b=>({...b,closedAt:b.time+59999})),asOf:bars[1].time+59999});
 assert.equal(explicit.outcomes[0].status,'matured');
 const [lastUnknown]=analysis.buildStrategyChartPoints({...options,bars:bars.slice(0,2),asOf:bars[1].time+120000});
 assert.equal(lastUnknown.outcomes[0].status,'pending','no next candle or close time must remain unknown');
});
