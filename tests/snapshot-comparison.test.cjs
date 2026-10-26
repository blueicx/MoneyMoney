require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { createSnapshotComparisonStore, compareSavedSnapshots } = require('../src/features/snapshot-comparison');
const { createSnapshotComparisonRouter } = require('../src/web/snapshot-comparison-routes');
const { DataLakeCatalog } = require('../src/storage/data-lake');

const snap=(id,overrides={})=>({id,market:'stocks',instrument:'stock:us:AAPL',dataset:'bars',timeframe:'1d',asOf:'2026-10-01T00:00:00.000Z',partitionId:`part-${id}`,contentHash:id.padEnd(64,'0').slice(0,64),source:'provider-a',createdAt:'2026-10-02T00:00:00.000Z',...overrides});
const obs=(snapshot,close,extra={})=>({snapshot,rows:[{timestamp:snapshot.asOf,close}],dataStatus:'historical',publishedAt:snapshot.asOf,serverFetchedAt:snapshot.createdAt,sourceCapturedAt:null,adjustment:'split-adjusted',currency:'USD',session:'regular',coverage:{start:snapshot.asOf,end:snapshot.asOf,rows:1},...extra});
function stateFixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snapshot-choice-'));const db=new Database(path.join(dir,'state.sqlite'));db.exec('CREATE TABLE docs (key TEXT PRIMARY KEY, value TEXT)');const health={ok:true};return {dir,health,state:{get(key){const row=db.prepare('SELECT value FROM docs WHERE key=?').get(key);return row?JSON.parse(row.value):null;},set(key,value){db.prepare('INSERT OR REPLACE INTO docs VALUES (?,?)').run(key,JSON.stringify(value));},transaction(fn){return db.transaction(fn)();},appendAudit(){}},db};}

test('comparison requires 2-4 refs and canonical scope must match every saved snapshot',()=>{
 const a=snap('a'),b=snap('b',{asOf:'2026-10-02T00:00:00Z'});
 assert.throws(()=>compareSavedSnapshots({market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',references:[a],observations:[obs(a,100)]}),/2.*4/);
 assert.throws(()=>compareSavedSnapshots({market:'stocks',instrument:'stock:us:MSFT',timeframe:'1d',references:[a,b],observations:[obs(a,100),obs(b,101)]}),/identity|标的/i);
});

test('comparison exposes price, source, capture, adjustment, session, currency, and coverage while withholding unaligned explanations',()=>{
 const refs=[snap('a'),snap('b',{asOf:'2026-10-02T00:00:00Z',source:'provider-b'})];
 const result=compareSavedSnapshots({market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',references:refs,observations:[obs(refs[0],100),obs(refs[1],110,{session:null})]});
 assert.equal(result.dataStatus,'unavailable');assert.equal(result.explanations.length,0);
 assert.equal(result.references[0].price,100);assert.equal(result.references[1].source,'provider-b');assert.equal(result.references[0].serverFetchedAt,refs[0].createdAt);assert.equal(result.references[0].sourceDataTime,null);assert.equal(result.references[0].sourceCapturedAt,null);
 assert.equal(result.references[0].coverage.rows,1);assert.equal(result.references[1].session,'unknown');assert.match(result.reason,/session/i);
 const aligned=compareSavedSnapshots({market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',references:refs,observations:[obs(refs[0],100),obs(refs[1],110)]});
 assert.equal(aligned.explanations[0].changePct,10);
});

test('choice storage is append-only, bounded, idempotent, and detects corrupt content hashes',()=>{
 const f=stateFixture(),a=snap('a'),b=snap('b',{asOf:'2026-10-02T00:00:00Z'}),snapshots=new Map([[a.id,a],[b.id,b]]);
 try {const store=createSnapshotComparisonStore({state:f.state,resolveSnapshot:id=>snapshots.get(id)||null,resolveIdentity:(market,instrument)=>instrument==='stock:us:AAPL'?{market:'stocks',instrument:'stock:us:AAPL'}:null});
  const input={requestId:'request-1',idempotencyKey:'key-1',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',references:['a','b'],choice:'b',reason:'newer confirmed source'};
  const first=store.saveChoice(input),again=store.saveChoice(input);assert.equal(first.id,again.id);assert.equal(store.listChoices({market:'stocks',instrument:'stock:us:AAPL'}).length,1);assert.match(first.contentHash,/^[a-f0-9]{64}$/);
  assert.throws(()=>store.saveChoice({...input,reason:'changed'}),/request|idempotency|请求|幂等/i);
  const stored=f.state.get('snapshot-comparisons:v1');stored.records[0].reason='tampered';f.state.set('snapshot-comparisons:v1',stored);
  assert.throws(()=>store.listChoices({market:'stocks',instrument:'stock:us:AAPL'}),/hash|损坏|integrity/i);
 } finally {f.db.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('choice storage rejects bad bounds, request IDs, duplicates and cross-identity snapshots',()=>{
 const f=stateFixture(),a=snap('a'),b=snap('b',{instrument:'MSFT'}),snapshots=new Map([[a.id,a],[b.id,b]]);
 try {const store=createSnapshotComparisonStore({state:f.state,resolveSnapshot:id=>snapshots.get(id)||null,resolveIdentity:(market,instrument)=>({market,instrument:instrument==='MSFT'?'stock:us:MSFT':'stock:us:AAPL'})});const base={requestId:'request',idempotencyKey:'key',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',references:['a','b'],choice:'a',reason:'reason'};
  assert.throws(()=>store.saveChoice({...base,requestId:'x'.repeat(81)}),/字段|request/i);assert.throws(()=>store.saveChoice({...base,references:['a','a']}),/duplicate|重复/i);assert.throws(()=>store.saveChoice(base),/identity|标的/i);
 } finally {f.db.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('routes reject guests, missing CSRF, client quotes, cross-scope refs and filter choices by scope',async()=>{
 const refs=[snap('a',{instrument:'AAPL'}),snap('b',{instrument:'AAPL',asOf:'2026-10-02T00:00:00Z'})],saved=[];let authorized=false,csrf=false;
 const catalog={listSnapshots:()=>refs,getSnapshot:id=>refs.find(r=>r.id===id)||null,resolveInstrument:(market,id)=>market==='stocks'&&['stock:us:AAPL','AAPL'].includes(id)?{id:'stock:us:AAPL',symbol:'AAPL'}:null,readSnapshotBarsExact:async ref=>{if(ref.id==='b')throw Error('snapshot file hash mismatch');return {snapshot:ref,rows:[{timestamp:ref.asOf,close:100}],dataStatus:'historical',updatedAt:ref.asOf,adjustment:'split-adjusted',source:ref.source,currency:'USD',session:'regular',coverage:{start:ref.asOf,end:ref.asOf,rows:1}}}};
 const choices={listChoices:scope=>saved.filter(c=>c.market===scope.market&&c.instrument===scope.instrument),saveChoice:input=>{saved.push(input);return input;}};
 const app=express();app.use(express.json());app.use('/api/snapshot-comparisons',createSnapshotComparisonRouter({catalog,choices,adminOnly(_req,res){if(!authorized){res.status(403).json({success:false});return false;}return true;},csrfValid:()=>csrf}));const server=app.listen(0);const base=`http://127.0.0.1:${server.address().port}/api`;
 try {const post=async(url,body)=>fetch(base+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/snapshot-comparisons/choices?market=stocks&instrument=stock:us:AAPL')).status,403);authorized=true;
  assert.equal((await post('/snapshot-comparisons/compare',{market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',references:['a','b']})).status,403);csrf=true;
  assert.equal((await post('/snapshot-comparisons/compare',{market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',references:['a','b'],quotes:[1,2]})).status,400);
  assert.equal((await post('/snapshot-comparisons/compare',{market:'stocks',instrument:'stock:us:MSFT',timeframe:'1d',references:['a','b']})).status,400);
  const good=await post('/snapshot-comparisons/compare',{market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',references:['a','b']});assert.equal(good.status,200,JSON.stringify(await good.clone().json()));const compared=await good.json();assert.equal(compared.data.references.length,2);assert.equal(compared.data.references[1].price,null);assert.match(compared.data.references[1].reason,/hash/i);assert.equal(compared.data.explanations.length,0);
  saved.push({market:'crypto',instrument:'crypto:binance:BTCUSDT'});const list=await fetch(base+'/snapshot-comparisons/choices?market=stocks&instrument=stock:us:AAPL');const body=await list.json();assert.deepEqual(body.data,[]);
 } finally {server.close();}
});

test('catalog exact saved read preserves its original partitions after later data arrives',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snapshot-exact-')),catalog=new DataLakeCatalog({lakeRoot:path.join(dir,'lake'),databasePath:path.join(dir,'catalog.sqlite')});
 try {
  const bars=[{timestamp:'2026-10-01T00:00:00.000Z',open:10,high:11,low:9,close:10,volume:1}];
  await catalog.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'fixture',publishedAt:'2026-10-01T12:00:00.000Z',rows:bars});
  const captured=await catalog.queryBarsAsOf({market:'stocks',instrument:'AAPL',timeframe:'1d',asOf:'2026-10-02T00:00:00.000Z'});const saved=captured.snapshot;
  await catalog.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'fixture',publishedAt:'2026-10-03T12:00:00.000Z',rows:[{...bars[0],timestamp:'2026-10-03T00:00:00.000Z',high:13,close:12}]});
  const exact=await catalog.readSnapshotBarsExact(saved);assert.equal(exact.snapshot.id,saved.id);assert.equal(exact.rows.length,1);assert.equal(Number(exact.rows[0].close),10);assert.equal(exact.currency,null);assert.equal(exact.sourceCapturedAt,null);assert.ok(exact.serverFetchedAt);assert.equal(catalog.listSnapshots({market:'stocks',instrument:'AAPL',timeframe:'1d'}).some(item=>item.id===saved.id),true);
  const db=new Database(path.join(dir,'catalog.sqlite')),partitionId=saved.partitionId.split(',')[0],partitionPath=db.prepare('SELECT path FROM dataset_partitions WHERE id=?').get(partitionId).path;db.close();fs.appendFileSync(partitionPath,'tamper');
  await assert.rejects(()=>catalog.readSnapshotBarsExact(saved),/file hash/i);
 } finally {catalog.close();fs.rmSync(dir,{recursive:true,force:true});}
});
