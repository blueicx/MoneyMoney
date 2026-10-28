const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node/register/transpile-only');
const {createEvidenceSnapshot}=require('../src/features/decision-intelligence');
function fixture(){
 const {SQLiteStateStore}=require('../src/storage/sqlite-state'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-universe-'));
 const state=new SQLiteStateStore(path.join(dir,'state.sqlite'),dir),rows=new Map();
 const evidence=(fields,extra={})=>createEvidenceSnapshot({market:'stocks',workspace:'research-lab',dataStatus:'historical',source:{id:'fixture',name:'Isolated fixture'},observedAt:'2025-01-01T00:00:00.000Z',fetchedAt:'2025-01-02T00:00:00.000Z',fields,...extra});
 return {state,rows,evidence,close:()=>state.close()};
}
test('historical universe freezes server evidence and preserves unknown industry and delisting',()=>{
 const f=fixture();try{
  const {HistoricalUniverseStore}=require('../src/features/historical-universe'),now=Date.parse('2025-06-01T00:00:00Z');
  const row=f.evidence({members:[{instrument:'stock:us:AAPL',industry:'Technology',status:'active'},{instrument:'stock:us:OLD',industry:null,status:'delisted'}]});f.rows.set(row.id,row);
  const store=new HistoricalUniverseStore(f.state,id=>f.rows.get(id)||null,()=>now);
  const saved=store.capture({market:'stocks',evidenceId:row.id,asOf:'2025-02-01T00:00:00Z',requestId:'universe-request-0001'});
  assert.equal(saved.members.length,2);assert.equal(saved.members[1].status,'delisted');assert.equal(saved.members[1].industry,null);assert.equal(saved.evidenceHash,row.hash);
  assert.equal(store.capture({market:'stocks',evidenceId:row.id,asOf:'2025-02-01T00:00:00Z',requestId:'universe-request-0001'}).id,saved.id);
  f.rows.get(row.id).fields.members=[];assert.equal(store.read(saved.id).members.length,2);
  assert.match(store.read(saved.id).reason,/观察|覆盖/);
 }finally{f.close();}
});
test('historical universe refuses future fetch, forged evidence, duplicate identities and cross-market members',()=>{
 const f=fixture();try{
  const {HistoricalUniverseStore}=require('../src/features/historical-universe'),store=new HistoricalUniverseStore(f.state,id=>f.rows.get(id)||null,()=>Date.parse('2025-06-01T00:00:00Z'));
  const row=f.evidence({members:[{instrument:'stock:us:AAPL',industry:null,status:'unknown'}]});f.rows.set(row.id,row);
  const input={market:'stocks',evidenceId:row.id,asOf:'2025-01-01T12:00:00Z',requestId:'universe-request-0002'};
  assert.throws(()=>store.capture(input),/时间|时点|未来/);
  row.fields.members.push({instrument:'stock:us:AAPL',industry:null,status:'unknown'});assert.throws(()=>store.capture({...input,asOf:'2025-02-01T00:00:00Z'}),/Hash|证据/);
  for(const members of [[{instrument:'crypto:binance:BTCUSDT',industry:null,status:'unknown'}],[{instrument:'stock:us:AAPL',industry:null,status:'unknown'},{instrument:'stock:us:AAPL',industry:null,status:'unknown'}]]){
   const invalid=f.evidence({members});f.rows.set(invalid.id,invalid);assert.throws(()=>store.capture({...input,evidenceId:invalid.id,asOf:'2025-02-01T00:00:00Z'}),/成员|身份|重复/);
  }
 }finally{f.close();}
});
test('historical cutoff requires an explicit timezone and stored contents cannot be silently changed',()=>{
 const f=fixture();try{
  const {HistoricalUniverseStore}=require('../src/features/historical-universe'),store=new HistoricalUniverseStore(f.state,id=>f.rows.get(id)||null,()=>Date.parse('2025-06-01T00:00:00Z'));
  const row=f.evidence({members:[{instrument:'stock:us:AAPL',industry:null,status:'unknown'}]});f.rows.set(row.id,row);
  const input={market:'stocks',evidenceId:row.id,asOf:'2025-02-01T00:00:00',requestId:'universe-request-0003'};
  assert.throws(()=>store.capture(input),/时区|时点/);
  const saved=store.capture({...input,asOf:'2025-02-01T00:00:00Z'});const modified=f.state.get('historical-universe:record:'+saved.id);modified.members[0].status='delisted';f.state.set('historical-universe:record:'+saved.id,modified,1);
  assert.throws(()=>store.read(saved.id),/Hash/);
 }finally{f.close();}
});
test('unavailable or failed source evidence cannot be frozen as a member observation',()=>{
 const f=fixture();try{
  const {HistoricalUniverseStore}=require('../src/features/historical-universe'),store=new HistoricalUniverseStore(f.state,id=>f.rows.get(id)||null,()=>Date.parse('2025-06-01T00:00:00Z'));
  for(const dataStatus of ['unavailable','failed']){
   const row=f.evidence({members:[{instrument:'stock:us:AAPL',industry:null,status:'unknown'}]},{dataStatus});f.rows.set(row.id,row);
   assert.throws(()=>store.capture({market:'stocks',evidenceId:row.id,asOf:'2025-02-01T00:00:00Z',requestId:'universe-request-0004'}),/状态|不可用/);
  }
 }finally{f.close();}
});
