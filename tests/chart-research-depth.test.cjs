const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../src/web/public/chart-research.js');
const scope={market:'stocks',instrument:'stock:us:AAPL',timeframe:'1m',source:'saved provider',sourceTime:'2026-10-01T00:00:00Z'};
const bars=(n=90)=>Array.from({length:n},(_,i)=>({time:i*60000,closedAt:(i+1)*60000,closed:true,open:100+i,high:102+i,low:99+i,close:101+i,volume:100+i}));
const point=(id='p',extra={})=>({...scope,id,time:30*60000,price:131,status:'confirmed',side:'buy',strategy:'maCross',strategyVersion:'v1',...extra});

test('gap repair previews exact scope and interval without asserting closed sessions are missing bars',()=>{
 const gap={from:60000,to:180000,verification:'unknown-session'};
 assert.equal(typeof api.buildGapBackfillPreview,'function');
 const result=api.buildGapBackfillPreview({...scope,gap,now:240000});
 assert.deepEqual(result.request,{market:'stocks',instrument:'AAPL',dataset:'bars',timeframe:'1m',from:'1970-01-01T00:01:00.000Z',to:'1970-01-01T00:03:00.000Z'});
 assert.match(result.reason,/休市|闭市|交易时段/);
 assert.equal(api.buildGapBackfillPreview({...scope,instrument:'crypto:gate:BTC_USDT',gap,now:240000}).request,null);
 assert.equal(api.buildGapBackfillPreview({...scope,gap,asOf:120000,now:240000}).request,null);
 assert.equal(api.buildGapBackfillPreview({...scope,timeframe:'unsupported',gap,now:240000}).request,null);
});

test('request diagnostics separates observed waits from historical provider timing and never sums overlapping stages',()=>{
 const r=api.buildRequestDiagnostics({requestTiming:{waitMs:500,decodeMs:5,prefetched:false},providerTelemetry:{provider:'saved',cacheMode:'cache',providerLatencyMs:900,dataStatus:'cached'},renderMs:8});
 assert.equal(r.stages.find(s=>s.key==='wait').durationMs,500);assert.equal(r.stages.find(s=>s.key==='provider').historical,true);
 assert.equal(r.totalMs,null);assert.equal(r.bottleneck,'wait');assert.match(r.reason,/重叠/);
 assert.equal(api.buildRequestDiagnostics({requestTiming:{prefetched:true,waitMs:2},providerTelemetry:{cacheMode:'origin',providerLatencyMs:null}}).stages.find(s=>s.key==='decode').durationMs,null);
 assert.equal(api.buildRequestDiagnostics({requestTiming:{waitMs:-1,decodeMs:NaN}}).bottleneck,null);
});
test('page delivery diagnostics keep authentication and document download separate from current instrument work',()=>{
 const r=api.buildRequestDiagnostics({pageTiming:{authMs:120,documentDownloadMs:10,scriptRequests:3,scriptTransferBytes:1200}});
 assert.equal(r.stages.find(row=>row.key==='auth').durationMs,120);assert.equal(r.page.scriptTransferBytes,1200);assert.equal(r.page.scriptRequests,3);assert.equal(r.totalMs,null);
 assert.equal(r.bottleneck,null,'old page authentication is not the current instrument bottleneck');
});
test('stock request timings are scoped to the accepted response and passed to existing chart diagnostics',()=>{
 const fs=require('node:fs'),source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8');
 const body=source.slice(source.indexOf('function renderChartResearchTools('),source.indexOf('function updateStockSupportResistanceStatus('));
 assert.match(body,/requestTiming:metadata\.requestTiming/);assert.match(body,/providerTelemetry:metadata\.providerTelemetry/);
 const request=source.slice(source.indexOf('    const prefetched = !live ?'),source.indexOf('    stockChartIntradaySession = d.session || null;'));
 assert.match(request,/response\.headers\.get\('x-request-id'\)/);assert.match(request,/requestTiming/);
 assert.ok(request.indexOf('requestRevision !== stockKlineRequestRevision')<request.indexOf('moneySourceMetadata='));
});
test('data audit reports invalid candles and duplicates without mutating or silently repairing them',()=>{
 const data=bars(5);data[1].high=1;data[2].time=data[1].time;data[3].volume=-1;
 const original=JSON.stringify(data),r=api.auditChartData({...scope,bars:data});
 assert.equal(r.dataStatus,'partial');assert.equal(r.invalidOhlc.length,1);assert.equal(r.duplicateTimes.length,1);assert.equal(r.invalidVolumes.length,1);
 assert.equal(JSON.stringify(data),original);assert.equal(r.repairedRows,0);
});
test('audit calls cross-session gaps unverified without a trading calendar, and does not turn no records into a source failure',()=>{
 const data=bars(5);data[4].time+=86400000;const r=api.auditChartData({...scope,bars:data});
 assert.equal(r.gaps[0].verification,'unknown-session');assert.equal(r.gaps[0].missingBars,null);
 assert.equal(api.auditChartData({...scope,bars:[]}).dataStatus,'empty');
 assert.equal(api.auditChartData({...scope,market:'options',bars:data}).dataStatus,'unsupported');
 assert.equal(api.auditChartData({...scope,bars:data,asOf:120000}).rows,3);
});
test('regime descriptors use only completed data before entry; later bars cannot rewrite them',()=>{
 const data=bars(),input={...scope,bars:data,points:[point()]};
 const r=api.describeStrategyRegimes(input);assert.equal(r.rows[0].trend,'rising');assert.equal(r.rows[0].priorBars,20);assert.ok(r.rows[0].volatilityPct>=0);
 const changed=data.map((b,i)=>i>=30?{...b,close:1,volume:999999}:b);
 assert.deepEqual(api.describeStrategyRegimes({...input,bars:changed}),r);
 assert.equal(api.describeStrategyRegimes({...input,points:[point('short',{time:5*60000})]}).rows[0].trend,'unknown');
});
test('unknown closing evidence cannot leak a pre-entry candle into regime and wrong-market points are excluded',()=>{
 const data=bars();data[29].closedAt=31*60000;
 const r=api.describeStrategyRegimes({...scope,bars:data,points:[point(),point('bad',{market:'crypto'})]});
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].priorBars,20);assert.equal(r.rows[0].latestPriorTime,28*60000);
});
test('redundancy groups exact versions and same candle directions, not fictitious independent evidence or combined profit',()=>{
 const points=[point('a'),point('b',{strategy:'macdCross'}),point('c',{time:31*60000,strategy:'macdCross'}),point('d',{side:'sell',strategy:'rsiReversal'})];
 const r=api.analyzeStrategyRedundancy({...scope,points});
 const pair=r.pairs.find(p=>p.left.strategy==='maCross'&&p.right.strategy==='macdCross');assert.equal(pair.overlap,1);assert.equal(pair.union,2);assert.equal(pair.jaccard,.5);
 assert.equal(r.pairs.find(p=>p.right.strategy==='rsiReversal'&&p.left.strategy==='maCross').conflicts,1);
 assert.equal(r.ranking,null);assert.equal(r.portfolioContribution,null);assert.equal(r.modelCalls,0);
});
test('counterfactual returns a replayable frozen snapshot, no-trade zero and explicit-cost close-price research only',async()=>{
 const input={...scope,bars:bars(),points:[point()],horizon:3,costBps:10,evidenceRefs:['snapshot-1']};
 const original=JSON.stringify(input),pending=api.evaluateCounterfactual(input);input.bars[31].close=1;
 const r=await pending;assert.equal(r.dataStatus,'historical');assert.equal(r.rows[0].noTradeReturnPct,0);assert.equal(r.rows[0].netReturnPct,r.rows[0].returnPct-.1);
 assert.match(r.dataHash,/^[a-f0-9]{64}$/);assert.match(r.configurationHash,/^[a-f0-9]{64}$/);assert.equal(r.modelCalls,0);assert.equal(r.orderChanges,0);
 const replay=await api.evaluateCounterfactual({...r.evidencePack.configuration,bars:r.evidencePack.bars,points:r.evidencePack.points});assert.deepEqual(replay,r);
 assert.notEqual(JSON.stringify(input),original);assert.equal(r.evidencePack.bars[31].close,132);
});
test('counterfactual retains pending/forming/gap states and missing costs, never inventing executions',async()=>{
 const data=bars(34),input={...scope,bars:data,points:[point(),point('forming',{status:'forming'})],horizon:5,costBps:null};
 const r=await api.evaluateCounterfactual(input);assert.equal(r.rows[0].status,'pending');assert.equal(r.rows[1].status,'unconfirmed');assert.equal(r.rows[0].netReturnPct,null);
 assert.equal((await api.evaluateCounterfactual({...input,market:'crypto'})).dataStatus,'unsupported');
 assert.equal((await api.evaluateCounterfactual({...input,costBps:-1})).dataStatus,'failed');
 assert.equal((await api.evaluateCounterfactual({...input,source:''})).dataStatus,'unavailable');
});
test('empty snapshots are not historical success and invalid pre-entry bars cannot imply a known regime',async()=>{
 assert.equal((await api.evaluateCounterfactual({...scope,bars:[],points:[],horizon:1,costBps:null})).dataStatus,'empty');
 const data=bars();data[25].gap=true;
 const r=api.describeStrategyRegimes({...scope,bars:data,points:[point()]});assert.equal(r.rows[0].trend,'unknown');assert.equal(r.rows[0].volatilityPct,null);
});
test('layout audit finds out-of-bounds labels/points, overlap and missing explanation IDs without hiding a signal',()=>{
 const layout={...scope,bounds:{left:10,right:200,top:10,bottom:100},markers:[{id:'p',x:20,y:20},{id:'unknown',x:210,y:50}],labels:[{id:'a',x:5,y:20,width:30,labelVisible:true},{id:'b',x:8,y:20,width:30,labelVisible:true},{id:'hidden',x:0,y:0,width:30,labelVisible:false}],height:12};
 const r=api.auditChartLayout({...scope,points:[point()],layout});assert.equal(r.dataStatus,'partial');assert.equal(r.outsideMarkers.length,1);assert.equal(r.outsideLabels.length,2);assert.equal(r.overlaps.length,1);assert.deepEqual(r.unlinkedIds,['unknown']);assert.equal(r.modifiedMarkers,0);
 assert.equal(api.auditChartLayout({...scope,points:[point()],layout:{...layout,instrument:'stock:us:MU'}}).dataStatus,'unavailable');
});
