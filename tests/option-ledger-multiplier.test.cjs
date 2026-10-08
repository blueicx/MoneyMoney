const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const {emptyUnifiedPaperLedger,applyUnifiedPaperOrder,markUnifiedPaperPrices,calculateUnifiedPerformance,validateUnifiedPaperOrder}=require('../src/features/unified-paper-trading');
const base={instrumentType:'option',instrumentId:'option:us:SPY:2027-01-15:500:C',price:2,quantity:2,contractMultiplier:100,side:'BUY',timestamp:'2026-10-08T00:00:00Z'};
test('explicit option multiplier is applied to cash, marked equity, realized PnL and exposure',()=>{
 let ledger=applyUnifiedPaperOrder(emptyUnifiedPaperLedger(1000),base);
 assert.equal(ledger.cash,600);assert.equal(ledger.positions[0].contractMultiplier,100);
 ledger=markUnifiedPaperPrices(ledger,new Map([[base.instrumentId,3]]));
 let performance=calculateUnifiedPerformance(ledger);assert.equal(performance.equity,1200);assert.equal(performance.unrealizedPnl,200);assert.equal(performance.marketExposure.option,600);
 ledger=applyUnifiedPaperOrder(ledger,{...base,side:'SELL',price:3,quantity:1});assert.equal(ledger.cash,900);assert.equal(ledger.realizedPnl,100);
 assert.equal(calculateUnifiedPerformance(ledger).equity,1200);
});
test('multipliers cannot silently change a position or be applied to another market',()=>{
 const ledger=applyUnifiedPaperOrder(emptyUnifiedPaperLedger(1000),base);
 for(const multiplier of [0,-1,Infinity,NaN])assert.equal(validateUnifiedPaperOrder({...base,contractMultiplier:multiplier}).ok,false);
 assert.equal(validateUnifiedPaperOrder({...base,quantity:0.5}).ok,false);
 assert.equal(validateUnifiedPaperOrder({...base,instrumentType:'stock',instrumentId:'stock:us:SPY'}).ok,false);
 assert.throws(()=>applyUnifiedPaperOrder(ledger,{...base,side:'SELL',contractMultiplier:10}),/乘数/);
 assert.throws(()=>applyUnifiedPaperOrder(ledger,{...base,side:'SELL',contractMultiplier:undefined}),/乘数/);
 assert.throws(()=>applyUnifiedPaperOrder(ledger,{...base,quantity:4}),/余额/);
 assert.equal(ledger.cash,600);
});
