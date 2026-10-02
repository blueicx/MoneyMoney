const test=require('node:test');const assert=require('node:assert/strict');
require('ts-node/register/transpile-only');
test('contract identity separates spot, perpetual, delivery and other markets',()=>{
 const {contractIdentity}=require('../src/features/contract-research');
 assert.deepEqual(contractIdentity('crypto:gateio:BTC_USDT'),{kind:'perpetual',contract:'BTC_USDT',venue:'gateio'});
 assert.equal(contractIdentity('crypto:gateio-delivery:BTC_USDT_20261009').kind,'delivery');
 for(const id of ['crypto:binance:BTCUSDT','stock:us:BTC','option:cboe:BTC','crypto:gateio:BTC_USDT/../../accounts'])assert.throws(()=>contractIdentity(id));
});
test('contract partial sources preserve quote and missing fields, never invent funding for delivery',async()=>{
 const {ContractResearchService}=require('../src/features/contract-research');let calls=0;
 const service=new ContractResearchService(async path=>{calls++;if(path.includes('/contracts/'))return {name:'BTC_USDT_20261009',type:'direct',mark_price:'100',index_price:'99',quanto_multiplier:'0.1',expire_time:1791532800};throw Error('source timeout');},()=>1790956800000);
 const result=await service.detail('crypto:gateio-delivery:BTC_USDT_20261009');
 assert.equal(result.dataStatus,'partial');assert.equal(result.quote.markPrice,100);assert.equal(result.quote.basisPct,100/99*100-100);assert.equal(result.quote.fundingRatePct,null);assert.equal(result.quote.openInterestUsd,null);assert.equal(result.funding.length,0);assert.equal(result.sections.funding.dataStatus,'unsupported');
 const again=await service.detail(result.instrument);assert.equal(again.dataStatus,'cached');assert.equal(calls,3);
});
test('contract requests coalesce and reject wrong upstream identity',async()=>{
 const {ContractResearchService}=require('../src/features/contract-research');let metadata=0;
 const service=new ContractResearchService(async path=>{if(path.includes('/contracts/')){metadata++;return {name:'ETH_USDT',type:'direct',mark_price:'100'};}return [];});
 const results=await Promise.all([service.detail('crypto:gateio:BTC_USDT'),service.detail('crypto:gateio:BTC_USDT')]);
 assert.equal(metadata,1);assert.equal(results[0].dataStatus,'unavailable');assert.equal(results[0].quote.markPrice,null);assert.match(results[0].reason,/身份/);
});
test('risk scenario computes linear long/short fees and funding with explicit assumptions, never liquidation',()=>{
 const {contractScenario}=require('../src/features/contract-research');
 const base={entryPrice:100,quantity:2,leverage:5,feeRate:0.001,fundingRate:0.01,fundingPeriods:2,shockPct:-10,side:'long'};
 const long=contractScenario(base);assert.equal(long.notional,200);assert.equal(long.initialMargin,40);assert.equal(long.pnl,-20);assert.equal(long.fundingCost,4);assert.equal(long.tradingFees,0.38);assert.equal(long.remainingMargin,15.620000000000001);assert.equal('liquidationPrice' in long,false);
 const short=contractScenario({...base,side:'short'});assert.equal(short.pnl,20);assert.equal(short.fundingCost,-4);
 for(const change of [{leverage:0},{quantity:-1},{feeRate:null},{shockPct:-100},{side:'buy'},{fundingPeriods:Infinity}])assert.throws(()=>contractScenario({...base,...change}));
});
