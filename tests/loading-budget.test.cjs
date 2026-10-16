const test=require('node:test'),assert=require('node:assert/strict');
test('loading budget reports median limits and cannot call incomplete samples or mismatched profiles an improvement',()=>{
 const {assessLoadingBudget}=require('../scripts/lib/loading-budget.cjs');
 const samples=Array.from({length:3},(_,run)=>({viewport:1440,temperature:'cold',run,shellReadyMs:[2100,1900,2000][run],chartReadyMs:3500,jsBytes:120000}));
 const r=assessLoadingBudget(samples);assert.equal(r.status,'passed');assert.equal(r.groups[0].shellMedianMs,2000);assert.equal(r.improvementPct,null);
 assert.equal(assessLoadingBudget(samples.slice(0,2)).status,'insufficient');
 assert.equal(assessLoadingBudget(samples.map(s=>({...s,chartReadyMs:10000}))).status,'exceeded');
 assert.equal(assessLoadingBudget(samples.map(s=>({...s,shellReadyMs:NaN}))).status,'insufficient');
});
