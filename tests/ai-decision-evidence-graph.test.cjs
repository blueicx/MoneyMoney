const test=require('node:test'),assert=require('node:assert/strict');
require('ts-node/register/transpile-only');
const diagnostics=require('../src/features/ai-runner-diagnostics');
const at='2026-10-01T00:00:00Z',hash='a'.repeat(64);
const decision={id:'d',runnerId:'r',market:'stocks',instrument:'AAPL',at,snapshotHash:hash,dataStatus:'delayed',modelVersion:'saved-model',modelCallStatus:'success',modelLatencyMs:50,strategyVersion:'s1',signals:['rsi'],riskChecks:[{name:'budget',passed:true,reason:'saved check'}],action:'BUY',orderId:'o',reason:'saved reason'};
const snapshot={id:'rs_'+hash,hash,market:'stocks',payload:{market:'stocks',instrument:'AAPL'}};
test('decision graph exposes explicit saved lineage, never infers a fill from its id',()=>{
 assert.equal(typeof diagnostics.buildDecisionEvidenceGraph,'function');
 const before=JSON.stringify({decision,snapshot});
 const graph=diagnostics.buildDecisionEvidenceGraph(decision,snapshot,null,[],'2026-10-02T00:00:00Z');
 assert.equal(graph.dataStatus,'partial');assert.equal(graph.modelCalls,0);assert.equal(graph.orderChanges,0);
 assert.equal(graph.nodes.find(n=>n.kind==='decision').recordId,'d');
 assert.equal(graph.nodes.find(n=>n.kind==='snapshot').recordId,snapshot.id);
 assert.equal(graph.nodes.find(n=>n.kind==='model').recordId,null);
 assert.equal(graph.nodes.find(n=>n.kind==='order').status,'unlinked');
 assert.match(graph.nodes.find(n=>n.kind==='model').reason,/调用ID|输出/);
 assert.equal(graph.edges.some(e=>e.relation==='verified-execution'),false);
 assert.equal(JSON.stringify({decision,snapshot}),before);
});
test('only verified matching execution can connect account and order; later results require explicit order lineage',()=>{
 assert.equal(typeof diagnostics.buildDecisionEvidenceGraph,'function');
 const execution={market:'stocks',instrument:'stock:us:AAPL',orderId:'o',accountId:'ai-runner:r',signalId:'d',snapshotId:snapshot.id,snapshot:{id:snapshot.id,hash,at,fields:snapshot.payload},decision};
 const position={id:'p',entryOrderId:'o',exitOrderId:'exit',instrumentId:'AAPL',status:'CLOSED',entryTime:at,exitTime:'2026-10-02T00:00:00Z',pnlUsd:4};
 const graph=diagnostics.buildDecisionEvidenceGraph(decision,snapshot,execution,[position],'2026-10-03T00:00:00Z');
 assert.equal(graph.nodes.find(n=>n.kind==='order').status,'verified');
 assert.equal(graph.nodes.find(n=>n.kind==='account').recordId,'ai-runner:r');
 // A matching entry is not proof of the exit; the archived exit decision is required.
 assert.equal(graph.nodes.find(n=>n.kind==='result').status,'unlinked');
 for(const wrong of [{...execution,accountId:'ai-runner:other'},{...execution,signalId:'wrong'},{...execution,market:'crypto'},{...execution,snapshotId:'other'},{...execution,decision:{...decision,orderId:'wrong'}}]) {
  assert.equal(diagnostics.buildDecisionEvidenceGraph(decision,snapshot,wrong,[position],'2026-10-03T00:00:00Z').nodes.find(n=>n.kind==='order').status,'unlinked');
 }
});
test('future or mismatched snapshot is not connected; no raw model output or arbitrary payload enters graph',()=>{
 assert.equal(typeof diagnostics.buildDecisionEvidenceGraph,'function');
 for(const changed of [{...snapshot,hash:'b'.repeat(64)},{...snapshot,payload:{market:'crypto',instrument:'AAPL'}},{...snapshot,payload:{market:'stocks',instrument:'MU'}}]) {
  assert.equal(diagnostics.buildDecisionEvidenceGraph(decision,changed,null,[],'2026-10-02T00:00:00Z').nodes.find(n=>n.kind==='snapshot').status,'unlinked');
 }
 const graph=diagnostics.buildDecisionEvidenceGraph({...decision,at:'2027-01-01T00:00:00Z'},snapshot,null,[],'2026-10-02T00:00:00Z');
 assert.equal(graph.dataStatus,'unavailable');assert.equal(graph.edges.length,0);
 assert.equal(JSON.stringify(diagnostics.buildDecisionEvidenceGraph(decision,{...snapshot,payload:{...snapshot.payload,apiKey:'SECRET'}},null,[],'2026-10-02T00:00:00Z')).includes('SECRET'),false);
});
test('closed result requires canonical instrument and a verified exit, and future exits remain unlinked',()=>{
 const {buildDecisionEvidenceGraph:graph}=diagnostics;
 const execution={market:'stocks',instrument:'stock:us:AAPL',orderId:'o',accountId:'ai-runner:r',signalId:'d',snapshotId:snapshot.id,snapshot:{id:snapshot.id,hash,at,fields:snapshot.payload},decision};
 const exitDecision={...decision,id:'exit-d',orderId:'exit',at:'2026-10-02T00:00:00Z',action:'SELL'};
 const exit={...execution,orderId:'exit',signalId:'exit-d',decision:exitDecision,snapshot:{...execution.snapshot,at:exitDecision.at}};
 const position={id:'p',entryOrderId:'o',exitOrderId:'exit',instrumentId:'stock:us:AAPL',status:'CLOSED',entryTime:at,exitTime:exitDecision.at};
 assert.equal(graph(decision,snapshot,execution,[position],'2026-10-03T00:00:00Z',[exit]).nodes.find(n=>n.kind==='result').status,'verified');
 assert.equal(graph(exitDecision,snapshot,exit,[position],'2026-10-03T00:00:00Z',[execution]).nodes.find(n=>n.kind==='result').status,'verified');
 for(const change of [{instrumentId:'stock:us:MU'},{exitTime:'2027-01-01T00:00:00Z'}])assert.equal(graph(decision,snapshot,execution,[{...position,...change}],'2026-10-03T00:00:00Z',[exit]).nodes.find(n=>n.kind==='result').status,'unlinked');
});
test('saved model request reference and output hashes are displayed without treating them as a provider call receipt',()=>{
 const {createHash}=require('node:crypto'),h=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const input={market:'stocks'},output={market:'stocks',instrument:'AAPL',action:'HOLD'};
 const row={...decision,modelRequestRef:'quota-request-1',modelEvidence:{input,output,inputHash:h(input),outputHash:h(output),promptVersion:'v1',promptHash:h('prompt'),requestedModel:'saved-model',returnedModel:'saved-model'}};
 const model=diagnostics.buildDecisionEvidenceGraph(row,snapshot,null,[],'2026-10-02T00:00:00Z').nodes.find(n=>n.kind==='model');
 assert.equal(model.recordId,'quota-request-1');assert.match(model.reason,new RegExp(h(output)));assert.match(model.reason,/供应商|回执/);
});
