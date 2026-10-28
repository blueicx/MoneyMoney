const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{JSDOM}=require('jsdom');
require('ts-node/register/transpile-only');

const asOf='2026-10-28T12:00:00.000Z';
function fixture(attempts=3){
  const saved={experiment:{id:'run_fixture',market:'stocks',instrument:'stock:us:AAPL',strategyVersion:'v2',dataSnapshotHash:'a'.repeat(64)},backtest:{startingBalance:10000,trades:Array.from({length:8},(_,index)=>({timeIndex:index*5,pnl:index%3===0?-100:140,holdingTime:2,price:100,executionPrice:101,volume:10}))},folds:[{trainStart:0,trainEnd:9,testStart:10,testEnd:14}],evidence:{outOfSample:{tradesCount:8}}};
  const trials=[
    {id:'trial_a',experimentId:null,market:'stocks',status:'failed',parameters:{threshold:1},configurationHash:'c1',strategyVersion:'v2',dataHash:'a'.repeat(64)},
    {id:'trial_b',experimentId:'run_fixture',market:'stocks',status:'succeeded',parameters:{threshold:2},configurationHash:'c2',strategyVersion:'v2',dataHash:'a'.repeat(64)},
    {id:'trial_c',experimentId:null,market:'stocks',status:'failed',parameters:{threshold:2},configurationHash:'c2',strategyVersion:'v2',dataHash:'a'.repeat(64)},
  ].map((row,index)=>({...row,completedAt:Date.parse(asOf)-1000-index}));
  return {saved,ledger:{market:'stocks',asOf:Date.parse(asOf),trials:trials.slice(0,attempts),attempts:attempts||0,uniqueConfigurations:attempts?2:0,reason:'only recorded attempts are known'}};
}

test('statistics audit preserves failed trials and uses a deterministic block interval plus multiplicity correction',()=>{
  const {auditResearchStatistics}=require('../src/features/research-statistics-audit'),data=fixture(),first=auditResearchStatistics({market:'stocks',experimentId:'run_fixture',asOf,...data}),second=auditResearchStatistics({market:'stocks',experimentId:'run_fixture',asOf,...data});
  assert.equal(first.contentHash,second.contentHash);
  assert.equal(first.ledger.attempts,3);assert.equal(first.ledger.failedTrials,2);assert.equal(first.ledger.currentTrialMatched,true);
  assert.equal(first.inference.multipleTesting.factor,3);assert.ok(first.inference.multipleTesting.adjustedPValue>=first.inference.naivePValue);
  assert.equal(first.inference.blockBootstrap.repetitions,2000);assert.equal(first.inference.blockBootstrap.confidence95.length,2);
  assert.equal(first.dependence.status,'not-detected');assert.equal(first.selectionBias.status,'observed');
  assert.equal(first.executionEnabled,false);assert.equal(first.ordersCreated,0);
});

test('statistics audit marks missing historical attempt counts unknown and never adjusts with an invented denominator',()=>{
  const {auditResearchStatistics}=require('../src/features/research-statistics-audit'),data=fixture(0),result=auditResearchStatistics({market:'stocks',experimentId:'run_fixture',asOf,...data});
  assert.equal(result.ledger.attempts,null);assert.equal(result.ledger.currentTrialMatched,false);
  assert.equal(result.inference.multipleTesting.available,false);assert.equal(result.inference.multipleTesting.adjustedPValue,null);
  assert.equal(result.selectionBias.status,'unknown');assert.ok(result.warnings.some(warning=>/历史尝试次数未知/.test(warning)));
});

test('statistics route requires admin and CSRF and never accepts client observations',async()=>{
  const express=require('express'),{createResearchStatisticsRouter}=require('../src/web/research-statistics-routes'),data=fixture(),app=express();
  app.use(express.json());app.use((req,res,next)=>{req.user={role:req.get('x-role')==='admin'?'admin':'guest'};next();});
  app.use('/api/research/statistics',createResearchStatisticsRouter({adminOnly:(req,res)=>{if(req.user.role==='admin')return true;res.status(403).json({success:false});return false;},csrfValid:req=>req.get('x-csrf-token')==='fixture-csrf',load:()=>data}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/api/research/statistics/audit-preview',admin={'content-type':'application/json','x-role':'admin'},body={market:'stocks',experimentId:'run_fixture',asOf};
  try{
    assert.equal((await fetch(url,{method:'POST',headers:admin,body:JSON.stringify(body)})).status,403);
    assert.equal((await fetch(url,{method:'POST',headers:{...admin,'x-csrf-token':'fixture-csrf'},body:JSON.stringify({...body,trades:[{pnl:9999}]})})).status,400);
    assert.equal((await fetch(url,{method:'POST',headers:{...admin,'x-csrf-token':'fixture-csrf'},body:JSON.stringify(body)})).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('statistics UI is embedded in research lab, escapes ledger text and aborts stale market contexts',async()=>{
  const source=fs.readFileSync('src/web/public/statistical-audit-workspace.js','utf8'),dom=new JSDOM('<div id="market-workspace-shell" data-market-scope="stocks" data-workspace="research-lab"><div id="mm-research-lab"></div></div>',{url:'https://test.invalid/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;w.mm_isLoggedIn=true;w.mm_isGuest=false;let signal;
  w.fetch=async(_url,options)=>{signal=options.signal;return {ok:true,json:async()=>({success:true,reason:'audited',data:{dataStatus:'historical',sample:{trades:3},ledger:{attempts:1,uniqueConfigurations:1,failedTrials:0,currentTrialMatched:true,trials:[{id:'<img src=x onerror=alert(1)>',status:'succeeded',strategyVersion:'v',configurationHash:'a'.repeat(64)}]},inference:{naivePValue:0.1,multipleTesting:{adjustedPValue:0.1},blockBootstrap:{confidence95:[1,2]}},dependence:{status:'unknown',reason:'unknown <script>x</script>'},selectionBias:{status:'unknown',reason:'unknown'},warnings:[],contentHash:'b'.repeat(64)}})};};
  try{
    w.eval(source);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const panel=w.document.getElementById('research-statistics-audit');assert.ok(panel);panel.querySelector('[data-statistics-id]').value='run_fixture';
    await panel.querySelector('[data-statistics-form]').onsubmit({preventDefault(){},currentTarget:panel.querySelector('[data-statistics-form]')});
    assert.equal(panel.querySelector('img,script'),null);assert.match(panel.textContent,/img src=x/);
    panel.querySelector('[data-statistics-output]').textContent='private';
    w.document.getElementById('market-workspace-shell').dataset.marketScope='crypto';w.dispatchEvent(new w.Event('mm-workspace-context'));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(panel.querySelector('[data-statistics-output]').textContent,'');assert.match(panel.textContent,/crypto/);
  }finally{dom.window.close();}
});
