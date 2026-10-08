const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const {resolveRunnerFill,calculateRunnerExecutionCosts}=require('../src/features/ai-paper-runner');
const at='2026-10-08T00:00:00Z',policy={minFreshnessMs:120000,feeRateBps:10,additionalSlippageBps:5};
const quote={market:'options',price:2,status:'delayed',fetchedAt:at,bestBid:1.9,bestAsk:2.1,optionContract:{instrumentId:'option:us:SPY:2027-01-15:500:C',source:'fixture-exchange',verified:true,currency:'USD',multiplier:100,expiresAt:'2027-01-15T21:00:00Z'}};
test('option quote without verified identity multiplier currency or expiry cannot fill',()=>{
 for(const bad of [{...quote,optionContract:undefined},{...quote,optionContract:{...quote.optionContract,verified:false}},{...quote,optionContract:{...quote.optionContract,multiplier:0}},{...quote,optionContract:{...quote.optionContract,currency:'BTC'}},{...quote,optionContract:{...quote.optionContract,expiresAt:at}},{...quote,optionContract:{...quote.optionContract,instrumentId:'stock:us:SPY'}}])assert.equal(resolveRunnerFill(policy,bad,'BUY',new Date(at)).allowed,false);
 assert.equal(resolveRunnerFill(policy,quote,'BUY',new Date(at)).allowed,true);
});
test('option execution costs use premium times contract count times verified multiplier',()=>{
 const costs=calculateRunnerExecutionCosts(policy,quote,'BUY',2);assert.equal(costs.feeUsd,0.42);assert.equal(costs.slippageUsd,0.21);assert.equal(costs.spreadUsd,20);
 assert.throws(()=>calculateRunnerExecutionCosts(policy,quote,'BUY',0.5),/整数|合约/);
});
test('underlying aliases and contract-expiry disagreement never satisfy option execution identity',()=>{
 for(const identity of ['option:us:SPY','option:us:SPY:2027-02-30:500:C','option:us:SPY:2027-01-15:0:C','option:us:SPY:2027-02-15:500:C'])assert.equal(resolveRunnerFill(policy,{...quote,optionContract:{...quote.optionContract,instrumentId:identity}},'BUY',new Date(at)).allowed,false);
});
