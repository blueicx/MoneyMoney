const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('risk budget groups the same instrument across accounts, preserves currency and does not create orders',()=>{
 const {previewPortfolioRiskBudget}=require('../src/features/portfolio-risk-budget');
 const rows=[{market:'stocks',instrument:'stock:us:AAPL',currency:'USD',quantity:4,price:100},{market:'stocks',instrument:'stock:us:AAPL',currency:'USD',quantity:4,price:100},{market:'stocks',instrument:'stock:us:MU',currency:'USD',quantity:2,price:100}];const saved=JSON.stringify(rows);
 const r=previewPortfolioRiskBudget(rows,20);assert.equal(r.positions[0].currentPct,80);assert.equal(r.positions[0].targetPct,20);assert.equal(r.cashReserveAmount,600);assert.equal(r.before.largestWeightPct,80);assert.equal(r.after.largestWeightPct,20);assert.equal(r.after.dailyVolatilityPct,null);assert.equal(r.orderChanges,0);assert.equal(JSON.stringify(rows),saved);
 assert.equal(previewPortfolioRiskBudget([{...rows[0],currency:'UNKNOWN'}],20).dataStatus,'unavailable');
 assert.equal(previewPortfolioRiskBudget([rows[0],{...rows[1],currency:'HKD'}],20).dataStatus,'unavailable');
 assert.equal(previewPortfolioRiskBudget([{...rows[0],market:'options'}],20).dataStatus,'unsupported');
});
test('risk comparison keeps original capital including explicit zero-return cash rather than renormalizing reduced holdings',()=>{
 const {previewPortfolioRiskBudget}=require('../src/features/portfolio-risk-budget');const rows=[{market:'stocks',instrument:'stock:us:AAPL',currency:'USD',quantity:10,price:100}];
 const r=previewPortfolioRiskBudget(rows,20,{dataStatus:'historical',instruments:['stock:us:AAPL'],covariance:[[.0004]]});assert.equal(r.before.dailyVolatilityPct,2);assert.ok(Math.abs(r.after.dailyVolatilityPct-.4)<1e-10);assert.equal(r.cashReserveAmount,800);
 assert.equal(previewPortfolioRiskBudget(rows,20,{dataStatus:'historical',instruments:['other'],covariance:[[.0004]]}).after.dailyVolatilityPct,null);
 assert.throws(()=>previewPortfolioRiskBudget(rows,0));
});
