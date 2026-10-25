const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
function build(input){return require('../src/features/forward-evidence-timeline').buildForwardEvidenceTimeline(input);}
const session={id:'observation',market:'stocks',instrument:'stock:us:AAPL',strategyHash:'a'.repeat(64),strategyId:'strategy',experimentId:'experiment',timeframe:'5m',source:'fixture',startedAt:1000};
const signal={id:'signal',market:'stocks',instrument:session.instrument,strategyVersion:session.strategyHash,strategyId:'strategy',experimentId:'experiment',timeframe:'5m',source:'fixture',triggeredAt:2000,evidenceRefs:['snapshot'],forwardObservation:{sessionId:session.id,horizons:{1:{mature:true},20:{mature:false}}}};
test('forward evidence timeline keeps observed maturity separate from confirmed paper receipt and actual execution',()=>{
 const t=build({session,signals:[signal],executionVerified:true,execution:{receipts:[{id:'receipt',signalId:'signal',orderId:'order',side:'BUY',snapshotId:'quote',confirmedAt:3000,feeUsd:.1,slippageUsd:.2}],evidenceRefs:['receipt']}});
 assert.equal(t.signals[0].horizons[0].status,'mature');assert.equal(t.signals[0].horizons.at(-1).status,'waiting');assert.equal(t.signals[0].receipts[0].feeUsd,.1);assert.equal(t.actualTradingVerified,false);assert.equal(t.promotionAllowed,false);assert.equal(t.estimatedMaturityAt,null);
});
test('a later gap cannot erase a previously frozen shorter mature horizon',()=>{
 const result=build({session,signals:[{...signal,dataGap:true}]}).signals[0].horizons;assert.equal(result[0].status,'mature');assert.doesNotMatch(result[0].reason,/缺口/);assert.equal(result.at(-1).status,'blocked');
});
test('receipt identity mismatch rejects association and unknown costs remain unknown',()=>{
 const t=build({session,signals:[signal],executionVerified:true,execution:{receipts:[{id:'receipt',signalId:'elsewhere',orderId:'order',side:'BUY'}],evidenceRefs:['receipt']}});assert.equal(t.signals[0].receipts.length,0);assert.equal(t.unlinkedReceipts,1);
 const unknown=build({session,signals:[signal],executionVerified:false,execution:{receipts:[{id:'receipt',signalId:'signal',feeUsd:0}]}});assert.equal(unknown.signals[0].receipts.length,0);assert.equal(unknown.costCoverage,'unknown');
 assert.throws(()=>build({session,signals:[{...signal,instrument:'stock:us:MSFT'}]}));
});
