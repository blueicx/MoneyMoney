const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mm-forecast-evidence-'));process.env.MONEYMONEY_DATA_DIR=root;
const {normalizeSettlementEvidence}=require('../dist/features/prediction-settlement');
test.after(()=>{require('../dist/storage/sqlite-state').stateStore.close();fs.rmSync(root,{recursive:true,force:true});});
test('forecast calibration admits only exact official final outcomes with verifiable hashes and source time',()=>{
  const {isVerifiedForecastResolution}=require('../dist/features/forecast-lab');assert.equal(typeof isVerifiedForecastResolution,'function');
  const evidence=normalizeSettlementEvidence({platform:'Kalshi',marketId:'KXTEST-26',capturedAt:'2026-10-03T00:00:00Z',payload:{status:'settled',result:'YES',settlement_ts:'2026-10-02T00:00:00Z',rules_primary:'Rule'}});
  const item={key:'Kalshi::KXTEST-26',platform:'Kalshi',id:'KXTEST-26',outcome:'YES',resolvedAt:'2026-10-03T00:00:00Z',settlementEvidence:evidence};
  assert.equal(isVerifiedForecastResolution(item),true);assert.equal(isVerifiedForecastResolution({...item,settlementEvidence:undefined}),false);assert.equal(isVerifiedForecastResolution({...item,id:'OTHER-26'}),false);assert.equal(isVerifiedForecastResolution({...item,outcome:'NO'}),false);assert.equal(isVerifiedForecastResolution({...item,settlementEvidence:{...evidence,result:'NO'}}),false);assert.equal(isVerifiedForecastResolution({...item,settlementEvidence:{...evidence,settlementAt:null}}),false);assert.equal(isVerifiedForecastResolution({...item,settlementEvidence:{...evidence,sourceUrl:'https://example.com'}}),false);
});
test('manual legacy outcomes remain visible but do not contribute calibration samples',()=>{
  const {getForecastLabReport}=require('../dist/features/forecast-lab');fs.writeFileSync(path.join(root,'forecast-lab.json'),JSON.stringify({version:1,updatedAt:'2026-10-03',active:{},resolved:[{key:'Kalshi::KXTEST-26',platform:'Kalshi',id:'KXTEST-26',outcome:'YES',resolvedAt:'2026-10-03T00:00:00Z',snapshots:[{t:'2026-10-01T00:00:00Z',model:.8,market:.5}]}]}));const report=getForecastLabReport();assert.equal(report.resolvedCount,1);assert.equal(report.evaluatedSamples,0);assert.equal(report.excludedUnverifiedCount,1);assert.equal(report.resolvedCases[0].modelBrier,null);assert.match(report.verdictZh,/核验/);
});
test('forecast page labels unverified records instead of showing null or an invented zero Brier',()=>{
  const source=require('./helpers/dashboard-source.cjs').readDashboardSource(),render=source.match(/function renderForecastLab\(d\) \{[\s\S]*?\n\}/)[0],{getForecastLabReport}=require('../dist/features/forecast-lab');
  const html=require('node:vm').runInNewContext(render+';renderForecastLab(d);',{d:getForecastLabReport(),radarEscape:value=>String(value??''),forecastLabGroupTable:()=>'',forecastLabMetric:()=>''});assert.match(html,/未核验.*不参与校准/);assert.doesNotMatch(html,/null \/ null/);assert.doesNotMatch(html,/系统 Brier<\/strong> 0/);
});
test('an owner may reverify a preserved manual record against official evidence without deleting history or duplicating samples',async()=>{
 const {resolveForecastCase}=require('../dist/features/forecast-lab');
 const evidence=normalizeSettlementEvidence({platform:'Kalshi',marketId:'KXTEST-26',capturedAt:'2026-10-03T00:00:00Z',payload:{status:'settled',result:'YES',settlement_ts:'2026-10-02T00:00:00Z',rules_primary:'Rule'}});
 const result=await resolveForecastCase('Kalshi::KXTEST-26','YES',evidence);assert.ok(result,'saved manual records need a safe explicit verification path');assert.equal(result.resolvedCount,2);assert.equal(result.evaluatedCases,1);assert.equal(result.evaluatedSamples,1);assert.equal((await resolveForecastCase('Kalshi::KXTEST-26','YES',evidence)).resolvedCount,2);
 const saved=JSON.parse(fs.readFileSync(path.join(root,'forecast-lab.json'),'utf8'));assert.equal(saved.resolved[0].settlementEvidence,undefined,'the old unverified record remains unchanged');
});
test('the explicit verification button sends verify rather than an empty manual outcome',async()=>{
 const source=require('./helpers/dashboard-source.cjs').readDashboardSource(),handler=source.match(/async function resolveForecastLabCase\([^\n]*\) \{[\s\S]*?\n\}/)[0],{JSDOM}=require('jsdom'),dom=new JSDOM('<div id="forecast-lab-panel"></div>');let submitted;
 try{await require('node:vm').runInNewContext(handler+';resolveForecastLabCase("Kalshi%3A%3AKXTEST-26","",true);',{document:dom.window.document,fetch:async(_,request)=>{submitted=JSON.parse(request.body);return {json:async()=>({success:true,data:{}})};},renderForecastLab:()=> 'verified',radarEscape:value=>String(value??'')});assert.equal(submitted.verify,true);}finally{dom.window.close();}
});
test('concurrent official reverification is serialized and records one revision without losing prior evidence',async()=>{
 const {resolveForecastCase}=require('../dist/features/forecast-lab'),evidence=normalizeSettlementEvidence({platform:'Kalshi',marketId:'KXTEST-26',capturedAt:'2026-10-04T00:00:00Z',payload:{status:'settled',result:'YES',settlement_ts:'2026-10-02T00:00:00Z',rules_primary:'Rule revised'}});
 const results=await Promise.all([resolveForecastCase('Kalshi::KXTEST-26','YES',evidence),resolveForecastCase('Kalshi::KXTEST-26','YES',evidence)]);assert.ok(results.every(row=>row.resolvedCount===3));assert.ok(results.every(row=>row.evaluatedSamples===1));const saved=JSON.parse(fs.readFileSync(path.join(root,'forecast-lab.json'),'utf8'));assert.equal(saved.resolved.length,3);
});
test('another process lease blocks mutations without altering JSON and a rejected queue can recover',async()=>{
 const {stateStore}=require('../dist/storage/sqlite-state'),{resolveForecastCase}=require('../dist/features/forecast-lab'),file=path.join(root,'forecast-lab.json'),before=fs.readFileSync(file,'utf8');
 assert.equal(stateStore.acquireLease('forecast-lab-write','other-worker'),true);
 try{await assert.rejects(resolveForecastCase('Kalshi::KXTEST-26','YES'),/另一实例/);assert.equal(fs.readFileSync(file,'utf8'),before);}finally{stateStore.releaseLease('forecast-lab-write','other-worker');}
 assert.equal(await resolveForecastCase('unknown','YES'),null);
});
