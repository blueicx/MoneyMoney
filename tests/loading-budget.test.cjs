const test=require('node:test'),assert=require('node:assert/strict');
const {assessLoadingBudget}=require('../scripts/lib/loading-budget.cjs');
function matrix(){return [1440,390].flatMap(viewport=>['cold','warm'].flatMap(temperature=>Array.from({length:3},(_,run)=>({viewport,temperature,run,shellReadyMs:temperature==='cold'?2000:500,chartReadyMs:temperature==='cold'?3500:800,jsBytes:temperature==='cold'?120000:0}))));}
test('loading budget reports median limits and cannot call incomplete samples or mismatched profiles an improvement',()=>{
 const samples=matrix();
 const r=assessLoadingBudget(samples);assert.equal(r.status,'passed');assert.equal(r.groups[0].shellMedianMs,2000);assert.equal(r.improvementPct,null);
 assert.equal(assessLoadingBudget(samples.slice(0,2)).status,'insufficient');
 assert.equal(assessLoadingBudget(samples.map(s=>({...s,chartReadyMs:10000}))).status,'exceeded');
 assert.equal(assessLoadingBudget(samples.map(s=>({...s,shellReadyMs:NaN}))).status,'insufficient');
});
test('all desktop/mobile cold/warm groups are required, not just the measured subset',()=>{
 for(const viewport of [1440,390])for(const temperature of ['cold','warm']){
  const samples=matrix().filter(row=>row.viewport!==viewport||row.temperature!==temperature);
  const result=assessLoadingBudget(samples);
  assert.equal(result.status,'insufficient');
  assert.ok(result.groups.some(group=>group.viewport===viewport&&group.temperature===temperature&&group.samples===0));
 }
 assert.equal(assessLoadingBudget([]).status,'insufficient');
});
test('duplicated or invalid samples cannot skew medians into a passing result',()=>{
 const duplicate=matrix();duplicate.push({...duplicate[0],shellReadyMs:0});
 assert.equal(assessLoadingBudget(duplicate).status,'insufficient');
 const invalid=matrix();invalid.push({...invalid[0],run:3,shellReadyMs:NaN});
 assert.equal(assessLoadingBudget(invalid).status,'insufficient');
 for(const run of [undefined,-1,0.5,'1']){
  const samples=matrix();samples[0].run=run;
  assert.equal(assessLoadingBudget(samples).status,'insufficient');
 }
});
test('cold and warm measurements must belong to the same run pairs',()=>{
 const samples=matrix();for(const row of samples)if(row.viewport===390&&row.temperature==='warm')row.run+=10;
 assert.equal(assessLoadingBudget(samples).status,'insufficient');
});
test('unknown viewport or temperature cannot be evaluated as a complete standard matrix',()=>{
 const samples=matrix();samples.push({...samples[0],viewport:800});
 assert.equal(assessLoadingBudget(samples).status,'insufficient');
 const unknown=matrix();unknown[0].temperature='hot';
 assert.equal(assessLoadingBudget(unknown).status,'insufficient');
});
