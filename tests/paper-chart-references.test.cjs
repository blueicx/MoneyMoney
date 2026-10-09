const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const {createEvidenceSnapshot}=require('../src/features/decision-intelligence');
const {createPaperChartReferences}=require('../src/features/paper-chart-lineage');

test('chart reference adapter resolves only integrity-checked evidence explicitly named by the research signal',()=>{
 const evidence=createEvidenceSnapshot({id:'evidence-aapl',market:'stocks',instrument:'stock:us:AAPL',workspace:'signals',dataStatus:'live',source:{id:'nasdaq',name:'Nasdaq'},observedAt:'2026-10-08T00:00:00Z',fetchedAt:'2026-10-08T00:00:05Z',fields:{action:'BUY',entry:101}});
 const signal={id:'signal-aapl',market:'stocks',instrument:'stock:us:AAPL',strategyId:'scan',strategyVersion:'v1',triggeredAt:Date.parse('2026-10-08T00:00:00Z'),entryPrice:101,sample:'live',action:'BUY',evidenceRefs:[evidence.id]};
 const sources={runnerSignal:()=>null,runnerSnapshot:()=>null,researchSignal:id=>id===signal.id?signal:null,evidenceSnapshot:id=>id===evidence.id?evidence:null,pointInTimeSnapshot:()=>null};
 const refs=createPaperChartReferences(sources);
 assert.deepEqual(refs.signal(signal.id),{id:signal.id,market:'stocks',instrument:signal.instrument,at:'2026-10-08T00:00:00.000Z',snapshotIds:[evidence.id],strategyVersion:'v1',action:'BUY'});
 assert.deepEqual(refs.snapshot(evidence.id),{id:evidence.id,market:'stocks',instrument:evidence.instrument,at:evidence.observedAt,retrievedAt:evidence.fetchedAt});
 const {paperChartLineage}=require('../src/features/paper-chart-lineage');
 const order={id:'manual-aapl',instrumentType:'stock',instrumentId:signal.instrument,side:'BUY',price:101,quantity:1,timestamp:'2026-10-08T00:01:00Z',signalId:signal.id,dataSnapshotId:evidence.id};
 assert.equal(paperChartLineage({orders:[order],runnerAccounts:{}},'stocks',signal.instrument,undefined,refs).markers.length,1);
});

test('chart reference adapter rejects tampered evidence and mismatched market identities',()=>{
 const evidence=createEvidenceSnapshot({id:'evidence-aapl',market:'stocks',instrument:'stock:us:AAPL',workspace:'signals',dataStatus:'live',source:{id:'nasdaq',name:'Nasdaq'},observedAt:'2026-10-08T00:00:00Z',fetchedAt:'2026-10-08T00:00:05Z',fields:{action:'BUY'}});
 const signal={id:'signal-aapl',market:'stocks',instrument:'stock:us:AAPL',strategyId:'scan',triggeredAt:Date.parse('2026-10-08T00:00:00Z'),entryPrice:101,sample:'live',action:'BUY',evidenceRefs:[evidence.id]};
 const refs=createPaperChartReferences({runnerSignal:()=>null,runnerSnapshot:()=>null,researchSignal:()=>signal,evidenceSnapshot:()=>({...evidence,fields:{action:'SELL'}}),pointInTimeSnapshot:()=>null});
 assert.equal(refs.snapshot(evidence.id),null);
 const invalid=createPaperChartReferences({runnerSignal:()=>null,runnerSnapshot:()=>null,researchSignal:()=>({...signal,market:'crypto',instrument:'crypto:binance:AAPLUSDT'}),evidenceSnapshot:()=>evidence,pointInTimeSnapshot:()=>null});
 assert.equal(invalid.signal(signal.id),null);
});

test('chart reference adapter refuses failed, unavailable, unsupported, empty, and invalid-status evidence snapshots',()=>{
 const badStatuses=['empty','failed','unavailable','unsupported'];
 for(const dataStatus of badStatuses){
  const evidence=createEvidenceSnapshot({id:`evidence-${dataStatus}`,market:'stocks',instrument:'stock:us:AAPL',workspace:'signals',dataStatus,source:{id:'nasdaq',name:'Nasdaq'},observedAt:'2026-10-08T00:00:00Z',fetchedAt:'2026-10-08T00:00:05Z',fields:{action:'BUY'},reason:`source ${dataStatus}`});
  const signal={id:`signal-${dataStatus}`,market:'stocks',instrument:'stock:us:AAPL',strategyId:'scan',triggeredAt:Date.parse('2026-10-08T00:00:00Z'),entryPrice:101,sample:'live',action:'BUY',evidenceRefs:[evidence.id]};
  const refs=createPaperChartReferences({runnerSignal:()=>null,runnerSnapshot:()=>null,researchSignal:()=>signal,evidenceSnapshot:id=>id===evidence.id?evidence:null,pointInTimeSnapshot:()=>null});
  assert.equal(refs.snapshot(evidence.id),null,dataStatus);
  assert.equal(refs.signal(signal.id),null,dataStatus);
 }
});

test('evidence snapshots reject noncanonical data statuses at creation and verification',()=>{
 const input={id:'evidence-invalid-status',market:'stocks',instrument:'stock:us:AAPL',workspace:'signals',dataStatus:'not-a-data-status',source:{id:'nasdaq',name:'Nasdaq'},observedAt:'2026-10-08T00:00:00Z',fetchedAt:'2026-10-08T00:00:05Z',fields:{action:'BUY'}};
 const {verifyEvidenceSnapshotHash}=require('../src/features/decision-intelligence');
 assert.throws(()=>createEvidenceSnapshot(input),/data status/i);
 const valid=createEvidenceSnapshot({...input,dataStatus:'live'});
 assert.equal(verifyEvidenceSnapshotHash({...valid,dataStatus:'not-a-data-status'}),false);
});
