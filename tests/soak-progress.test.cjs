'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {waitForStableProgress,evaluateRollingAcceptance}=require('../scripts/lib/soak-progress.cjs');
const {evaluateContinuousSoak}=require('../scripts/lib/continuous-soak.cjs');
const {evaluateSourceProgress}=require('../scripts/lib/soak-progress.cjs');
const {evaluatePublicSourceEvidence}=require('../scripts/lib/soak-source-evidence.cjs');

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
