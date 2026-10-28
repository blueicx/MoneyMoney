'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {waitForStableProgress,evaluateRollingAcceptance,needsAnotherObservation}=require('../scripts/lib/soak-progress.cjs');
const {evaluateContinuousSoak}=require('../scripts/lib/continuous-soak.cjs');
const {evaluateSourceProgress}=require('../scripts/lib/soak-progress.cjs');
const {evaluatePublicSourceEvidence}=require('../scripts/lib/soak-source-evidence.cjs');
const fs=require('node:fs');

test('source progress uses the original five-minute evidence gate and fails missing coverage promptly',()=>{
 const report={sourceProbes:[],measuredElapsedMs:299999};
 assert.equal(evaluateSourceProgress(report,[],evaluatePublicSourceEvidence),null);
 report.measuredElapsedMs=300001;
 const result=evaluateSourceProgress(report,[],evaluatePublicSourceEvidence);
 assert.equal(result.status,'failed');assert.equal(result.progressOnly,true);
 assert.equal(result.maxEvidenceGapMs,300000);
 assert.ok(result.reasons.some(x=>x.includes('missing public probe heartbeat')));
});

test('waits for the requested market and a finite-request-free stable context',async()=>{
 let market='stocks',pending=1,reads=0;
 const timer=setTimeout(()=>{market='options';pending=0;},8);
 try {
  const snapshot=await waitForStableProgress({
   readSnapshot:async()=>{reads++;return {market,workspace:'option-chain',readyState:'complete'};},
   getFinitePendingCount:()=>pending,
   expectedMarket:'options',timeoutMs:100,stableMs:8,pollMs:1
  });
  assert.equal(snapshot.market,'options');
  assert.ok(reads>=3);
 } finally {clearTimeout(timer);}
});

test('restarts the stability window when actual DOM summaries change',async()=>{
 let reads=0;
 const snapshot=await waitForStableProgress({
  readSnapshot:async()=>({market:'stocks',workspace:'stock-quotes',readyState:'complete',domElementCount:reads++<4?100:200,topLevelWorkspaceNodes:[{id:'stock-chart',nodeCount:reads<5?20:40}]}),
  getFinitePendingCount:()=>0,
  expectedMarket:'stocks',timeoutMs:200,stableMs:50,pollMs:1
 });
 assert.equal(snapshot.domElementCount,200);
 assert.ok(reads>4);
});

test('fails at the fixed stability budget and reports the last context and pending requests',async()=>{
 let reads=0;
 await assert.rejects(waitForStableProgress({
  readSnapshot:async()=>{reads++;return {market:'stocks',workspace:'stock-quotes',readyState:'complete'};},
  getFinitePendingCount:()=>1,
  expectedMarket:'stocks',timeoutMs:12,stableMs:4,pollMs:1
 }),error=>{
  assert.equal(error.name,'SoakProgressTimeout');
  assert.equal(error.details.pendingRequests,1);
  assert.equal(error.details.snapshot.market,'stocks');
  return true;
 });
 // Scheduler load can consume the whole budget after one read; the timeout and last evidence are the contract.
});

test('timeout retains bounded, local-only request and context samples',async()=>{
 const pending=Array.from({length:40},(_,index)=>({url:`http://127.0.0.1:3207/api/options/account-${index}?token=private#fragment`,resourceType:index===0?'fetch':'xhr'}));
 pending.push({url:'https://outside.example/api/secret?token=private',resourceType:'fetch'});
 await assert.rejects(waitForStableProgress({
  readSnapshot:async()=>({market:'stocks',workspace:'stock-quotes',readyState:'complete',domElementCount:321,topLevelWorkspaceNodes:Array.from({length:20},(_,index)=>({id:`node-${index}`,nodeCount:index+1}))}),
  getFinitePendingCount:()=>pending.filter(request=>new URL(request.url).origin==='http://127.0.0.1:3207').length,
  getPendingRequests:()=>pending,
  localOrigin:'http://127.0.0.1:3207',
  expectedMarket:'stocks',timeoutMs:24,stableMs:8,pollMs:1
 }),error=>{
  assert.equal(error.details.pendingRequests,40);
  assert.ok(Array.isArray(error.details.recentSamples));
  assert.ok(error.details.recentSamples.length<=12);
  const sample=error.details.recentSamples.at(-1);
  assert.ok(Number.isFinite(sample.elapsedMs));
  assert.equal(sample.market,'stocks');
  assert.equal(sample.workspace,'stock-quotes');
  assert.equal(sample.dom.domElementCount,321);
  assert.ok(sample.dom.topLevelWorkspaceNodes.length<=8);
  assert.ok(sample.pending.length<=20);
  assert.equal(sample.pending.length,20);
  assert.ok(sample.pending.every(item=>item.path.startsWith('/api/')));
  assert.ok(sample.pending.every(item=>!/[?#]|token|account-\d+/.test(item.path)));
  assert.equal(sample.pending[0].path,'/api/options/:redacted');
  assert.equal(sample.pending[0].resourceType,'fetch');
  assert.ok(sample.pending.every(item=>item.path.length<=160&&item.resourceType.length<=24));
  assert.equal(error.details.timeoutMs,24);
  return true;
 });
});

test('redacts unknown first API segments, encoded segments, and non-API paths',async()=>{
 const paths=[
  '/api/supersecret?token=private',
  '/api/%73upersecret?token=private',
  '/profile/private-email?token=private',
  '/api/stock/kline?symbol=usAAPL',
  '/api/binance/klines?symbol=BTCUSDT'
 ];
 await assert.rejects(waitForStableProgress({
  readSnapshot:async()=>({market:'stocks',workspace:'stock-quotes'}),
  getFinitePendingCount:()=>paths.length,
  getPendingRequests:()=>paths.map(url=>({url:`http://127.0.0.1:3207${url}`,resourceType:'fetch'})),
  localOrigin:'http://127.0.0.1:3207',expectedMarket:'stocks',timeoutMs:12,stableMs:4,pollMs:1
 }),error=>{
  const requests=error.details.recentSamples.at(-1).pending;
  assert.equal(requests[0].path,'/api/:redacted');
  assert.equal(requests[1].path,'/api/:redacted');
  assert.equal(requests[2].path,'/:redacted/:redacted');
  assert.equal(requests[3].path,'/api/stock/kline');
  assert.equal(requests[4].path,'/api/binance/klines');
  return true;
 });
});

test('diagnostic DOM summary prioritizes the active workspace root at the end of a long list',async()=>{
 const nodes=Array.from({length:35},(_,index)=>({id:`root-${index}`,workspaceId:`other-${index}`,nodeCount:index+1}));
 nodes[34]={id:'active-root',workspaceId:'stock-quotes',nodeCount:345};
 await assert.rejects(waitForStableProgress({
  readSnapshot:async()=>({market:'stocks',workspace:'stock-quotes',readyState:'complete',domElementCount:500,topLevelWorkspaceNodes:nodes}),
  getFinitePendingCount:()=>1,getPendingRequests:()=>[],localOrigin:'http://127.0.0.1:3207',
  expectedMarket:'stocks',timeoutMs:12,stableMs:4,pollMs:1
 }),error=>{
  const summary=error.details.recentSamples.at(-1).dom.topLevelWorkspaceNodes;
  assert.equal(summary.length,8);
  assert.equal(summary[0].workspaceId,'stock-quotes');
  assert.equal(summary[0].id,'active-root');
  return true;
 });
});

test('timeout samples retain both early and late states across the entire wait window',async()=>{
 let fakeNow=0;
 const errorPromise=assert.rejects(waitForStableProgress({
  readSnapshot:async()=>({market:'stocks',workspace:'stock-quotes'}),
  getFinitePendingCount:()=>1,
  getPendingRequests:()=>{
   if(fakeNow<300)return [{url:'http://127.0.0.1:3207/api/stock/kline',resourceType:'fetch'}];
   if(fakeNow>1000)return [{url:'http://127.0.0.1:3207/api/binance/klines',resourceType:'xhr'}];
   return [];
  },
  localOrigin:'http://127.0.0.1:3207',expectedMarket:'stocks',timeoutMs:1400,stableMs:500,pollMs:100,
  now:()=>fakeNow,sleepFor:async ms=>{fakeNow+=ms;}
 }),error=>{
  assert.equal(error.details.timeoutMs,1400);
  const samples=error.details.recentSamples;
  assert.ok(samples.length<=12);
  const early=samples.find(sample=>sample.pending.some(item=>item.path==='/api/stock/kline'));
  const late=samples.find(sample=>sample.pending.some(item=>item.path==='/api/binance/klines'));
  assert.ok(early,'early request evidence remains available');
  assert.ok(late,'late request evidence remains available');
  assert.ok(early.elapsedMs<300);
  assert.ok(late.elapsedMs>1000);
  return true;
 });
 await errorPromise;
});

test('stability continues to use the complete DOM context beyond the diagnostic summary limit',async()=>{
 let reads=0;
 const snapshot=await waitForStableProgress({
  readSnapshot:async()=>{
   reads++;
   const nodes=Array.from({length:10},(_,index)=>({id:`root-${index}`,workspaceId:`other-${index}`,nodeCount:index+1}));
   nodes[9]={id:'active-root',workspaceId:'stock-quotes',nodeCount:reads===1?10:20};
   return {market:'stocks',workspace:'stock-quotes',readyState:'complete',topLevelWorkspaceNodes:nodes};
  },
  getFinitePendingCount:()=>0,expectedMarket:'stocks',timeoutMs:500,stableMs:60,pollMs:1
 });
 assert.equal(snapshot.topLevelWorkspaceNodes.at(-1).nodeCount,20);
 assert.ok(reads>5);
});

test('timeout diagnostics handle empty and absent snapshots and retain fixed production budgets',async()=>{
 for(const readSnapshot of [async()=>null,async()=>({})]){
  await assert.rejects(waitForStableProgress({readSnapshot,getFinitePendingCount:()=>0,getPendingRequests:()=>[],localOrigin:'http://127.0.0.1:3207',expectedMarket:'stocks',timeoutMs:12,stableMs:4,pollMs:1}),error=>{
   assert.equal(error.name,'SoakProgressTimeout');
   assert.ok(error.details.recentSamples.length>0);
   assert.ok(error.details.recentSamples.length<=12);
   assert.equal(error.details.recentSamples.at(-1).market,null);
   assert.deepEqual(error.details.recentSamples.at(-1).pending,[]);
   return true;
  });
 }
 await assert.rejects(waitForStableProgress({readSnapshot:()=>new Promise(()=>{}),getFinitePendingCount:()=>0,getPendingRequests:()=>[],localOrigin:'http://127.0.0.1:3207',expectedMarket:'stocks',timeoutMs:12,stableMs:4,pollMs:1}),error=>{
  assert.equal(error.details.snapshot,null);
  assert.deepEqual(error.details.recentSamples,[]);
  return true;
 });
 const source=fs.readFileSync(require.resolve('../scripts/long-session-smoke.cjs'),'utf8');
 // 2026-10-28: 连续三轮固定构建 24 小时隔离运行均在真实来源分支下，于期权链(Deribit 全量
 // book summary，单次调用上限 15000ms)或加密货币(3 路并行 Binance 调用，单次上限 8000ms)
 // 首次冷加载时在原 5000ms/500ms 窗口内失败；rollingAcceptance/sourceProgressAcceptance
 // 均通过，且无一次触发任何单来源自身的超时，证明是真实外部往返耗时合理但超出原窗口，而
 // 非来源挂起或应用卡死。将预算放宽到已知最慢来源超时之上(20000ms)并保留 750ms 稳定窗口，
 // 继续能捕获远超所有来源既定超时的真正卡死；此断言继续钉住该固定值防止未来静默改动。
 assert.match(source,/timeoutMs:20000,stableMs:750,pollMs:50/);
});

test('bounds a stalled context read by the same monotonic deadline',async()=>{
 let reads=0;
 await assert.rejects(waitForStableProgress({
  readSnapshot:async()=>{reads++;if(reads>1)return new Promise(()=>{});return {market:'stocks',workspace:'stock-quotes',readyState:'complete'};},
  getFinitePendingCount:()=>0,
  expectedMarket:'stocks',timeoutMs:20,stableMs:15,pollMs:1
 }),error=>{
  assert.equal(error.name,'SoakProgressTimeout');
  assert.equal(error.details.snapshot.market,'stocks');
  return true;
 });
});

test('rejects invalid budgets instead of silently extending the wait',async()=>{
 await assert.rejects(waitForStableProgress({readSnapshot:async()=>({}),getFinitePendingCount:()=>0,expectedMarket:'stocks',timeoutMs:0}),/timeoutMs/);
});

test('rolling acceptance keeps the round 29 valley and rejects round 31 recovery',()=>{
 const nodes=[20726,20702,20700,...Array(24).fill(20900),19342,19340,19342,20882];
 const measurements=nodes.map((value,index)=>({round:index+1,measuredMs:index*60000,nodes:value,listeners:100,heapBytes:1024,documents:1,pendingRequests:0}));
 const report={measurements,measuredElapsedMs:measurements.at(-1).measuredMs,pageErrors:[],restarts:0};
 const result=evaluateRollingAcceptance(report,evaluateContinuousSoak);
 assert.equal(measurements[28].nodes,19340);
 assert.equal(measurements[30].nodes,20882);
 assert.equal(measurements[30].nodes-measurements[28].nodes,1542);
 assert.equal(result.status,'failed');
 assert.equal(result.progressOnly,true);
 assert.ok(result.reasons.includes('nodes growth beyond original allowance'));
});

test('rolling acceptance waits until three observations exist',()=>{
 assert.equal(evaluateRollingAcceptance({measurements:[{},{}]},()=>{throw new Error('must wait');}),null);
});

test('requires an observation spanning the duration even when the sleep clock has reached it',()=>{
 const report={measurements:[{measuredMs:0},{measuredMs:120000},{measuredMs:333585.6}]};
 assert.equal(needsAnotherObservation(report,3,360000),true,'wall-clock sleep cannot substitute for an observation at the required duration');
 report.measurements.push({measuredMs:360017.9});
 assert.equal(needsAnotherObservation(report,3,360000),false);
});

test('requires enough observations for cycle-only runs, including zero-minute runs',()=>{
 const report={measurements:[{measuredMs:0},{measuredMs:10}]};
 assert.equal(needsAnotherObservation(report,3,0),true);
 report.measurements.push({measuredMs:20});
 assert.equal(needsAnotherObservation(report,3,0),false);
});
