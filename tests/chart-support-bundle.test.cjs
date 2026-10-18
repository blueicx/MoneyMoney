const test=require('node:test'),assert=require('node:assert/strict');const api=require('../src/web/public/chart-research');
const scope={market:'stocks',instrument:'stock:us:AAPL',timeframe:'5m'};
test('support package is an explicit allowlist, excluding source payload, prices, account, URLs, tokens and arbitrary labels',()=>{
 const input={...scope,buildVersion:'f3612fab8bfdbe968d93fe926137c39d2443070d',source:'https://upstream/?token=PRIVATE',sourceTime:1234,dataStatus:'cached',bars:[{close:999}],points:[{id:'private-id'}],accountId:'private-account',cookie:'PRIVATE',reason:'PRIVATE',requestTiming:{requestId:'req_123',waitMs:70,decodeMs:4,url:'PRIVATE'},providerTelemetry:{provider:'PRIVATE',cacheMode:'cache',providerLatencyMs:55},chartConfig:{strategies:{macdCross:true,'SECRET':true},indicators:{ma:true},token:'PRIVATE'},pageTiming:{authMs:12,scriptRequests:3,scriptTransferBytes:1000}};
 const r=api.buildChartSupportBundle(input);const text=JSON.stringify(r);
 assert.doesNotMatch(text,/PRIVATE|SECRET|private-|999|upstream/);assert.equal(r.context.instrument,scope.instrument);assert.equal(r.buildVersion,input.buildVersion);assert.equal(r.dataStatus,'cached');assert.equal(r.request.requestId,'req_123');assert.equal(r.sourcePresent,true);assert.equal(r.chart.strategies.macdCross,true);assert.equal(r.schemaVersion,1);assert.equal(r.includesPrivateRecords,false);
 assert.equal(api.buildChartSupportBundle({...input,buildVersion:'https://secret'}).buildVersion,null);
 assert.equal(api.buildChartSupportBundle({...input,instrument:'stock:us:AAPL?token=PRIVATE'}).context.instrument,null);
 assert.equal(api.buildChartSupportBundle({...input,dataStatus:'PRIVATE'}).dataStatus,'unknown');
});
test('separate performance budgets retain missing stages and never sum overlapping provider/wait time',()=>{
 const r=api.evaluateChartBudgets({...scope,requestTiming:{waitMs:3500,decodeMs:20},providerTelemetry:{cacheMode:'origin',providerLatencyMs:3400},renderMs:55,pageTiming:{authMs:50,documentDownloadMs:15}});
 assert.equal(r.totalMs,null);assert.equal(r.stages.find(s=>s.key==='wait').state,'exceeded');assert.equal(r.stages.find(s=>s.key==='render').state,'exceeded');
 assert.equal(r.stages.find(s=>s.key==='decode').state,'within');assert.equal(r.stages.find(s=>s.key==='provider').state,'exceeded');
 const missing=api.evaluateChartBudgets({});assert.ok(missing.stages.every(s=>s.state==='unmeasured'));
 const cached=api.evaluateChartBudgets({providerTelemetry:{cacheMode:'cache',providerLatencyMs:9000}});assert.equal(cached.stages.find(s=>s.key==='provider').state,'historical');assert.equal(cached.improvementPct,null);
});
