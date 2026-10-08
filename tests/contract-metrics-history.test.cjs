const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node/register/transpile-only');
const {DataLakeCatalog}=require('../src/storage/data-lake');
function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'mm-contract-metrics-'));return {root,c:new DataLakeCatalog({lakeRoot:path.join(root,'lake'),databasePath:path.join(root,'catalog.sqlite')})};}
const snapshot=(at,oi=100)=>({market:'crypto',instrument:'crypto:gateio:BTC_USDT',source:'Gate public API · USDT 线性合约',retrievedAt:at,dataStatus:'delayed',sourceTime:null,quote:{openInterestUsd:oi,basisPct:-.2},sections:{quote:{dataStatus:'delayed',source:'https://api.gateio.ws/api/v4/futures/usdt/contracts/BTC_USDT'}}});
test('contract metrics use bounded atomic Parquet and actual retrieval times without inventing source timestamps',async()=>{
 const {root,c}=setup();try{assert.equal(typeof c.stageContractMetrics,'function');const a=await c.stageContractMetrics(snapshot('2026-10-01T00:00:00Z'));const duplicate=await c.stageContractMetrics(snapshot('2026-10-01T00:01:00Z',120));assert.equal(a.id,duplicate.id);await c.stageContractMetrics(snapshot('2026-10-01T00:05:00Z',130));
 const history=await c.queryContractMetrics({market:'crypto',instrument:a.instrument,asOf:'2026-10-01T00:03:00Z'});assert.equal(history.rows.length,1);assert.equal(history.rows[0].openInterestUsd,100);assert.equal(history.rows[0].sourceTime,null);assert.equal(history.timeBasis,'retrievedAt');assert.equal(fs.readdirSync(path.join(root,'lake','.staging')).length,0);assert.ok(a.path.endsWith('.parquet'));
 const full=await c.queryContractMetrics({market:'crypto',instrument:a.instrument});assert.equal(full.rows.length,2);assert.equal(full.rows[1].openInterestUsd,130);assert.equal(c.getDiagnostics().byDataset['contract-metrics'],2);
 }finally{c.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('contract metrics reject unsupported market, mismatched source, nonfinite fields and future data',async()=>{
 const {root,c}=setup();try{assert.equal(typeof c.stageContractMetrics,'function');for(const changed of [{market:'stocks'},{instrument:'crypto:gateio-delivery:BTC_USDT_20261009'},{dataStatus:'unavailable'},{retrievedAt:'2999-01-01T00:00:00Z'},{quote:{openInterestUsd:-1,basisPct:NaN}}])await assert.rejects(()=>c.stageContractMetrics({...snapshot('2026-10-01T00:00:00Z'),...changed}));assert.equal(c.listPartitions().length,0);await assert.rejects(()=>c.queryContractMetrics({market:'stocks',instrument:'crypto:gateio:BTC_USDT'}));
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
