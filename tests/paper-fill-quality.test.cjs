const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('fill quality uses exact persisted lineage and distinguishes quote movement from recorded costs',()=>{
 const {paperFillQuality}=require('../src/features/paper-fill-quality');
 const order={id:'o',accountId:'ai-runner:r',runnerId:'r',signalId:'d',dataSnapshotId:'s',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',timestamp:'2026-10-15T01:00:02Z',price:101,quantity:2,feeUsd:.2,slippageUsd:.3,spreadUsd:1};
 const evidence={accountId:order.accountId,orderId:'o',signalId:'d',snapshotId:'s',instrument:order.instrumentId,decision:{id:'d',runnerId:'r',at:'2026-10-15T01:00:01Z',action:'BUY'},snapshot:{at:'2026-10-15T01:00:01Z',fields:{price:100,dataAt:'2026-10-15T01:00:00Z',quote:{bestBid:99,bestAsk:101}}}};
 const result=paperFillQuality(order,evidence);
 assert.equal(result.decisionToFillMs,1000);assert.equal(result.quoteAgeAtFillMs,2000);assert.equal(result.adverseMoveBps,100);
 assert.equal(result.recordedCostsUsd,.5);assert.equal(result.recordedSpreadUsd,1);assert.equal(result.submissionQuote,null);assert.equal(result.forwardReturn,null);
 assert.match(result.reason,/不重复/);assert.equal(paperFillQuality({...order,accountId:'other'},evidence),null);
 assert.equal(paperFillQuality({...order,instrumentId:'stock:us:MU'},evidence),null);
});
test('missing costs, crossed quotes, future source times and unknown option multiplier stay unknown',()=>{
 const {paperFillQuality}=require('../src/features/paper-fill-quality');
 const order={id:'o',accountId:'a',runnerId:'r',signalId:'d',dataSnapshotId:'s',instrumentType:'option',instrumentId:'option:us:AAPL261016C00200000',side:'BUY',timestamp:'2026-10-15T01:00:02Z',price:2,quantity:1};
 const evidence={accountId:'a',orderId:'o',signalId:'d',snapshotId:'s',instrument:order.instrumentId,decision:{runnerId:'r',at:'2026-10-15T01:00:01Z'},snapshot:{fields:{price:2,dataAt:'2026-10-15T01:00:03Z',quote:{bestBid:3,bestAsk:1}}}};
 const result=paperFillQuality(order,evidence);assert.equal(result.recordedCostsUsd,null);assert.equal(result.quoteSpreadBps,null);assert.equal(result.quoteAgeAtFillMs,null);assert.equal(result.fillNotional,null);
});
