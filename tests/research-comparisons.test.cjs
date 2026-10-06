const test=require('node:test'),assert=require('node:assert/strict');
require('ts-node/register/transpile-only');
test('runner comparison keeps accounts separate, pairs only actual hashes, and refuses false fairness',()=>{
 const {compareAiRunnerReports}=require('../src/features/ai-runner-comparison');
 const runner=(id,mode)=>({id,venue:'Stocks',mode,budgetUsd:100,cashUsd:100,createdAt:'2026-10-06T00:00:00Z',status:'STOPPED',positions:[],trades:[],policy:{feeRateBps:10,additionalSlippageBps:0},universe:{market:'stocks',hash:'frozen',instruments:[{venue:'Stocks',symbolOrMarketId:'usAAPL'}]},equityHistory:[{at:'2026-10-06T01:00:00Z',equityUsd:101,drawdownPct:0,dataStatus:'delayed'}]});
 const a=runner('a','rules'),b=runner('b','ai-review'),before=JSON.stringify([a,b]);
 const decision=(runnerId,hash)=>({runnerId,market:'stocks',instrument:'stock:us:AAPL',snapshotHash:hash,at:'2026-10-06T01:00:00Z',dataStatus:'delayed',action:'NONE',reason:'hold'});
 const report=compareAiRunnerReports([a,b],{a:[decision('a','same'),decision('a','different')],b:[decision('b','same')]});
 assert.equal(report.pairedSnapshotCount,1);assert.equal(report.rows.length,2);assert.equal(report.rows[1].executionEligible,false);assert.equal(report.fairComparison,false);assert.match(report.warnings.join(' '),/随机种子|研究只读/);assert.equal(JSON.stringify([a,b]),before);
 assert.throws(()=>compareAiRunnerReports([a,{...b,universe:{...b.universe,market:'crypto'}}],{}),/市场/);
 assert.throws(()=>compareAiRunnerReports([a,a],{}),/不同/);
 const unknown=compareAiRunnerReports([{...a,trades:[{timestamp:a.createdAt,action:'BUY',price:100,quantity:1}]},b],{});assert.equal(unknown.rows[0].recordedCosts,null);assert.match(unknown.warnings.join(' '),/费用/);
});
test('contract capacity walks verified depth with multiplier and never invents a complete fill',()=>{
 const {contractCapacity,compareContractSnapshots}=require('../src/features/contract-comparison');const now=Date.parse('2026-10-06T01:00:00Z');
 const data={market:'crypto',instrument:'crypto:gateio:BTC_USDT',updatedAt:new Date(now).toISOString(),kind:'perpetual',source:'Gate',sections:{quote:{dataStatus:'delayed'},depth:{dataStatus:'delayed'}},quote:{multiplier:0.1,takerFeeRate:0.001,markPrice:100,indexPrice:100,basisPct:0,fundingRatePct:0.01},depth:{bids:[{price:99,contracts:2}],asks:[{price:101,contracts:2},{price:102,contracts:3}]}};
 const report=contractCapacity(data,{side:'BUY',quantity:0.4},now);assert.equal(report.filledQuantity,0.4);assert.equal(report.vwap,101.5);assert.equal(report.feeEstimate,0.0406);assert.equal(report.executionEnabled,false);
 const partial=contractCapacity(data,{side:'BUY',quantity:1},now);assert.equal(partial.dataStatus,'partial');assert.equal(partial.uncoveredQuantity,0.5);
 assert.equal(contractCapacity({...data,updatedAt:new Date(now-60001).toISOString()},{side:'BUY',quantity:1},now).dataStatus,'unavailable');
 assert.equal(contractCapacity({...data,depth:{...data.depth,bids:[{price:103,contracts:2}]}},{side:'BUY',quantity:1},now).dataStatus,'unavailable');
 assert.throws(()=>compareContractSnapshots([data,{...data,instrument:'crypto:gateio:ETH_USDT'}]),/底层/);
 const compare=compareContractSnapshots([data,{...data,kind:'delivery',instrument:'crypto:gateio-delivery:BTC_USDT_20261009',quote:{...data.quote,fundingRatePct:null,expiresAt:'2026-10-09T08:00:00Z'}}]);assert.equal(compare.rows[1].fundingRatePct,null);assert.equal(compare.executionEnabled,false);
});
