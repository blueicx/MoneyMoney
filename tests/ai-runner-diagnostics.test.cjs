const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('saved decision comparison reuses original rule/model evidence without inventing mature counterfactual profit',()=>{
 const {buildSavedDecisionComparison}=require('../src/features/ai-runner-diagnostics'),decision={id:'d',runnerId:'r',market:'stocks',instrument:'AAPL',snapshotHash:'a'.repeat(64),strategyVersion:'v1',modelVersion:'saved-model',action:'REVIEW',reason:'saved reason',signals:['HOLD']};
 assert.equal(typeof buildSavedDecisionComparison,'function');
 const snapshot={hash:decision.snapshotHash,payload:{market:'stocks',instrument:'AAPL',candidateSignals:[{strategy:'rsi',direction:'buy'}]}};
 const before=JSON.stringify({decision,snapshot}),result=buildSavedDecisionComparison(decision,snapshot);
 assert.equal(result.modelCalls,0);assert.equal(result.orderChanges,0);assert.equal(result.recorded.action,'REVIEW');assert.equal(result.rules.candidates[0].direction,'buy');assert.equal(result.hypotheticalPerformance,null);assert.match(result.reason,/未归档|无法/);assert.equal(JSON.stringify({decision,snapshot}),before);
 assert.equal(buildSavedDecisionComparison(decision,{...snapshot,payload:{...snapshot.payload,instrument:'MU'}}).dataStatus,'unavailable');
});
test('decision funnel never infers passed gates or fills from an order id and excludes duplicates and future rounds',()=>{
 const {reviewAiRunnerDecisions}=require('../src/features/ai-runner-diagnostics');
 const row={id:'a',runnerId:'r',market:'stocks',instrument:'AAPL',at:'2026-10-01T00:00:00Z',dataStatus:'delayed',source:'saved',signals:[{direction:'buy'}],riskChecks:[{name:'quote-freshness',passed:true},{name:'executable-quote',passed:true},{name:'budget',passed:true}],action:'BUY',orderId:'o',modelVersion:'fixed-v1',reason:'recorded'};
 const result=reviewAiRunnerDecisions([row,row,{...row,id:'b',orderId:'unverified',riskChecks:[]},{...row,id:'future',at:'2027-01-01T00:00:00Z'}],'r','stocks',[{entryOrderId:'o',instrument:{venue:'Stocks',symbolOrMarketId:'AAPL'},entryTime:row.at,status:'OPEN'}],'2026-10-16T00:00:00Z');
 assert.equal(result.funnel.evaluatedRounds,2);assert.equal(result.funnel.dataPassed,1);assert.equal(result.funnel.dataUnknown,1);assert.equal(result.funnel.signalRounds,2);assert.equal(result.funnel.submittedOrders,2);assert.equal(result.funnel.verifiedFilledOrders,1);assert.equal(result.funnel.unverifiedSubmittedOrders,1);assert.equal(result.funnel.scannedUniverseSize,null);assert.equal(result.modelCalls,0);
});
test('funnel excludes future, missing-time and cross-instrument fills',()=>{
 const {reviewAiRunnerDecisions}=require('../src/features/ai-runner-diagnostics');
 const row={id:'a',runnerId:'r',market:'stocks',instrument:'AAPL',at:'2026-10-01T00:00:00Z',dataStatus:'delayed',signals:[],riskChecks:[],action:'BUY',orderId:'o',reason:'recorded'};
 for(const position of [{instrumentId:'AAPL',entryTime:'2027-01-01T00:00:00Z'},{instrumentId:'AAPL'},{instrumentId:'MU',entryTime:row.at}]){
  assert.equal(reviewAiRunnerDecisions([row],'r','stocks',[{...position,entryOrderId:'o',status:'OPEN'}],'2026-10-16T00:00:00Z').funnel.verifiedFilledOrders,0);
 }
});
test('legacy diagnostic scope uses explicit runner venue, never defaults unknown or options to stocks',()=>{
 const {diagnosticRunnerMarket}=require('../src/features/ai-runner-diagnostics');
 assert.equal(diagnosticRunnerMarket({venue:'Options'}),'options');assert.equal(diagnosticRunnerMarket({venue:'Binance'}),'crypto');
 assert.equal(diagnosticRunnerMarket({venue:'Predict.fun'}),'prediction');assert.equal(diagnosticRunnerMarket({venue:'unknown'}),null);
 assert.equal(diagnosticRunnerMarket({venue:'Binance',universe:{market:'stocks'}}),null);
});
test('runner diagnostics use recorded gates, do not guess absent model/quote evidence and separate model versions',()=>{
 const {reviewAiRunnerDecisions}=require('../src/features/ai-runner-diagnostics');
 const row={id:'round-1',runnerId:'runner-a',market:'stocks',instrument:'AAPL',at:'2026-10-13T00:00:00Z',dataStatus:'delayed',dataAt:'2026-10-12T23:59:50Z',source:'Nasdaq',strategyVersion:'v1',modelVersion:'model-a',modelCallStatus:'success',signals:[],riskChecks:[{name:'budget',passed:false,reason:'预算不足'}],action:'REJECTED',reason:'风控拒绝'};
 const result=reviewAiRunnerDecisions([row,{...row,id:'round-2',modelVersion:'model-b',modelCallStatus:'failed',reason:'模型超时'},{...row,id:'round-3',modelVersion:undefined,modelCallStatus:undefined,dataAt:undefined,dataStatus:'cached',riskChecks:[]},{...row,id:'other',runnerId:'other'}],'runner-a','stocks');
 assert.equal(result.rows.length,3);assert.equal(result.excludedRecords,1);assert.equal(result.rows[0].dataGate.status,'recorded');assert.deepEqual(result.rows[0].blockedChecks,['budget：预算不足']);
 assert.equal(result.rows[2].dataGate.status,'unknown');assert.equal(result.rows[2].model.status,'unknown');
 assert.equal(result.groups.length,3);assert.equal(result.groups.find(g=>g.modelVersion==='model-b').failedModelCalls,1);assert.equal(result.groups[0].maturedResult,null);
});

test('version/instrument results require exact completed order lineage, known costs and twenty matured samples',()=>{
 const {reviewAiRunnerDecisions}=require('../src/features/ai-runner-diagnostics');
 const decisions=Array.from({length:21},(_,i)=>({id:'d'+i,runnerId:'a',market:'stocks',instrument:'AAPL',orderId:'o'+i,at:'2026-10-01T00:00:00Z',modelVersion:'m',strategyVersion:'s',dataStatus:'historical',signals:[],riskChecks:[],action:'BUY',reason:'信号'}));
 const positions=decisions.map((d,i)=>({id:'p'+i,entryOrderId:d.orderId,exitOrderId:'e'+i,status:'CLOSED',entryTime:d.at,exitTime:'2026-10-02T00:00:00Z',pnlUsd:10,entryFeeUsd:1,exitFeeUsd:1,entrySlippageUsd:1,exitSlippageUsd:1}));
 const run=p=>reviewAiRunnerDecisions(decisions,'a','stocks',p,'2026-10-13T00:00:00Z').groups[0];
 assert.equal(run(positions.slice(0,19)).maturedResult,null);
 assert.equal(run(positions.slice(0,20)).maturedResult.netPnlUsd,120);assert.equal(run(positions.slice(0,20)).maturedResult.recordedCostsUsd,80);
 assert.equal(run(positions.slice(0,20).map((p,i)=>i? p:{...p,entryFeeUsd:undefined})).maturedResult,null);
 assert.equal(run(positions.slice(0,20).map((p,i)=>i? p:{...p,exitTime:'2026-10-14T00:00:00Z'})).maturedResult,null);
});

test('diagnostic and read-only replay routes require administrator and exact archived decision linkage',async()=>{
 const {createAiRunnerDiagnosticsRouter}=require('../src/web/ai-runner-diagnostics-routes');const express=require('express');
 const row={id:'decision-a',runnerId:'a',market:'stocks',instrument:'AAPL',at:'2026-10-13T00:00:00Z',dataStatus:'delayed',signals:[],riskChecks:[],action:'NONE',reason:'无信号',snapshotHash:'a'.repeat(64)};
 const app=express();app.use((req,res,next)=>{req.user={role:req.headers['x-role']==='admin'?'admin':'guest'};next();});let savedSignal=null;
 app.use('/api/ai-runners',createAiRunnerDiagnosticsRouter({runner:id=>id==='a'?{id:'a',market:'stocks'}:null,history:()=>({data:[row],nextCursor:null}),signal:()=>savedSignal,snapshot:()=>({id:'rs_'+row.snapshotHash,hash:row.snapshotHash,market:'stocks',payload:{market:'stocks',instrument:'AAPL'}})}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/ai-runners',headers={'x-role':'admin'};
 try {
 assert.equal((await fetch(base+'/a/diagnostics')).status,403);const d=await fetch(base+'/a/diagnostics',{headers});assert.match(d.headers.get('cache-control'),/no-store/);assert.equal((await d.json()).data.rows.length,1);
 const empty=await fetch(base+'/a/history/decision-a/replay',{headers}).then(r=>r.json());assert.equal(empty.dataStatus,'unavailable');assert.match(empty.reason,/未关联/);
 savedSignal={runnerId:'other',decision:row,snapshotIds:['rs_'+row.snapshotHash]};assert.equal((await fetch(base+'/a/history/decision-a/replay',{headers}).then(r=>r.json())).dataStatus,'unavailable');
 savedSignal={runnerId:'a',decision:row,snapshotIds:['rs_'+row.snapshotHash]};const replay=await fetch(base+'/a/history/decision-a/replay',{headers}).then(r=>r.json());assert.equal(replay.data.decision.id,'decision-a');assert.equal(replay.readOnly,true);assert.equal(replay.modelCalls,0);
 }finally{await new Promise(r=>server.close(r));}
});
