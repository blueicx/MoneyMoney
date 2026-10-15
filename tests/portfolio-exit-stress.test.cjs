const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('exit stress consumes only visible bid depth, keeps currency and refuses insufficient or stale evidence',()=>{
 const {estimatePortfolioExit}=require('../src/features/portfolio-exit-stress'),now=Date.parse('2026-10-15T01:00:00Z'),position={instrumentId:'crypto:binance:BTCUSDT',quantity:3,currency:'USDT'},book={instrument:position.instrumentId,source:'Binance public depth',retrievedAt:now-1000,bids:[[100,1],[99,2]],asks:[[101,3]],quantityUnit:'base'};
 let r=estimatePortfolioExit(position,book,now);assert.equal(r.dataStatus,'delayed');assert.equal(r.proceeds,298);assert.ok(Math.abs(r.impactBps-2/300*10000)<1e-8);assert.equal(r.currency,'USDT');assert.equal(r.orderChanges,0);
 assert.equal(estimatePortfolioExit({...position,quantity:4},book,now).proceeds,null);
 assert.equal(estimatePortfolioExit(position,{...book,instrument:'crypto:gateio:BTC_USDT'},now).dataStatus,'unavailable');
 assert.equal(estimatePortfolioExit(position,{...book,retrievedAt:now-61000},now).proceeds,null);
 assert.equal(estimatePortfolioExit(position,{...book,bids:[[99,1],[100,3]]},now).proceeds,null);
 assert.equal(estimatePortfolioExit(position,{...book,asks:[[98,2]]},now).proceeds,null);
});
