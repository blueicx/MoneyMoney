const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{JSDOM}=require('jsdom');
require('ts-node/register/transpile-only');

const at='2026-01-02T00:00:00.000Z',asOf='2026-10-28T00:00:00.000Z';
function fixtures(overrides={}){
  const {createEvidenceSnapshot}=require('../src/features/decision-intelligence');
  const income=createEvidenceSnapshot({id:'income-fixture',market:'stocks',instrument:'stock:us:AAPL',workspace:'three-statement',dataStatus:'historical',source:{id:'sec',name:'SEC fixture'},observedAt:at,fetchedAt:at,fields:{revenue:1000}});
  const balance=createEvidenceSnapshot({id:'balance-fixture',market:'stocks',instrument:'stock:us:AAPL',workspace:'three-statement',dataStatus:'historical',source:{id:'sec',name:'SEC fixture'},observedAt:at,fetchedAt:at,fields:{cash:1000,receivables:200,inventory:300,payables:300,ppe:500,debt:700,equity:1000,...overrides}});
  return {income,balance};
}
function input(evidence){
  return {
    market:'stocks',instrument:'stock:us:AAPL',asOf,evidence:{income:evidence.income.id,balance:evidence.balance.id},
    assumptions:{
      forecastYears:2,
      segments:[{id:'devices',label:'Devices',initialRevenuePct:60,growthPct:[10,8]},{id:'services',label:'Services',initialRevenuePct:40,growthPct:[12,15]}],
      cogsPctRevenue:[55,54],operatingExpensePctRevenue:[30,30],depreciationPctRevenue:[5,5],capexPctRevenue:[6,6],
      workingCapitalPctRevenue:25,receivablePctRevenue:20,inventoryPctRevenue:30,payablePctRevenue:30,interestRatePct:5,taxRatePct:20,
      debtRepaymentByYear:[50,50],
      financingScenarios:[{id:'base',label:'Base',equityIssuanceByYear:[0,0],debtIssuanceByYear:[0,0],dividendPayoutPct:[0,20]}],
    },
  };
}

test('three-statement model only publishes linked scenarios after cash and balance checks pass',()=>{
  const {ThreeStatementModelService}=require('../src/features/three-statement-model'),evidence=fixtures(),store=new ThreeStatementModelService({evidence:id=>id===evidence.income.id?evidence.income:id===evidence.balance.id?evidence.balance:null},()=>Date.parse(asOf));
  const result=store.preview(input(evidence));
  assert.equal(result.status,'balanced');
  assert.equal(result.scenarios.length,1);
  assert.equal(result.scenarios[0].incomeStatements.length,2);
  assert.equal(result.scenarios[0].balanceSheets.length,2);
  assert.equal(result.scenarios[0].cashFlows.length,2);
  assert.ok(result.scenarios[0].checks.every(check=>check.passed));
  assert.ok(result.scenarios[0].incomeStatements[0].segmentRevenue.devices>600);
  assert.ok(Math.abs(result.scenarios[0].balanceSheets[1].balanceDifference)<0.001);
  assert.equal(result.ordersCreated,0);assert.equal(result.modelCalls,0);assert.equal(result.contentHash.length,64);
});

test('failed opening or period balance exposes checks but no complete statement set',()=>{
  const {ThreeStatementModelService}=require('../src/features/three-statement-model'),evidence=fixtures({equity:900}),store=new ThreeStatementModelService({evidence:id=>id===evidence.income.id?evidence.income:id===evidence.balance.id?evidence.balance:null},()=>Date.parse(asOf));
  const result=store.preview(input(evidence));
  assert.equal(result.status,'rejected');
  assert.equal(result.checks.openingBalanced,false);
  assert.equal(result.scenarios[0].incomeStatements.length,0);
  assert.equal(result.scenarios[0].balanceSheets.length,0);
  assert.equal(result.scenarios[0].cashFlows.length,0);
  assert.match(result.reason,/勾稽失败/);
});

test('three-statement API is admin-only, CSRF protected and rejects client-supplied report fields',async()=>{
  const express=require('express'),{ThreeStatementModelService}=require('../src/features/three-statement-model'),{createThreeStatementRouter}=require('../src/web/three-statement-routes'),evidence=fixtures(),store=new ThreeStatementModelService({evidence:id=>id===evidence.income.id?evidence.income:id===evidence.balance.id?evidence.balance:null},()=>Date.parse(asOf)),app=express();
  app.use(express.json());app.use((req,res,next)=>{req.user={role:req.get('x-role')==='admin'?'admin':'guest'};next();});
  app.use('/api/research/three-statement',createThreeStatementRouter(store,{adminOnly:(req,res)=>{if(req.user.role==='admin')return true;res.status(403).json({success:false});return false;},csrfValid:req=>req.get('x-csrf-token')==='fixture-csrf'}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/api/research/three-statement/preview',admin={'content-type':'application/json','x-role':'admin'};
  try{
    assert.equal((await fetch(url,{method:'POST',headers:admin,body:JSON.stringify(input(evidence))})).status,403);
    assert.equal((await fetch(url,{method:'POST',headers:{...admin,'x-csrf-token':'fixture-csrf'},body:JSON.stringify({...input(evidence),clientMetrics:{netIncome:999}})})).status,400);
    assert.equal((await fetch(url,{method:'POST',headers:{...admin,'x-csrf-token':'fixture-csrf'},body:JSON.stringify(input(evidence))})).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('three-statement UI clears private results on context changes and sends no client statement result',async()=>{
  const source=fs.readFileSync('src/web/public/three-statement-workspace.js','utf8'),dom=new JSDOM('<div id="market-workspace-shell" data-market-scope="stocks" data-workspace="fundamentals" data-instrument="stock:us:AAPL"><section data-workspace-id="fundamentals"><div class="collapse-body"></div></section></div>',{url:'https://test.invalid/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  w.mm_isLoggedIn=true;w.mm_isGuest=false;let payload;
  w.fetch=async(_url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({success:true,reason:'calculated',data:{status:'rejected',contentHash:'a'.repeat(64),opening:{assets:1,liabilities:1,equity:0,balanceDifference:0},scenarios:[]}})};};
  try{
    w.eval(source);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const panel=w.document.getElementById('three-statement-model');panel.querySelector('[data-three-income]').value='income';panel.querySelector('[data-three-balance]').value='balance';
    await panel.querySelector('[data-three-statement-form]').onsubmit({preventDefault(){},currentTarget:panel.querySelector('[data-three-statement-form]')});
    assert.equal(payload.assumptions.forecastYears,2);assert.equal(Object.hasOwn(payload,'incomeStatement'),false);
    assert.match(panel.querySelector('[data-three-output]').textContent,/rejected/);
    panel.querySelector('[data-three-output]').textContent='private';
    w.document.getElementById('market-workspace-shell').dataset.instrument='stock:us:MSFT';w.dispatchEvent(new w.Event('mm-workspace-context'));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(panel.querySelector('[data-three-output]').textContent,'');assert.match(panel.textContent,/stock:us:MSFT/);
  }finally{w.close();}
});
