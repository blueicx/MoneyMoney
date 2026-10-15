const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const {reviewAiRunnerDecisions}=require('../src/features/ai-runner-diagnostics');
const base={id:'a',runnerId:'r',market:'stocks',instrument:'AAPL',at:'2026-10-15T01:00:00Z',dataStatus:'delayed',dataAt:'2026-10-15T00:59:55Z',source:'Nasdaq',strategyVersion:'v1',modelVersion:'m1',modelCallStatus:'success',signals:[],riskChecks:[],action:'NONE',reason:'无信号'};
test('inaction summary classifies structured evidence, not arbitrary prose, and never includes future or other-market rounds',()=>{
 const records=[base,{...base,id:'b',at:'2026-10-15T02:00:00Z',dataStatus:'failed',modelCallStatus:'failed'},
 {...base,id:'c',at:'2026-10-15T03:00:00Z',modelCallStatus:'failed'},
 {...base,id:'d',at:'2026-10-15T04:00:00Z',action:'REJECTED',riskChecks:[{name:'budget',passed:false,reason:'预算不足'}]},
 {...base,id:'e',at:'2026-10-15T05:00:00Z',action:'REJECTED',riskChecks:[{name:'maxDrawdown',passed:false,reason:'回撤'}]},
 {...base,id:'f',at:'2026-10-15T06:00:00Z',action:'NONE',reason:'预算不足（仅文本，不作结构化归因）',modelCallStatus:undefined},
 {...base,id:'future',at:'2026-10-16T01:00:00Z'}, {...base,id:'wrong',market:'crypto'}];
 const result=reviewAiRunnerDecisions(records,'r','stocks',[],'2026-10-15T07:00:00Z');
 assert.equal(result.inaction.total,6);assert.equal(result.rows.length,6);
 for(const key of ['no_opportunity','data_unqualified','model_failed','budget','risk_gate','unknown'])assert.equal(result.inaction.categories.find(row=>row.code===key).count,1);
 assert.equal(result.inaction.categories.find(row=>row.code==='budget').lastAt,'2026-10-15T04:00:00Z');
 assert.equal(result.inaction.observedSpanMs,5*3600000);assert.equal(result.inaction.executionChanges,0);
});
test('completed orders are not counted as inactivity and missing/duplicate timestamps are excluded explicitly',()=>{
 const result=reviewAiRunnerDecisions([{...base,id:'buy',action:'BUY'},base,{...base},{...base,id:'bad',at:'invalid'}],'r','stocks',[],'2026-10-15T07:00:00Z');
 assert.equal(result.inaction.total,1);assert.equal(result.inaction.observedSpanMs,0);
 assert.equal(result.duplicateRecords,1);assert.equal(result.invalidTimeRecords,1);
 assert.equal(result.inaction.categories[0].durationMs,null);
});
