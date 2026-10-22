const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node/register/transpile-only');
const {DataLakeCatalog}=require('../src/storage/data-lake');
function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'mm-contract-metrics-'));return {root,c:new DataLakeCatalog({lakeRoot:path.join(root,'lake'),databasePath:path.join(root,'catalog.sqlite')})};}
const snapshot=(at,oi=100)=>({market:'crypto',instrument:'crypto:gateio:BTC_USDT',source:'Gate public API · USDT 线性合约',retrievedAt:at,dataStatus:'delayed',sourceTime:null,quote:{openInterestUsd:oi,basisPct:-.2},series:{openInterest:{unit:'USDT'},basis:{unit:'%'}},sections:{quote:{dataStatus:'delayed',source:'https://api.gateio.ws/api/v4/futures/usdt/contracts/BTC_USDT'}}});

test('contract catalog declares quote schema only for partitions that actually archive prices',async()=>{
 const {root,c}=setup();let db;try{const a=snapshot('2026-10-01T00:00:00Z');a.quote.markPrice=100;await c.stageContractMetrics(a);await c.stageContractMetrics(snapshot('2026-10-01T00:05:00Z'));const Database=require('better-sqlite3');db=new Database(path.join(root,'catalog.sqlite'),{readonly:true});const rows=db.prepare('SELECT field_version FROM dataset_manifests ORDER BY created_at').all();assert.deepEqual(rows.map(r=>r.field_version),['contract-metrics-v3-quotes','contract-metrics-v2-units']);}finally{db?.close();c.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('contract archive retains actual mark/index/last quotes separately and does not infer missing old quotes',async()=>{const {root,c}=setup();try{const a=snapshot('2026-10-01T00:00:00Z');a.quote={...a.quote,markPrice:100,indexPrice:101,lastPrice:99};await c.stageContractMetrics(a);const legacy=await c.stageContractMetrics(snapshot('2026-10-01T00:05:00Z')),bytes=fs.readFileSync(legacy.path);const h=await c.queryContractMetrics({market:'crypto',instrument:a.instrument});assert.ok(h.rows[0].quoteJson,'source prices were discarded');assert.deepEqual(JSON.parse(h.rows[0].quoteJson),{currency:'USDT',lastPrice:99,markPrice:100,indexPrice:101});assert.equal(h.rows[1].quoteJson,undefined,'legacy format without quote columns must remain readable, not backfilled');assert.deepEqual(fs.readFileSync(legacy.path),bytes,'query never rewrites legacy files or hashes');const bad=snapshot('2026-10-01T00:10:00Z');bad.quote.markPrice=-1;await assert.rejects(()=>c.stageContractMetrics(bad),/报价|价格/);}finally{c.close();fs.rmSync(root,{recursive:true,force:true});}});
test('contract metrics use bounded atomic Parquet and actual retrieval times without inventing source timestamps',async()=>{
 const {root,c}=setup();try{assert.equal(typeof c.stageContractMetrics,'function');const a=await c.stageContractMetrics(snapshot('2026-10-01T00:00:00Z'));const duplicate=await c.stageContractMetrics(snapshot('2026-10-01T00:01:00Z',120));assert.equal(a.id,duplicate.id);await c.stageContractMetrics(snapshot('2026-10-01T00:05:00Z',130));
 const history=await c.queryContractMetrics({market:'crypto',instrument:a.instrument,asOf:'2026-10-01T00:03:00Z'});assert.equal(history.rows.length,1);assert.equal(history.rows[0].openInterestUsd,100);assert.equal(history.rows[0].sourceTime,null);assert.deepEqual(history.rows[0].units,{openInterestUsd:'USDT',basisPct:'%'});assert.deepEqual(history.units,{openInterestUsd:'USDT',basisPct:'%'});assert.equal(history.fieldVersion,'contract-metrics-v2-units');assert.equal(history.timeBasis,'retrievedAt');assert.equal(fs.readdirSync(path.join(root,'lake','.staging')).length,0);assert.ok(a.path.endsWith('.parquet'));
 const full=await c.queryContractMetrics({market:'crypto',instrument:a.instrument});assert.equal(full.rows.length,2);assert.equal(full.rows[1].openInterestUsd,130);assert.equal(c.getDiagnostics().byDataset['contract-metrics'],2);
 }finally{c.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('contract metrics reject unsupported market, mismatched source, nonfinite fields and future data',async()=>{
 const {root,c}=setup();try{assert.equal(typeof c.stageContractMetrics,'function');for(const changed of [{market:'stocks'},{instrument:'crypto:gateio-delivery:BTC_USDT_20261009'},{dataStatus:'unavailable'},{retrievedAt:'2999-01-01T00:00:00Z'},{quote:{openInterestUsd:-1,basisPct:NaN}},{series:{openInterest:{unit:'BTC'},basis:{unit:'%'}}},{series:{openInterest:{unit:'USDT'},basis:{unit:'fraction'}}}])await assert.rejects(()=>c.stageContractMetrics({...snapshot('2026-10-01T00:00:00Z'),...changed}));assert.equal(c.listPartitions().length,0);await assert.rejects(()=>c.queryContractMetrics({market:'stocks',instrument:'crypto:gateio:BTC_USDT'}));
 }finally{c.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('corrupted contract partitions are isolated while valid history survives',async()=>{
 const {root,c}=setup();try{const a=await c.stageContractMetrics(snapshot('2026-10-01T00:00:00Z'));await c.stageContractMetrics(snapshot('2026-10-01T00:05:00Z',130));fs.writeFileSync(a.path,'corrupted');const history=await c.queryContractMetrics({market:'crypto',instrument:a.instrument});assert.equal(history.dataStatus,'partial');assert.equal(history.rows.length,1);assert.equal(history.rows[0].openInterestUsd,130);assert.match(history.reason,/Hash/);
 }finally{c.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('contract history pagination is exclusive and never repeats the boundary observation',async()=>{
 const {root,c}=setup();try{for(let i=0;i<3;i++)await c.stageContractMetrics(snapshot(new Date(Date.parse('2026-10-01T00:00:00Z')+i*300000).toISOString(),100+i));const last=await c.queryContractMetrics({market:'crypto',instrument:'crypto:gateio:BTC_USDT',limit:2});assert.equal(last.rows.length,2);assert.equal(last.hasEarlier,true);const prior=await c.queryContractMetrics({market:'crypto',instrument:last.instrument,before:last.nextBefore,limit:2});assert.equal(prior.rows.length,1);assert.equal(prior.rows[0].openInterestUsd,100);
 }finally{c.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('contract snapshots persist source-confirmed rules without changing older records or inventing effective time',async()=>{
 const {root,c}=setup();try{
  await c.stageContractMetrics({...snapshot('2026-10-01T00:00:00Z'),contractRules:{multiplier:.001,fundingIntervalSeconds:28800,settlementCurrency:'USDT',inDelisting:false,status:null,leverageMax:20,maintenanceRate:.005,takerFeeRate:.0005}});
  const h=await c.queryContractMetrics({market:'crypto',instrument:'crypto:gateio:BTC_USDT'});
  const rules=JSON.parse(h.rows[0].rulesJson);assert.equal(rules.multiplier,.001);assert.equal(rules.inDelisting,false);assert.equal(rules.status,null);
  assert.equal(rules.leverageMax,20);assert.equal(rules.maintenanceRate,.005);assert.equal(rules.takerFeeRate,.0005);assert.equal(rules.effectiveAt,undefined);assert.ok(h.rows[0].contentHash);
 }finally{c.close();fs.rmSync(root,{recursive:true,force:true});}
});
