const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const now=Date.parse('2026-10-01T00:00:00Z'),instrument='crypto:gateio:BTC_USDT',scenario={entryPrice:100,quantity:1,leverage:5,feeRate:.001,fundingRate:0,fundingPeriods:1,shockPct:-10,side:'long'};
function detail(){return {market:'crypto',instrument,retrievedAt:new Date(now).toISOString(),sections:{quote:{source:'https://api.gateio.ws/api/v4/futures/usdt/contracts/BTC_USDT',dataStatus:'delayed'}},contractRules:{multiplier:.001,settlementCurrency:'USDT',maintenanceRate:.005,leverageMax:20,takerFeeRate:.0005}};}
test('rule-based stress binds current official source metadata hash without claiming liquidation or historical effective time',()=>{
 const {reviewContractRuleStress}=require('../src/features/contract-research');assert.equal(typeof reviewContractRuleStress,'function');
 const result=reviewContractRuleStress(detail(),scenario,now);assert.equal(result.dataStatus,'partial');assert.match(result.ruleVersionHash,/^[a-f0-9]{64}$/);assert.equal(result.effectiveAt,null);assert.equal(result.historicalRecalculationEnabled,false);assert.equal(result.estimatedMaintenanceUSDT,.45);assert.equal(result.liquidationPrice,null);assert.equal(result.executionEnabled,false);assert.equal(result.assumedEntryPrice,100);assert.match(result.reason,/阶梯|强平/);
 assert.equal(result.ruleVersionHash,reviewContractRuleStress(detail(),scenario,now).ruleVersionHash);
});
test('stale, foreign, incomplete or leverage-incompatible rule metadata fails closed',()=>{
 const {reviewContractRuleStress}=require('../src/features/contract-research');assert.equal(typeof reviewContractRuleStress,'function');
 for(const mutate of [d=>d.instrument='stock:us:AAPL',d=>d.retrievedAt=new Date(now-60000).toISOString(),d=>d.retrievedAt=new Date(now+1).toISOString(),d=>d.contractRules.maintenanceRate=null,d=>d.contractRules.leverageMax=2,d=>d.sections.quote.source='https://example.invalid/fake',d=>d.contractRules.settlementCurrency='USD']){
  const d=detail();mutate(d);assert.equal(reviewContractRuleStress(d,scenario,now).dataStatus,'unavailable');
 }
});
test('rule stress is opt-in on the existing private scenario endpoint and disallows client-supplied rule versions',()=>{
 const fs=require('node:fs'),server=fs.readFileSync('src/web/server.ts','utf8'),start=server.indexOf("app.post('/api/contracts/scenario'"),end=server.indexOf("app.get('/api/contracts/compare'",start),route=server.slice(start,end);
 assert.match(route,/adminOnly/);assert.match(route,/verifyRules===true/);assert.match(route,/reviewContractRuleStress/);assert.match(route,/contractResearchService.detail/);
});
test('workspace explicitly opts in to source rule review and keeps missing fields or effective dates unknown',()=>{
 const fs=require('node:fs'),ui=fs.readFileSync('src/web/public/contracts-workspace.js','utf8');assert.ok(ui.includes('data-scenario-rules'));assert.ok(ui.includes('verifyRules:'));assert.ok(ui.includes('ruleVersionHash'));
});
test('overflowed stresses and malformed archived margin rules remain unavailable',()=>{
 const {reviewContractRuleStress}=require('../src/features/contract-research');assert.equal(reviewContractRuleStress(detail(),{...scenario,quantity:1e308},now).dataStatus,'unavailable');
 const {compareArchivedContractRules}=require('../src/features/contract-panel-history'),d=detail();
 const rows=[{market:'crypto',instrument,source:d.sections.quote.source,retrievedAt:d.retrievedAt,rulesJson:JSON.stringify({...d.contractRules,maintenanceRate:-.2})}];
 assert.equal(compareArchivedContractRules({instrument,rows,asOf:d.retrievedAt}).dataStatus,'unavailable');
});
