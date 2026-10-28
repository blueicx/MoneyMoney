const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const Database=require('better-sqlite3');const {DataLakeCatalog}=require('../dist/storage/data-lake');
test('corporate action as-of uses saved versions rather than later enriched fields',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-action-versions-')),dbPath=path.join(dir,'catalog.sqlite');const catalog=new DataLakeCatalog({lakeRoot:path.join(dir,'lake'),databasePath:dbPath});
 try{
  const action={id:'dividend-1',market:'stocks',instrument:'AAPL',kind:'dividend',effectiveAt:'2026-01-10T00:00:00Z',factor:1,source:'fixture'};
  catalog.saveCorporateAction(action);await new Promise(r=>setTimeout(r,15));const cutoff=new Date().toISOString();await new Promise(r=>setTimeout(r,15));
  catalog.saveCorporateAction(action);
  const check=new Database(dbPath);try{assert.equal(check.prepare('SELECT count(*) AS n FROM corporate_action_versions WHERE action_id=?').get(action.id).n,1);}finally{check.close();}
  catalog.saveCorporateAction({...action,paymentAt:'2026-01-20T00:00:00Z',currency:'USD'});
  const old=catalog.listCorporateActionsAsOf({market:'stocks',instrument:'AAPL',asOf:cutoff});
  assert.equal(old.records.length,1);assert.equal(old.records[0].action.paymentAt,undefined);assert.equal(old.records[0].action.currency,undefined);
  await new Promise(r=>setTimeout(r,5));const current=catalog.listCorporateActionsAsOf({market:'stocks',instrument:'AAPL',asOf:new Date().toISOString()});
  const revisions=catalog.listCorporateActionVersionsAsOf({market:'stocks',instrument:'AAPL',asOf:new Date().toISOString()});assert.equal(revisions.records.length,2);assert.equal(revisions.records[1].action.currency,undefined);
  assert.equal(current.records[0].action.paymentAt,'2026-01-20T00:00:00.000Z');assert.match(current.records[0].contentHash,/^[a-f0-9]{64}$/);
  assert.equal(catalog.listCorporateActionsAsOf({market:'stocks',instrument:'AAPL',asOf:'2020-01-01T00:00:00Z'}).records.length,0);
  const db=new Database(dbPath);try{db.prepare('UPDATE corporate_action_versions SET action_json=? WHERE content_hash=?').run('{}',current.records[0].contentHash);}finally{db.close();}
  assert.throws(()=>catalog.listCorporateActionsAsOf({market:'stocks',instrument:'AAPL',asOf:new Date().toISOString()}),/hash|evidence|证据/i);
 }finally{catalog.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('legacy rows and later instrument changes cannot fabricate older version evidence',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-action-legacy-')),dbPath=path.join(dir,'catalog.sqlite');const catalog=new DataLakeCatalog({lakeRoot:path.join(dir,'lake'),databasePath:dbPath});
 try{
  const db=new Database(dbPath);try{db.prepare('INSERT INTO corporate_actions (id,market,instrument,kind,effective_at,factor,source) VALUES (?,?,?,?,?,?,?)').run('legacy','stocks','AAPL','split','2026-01-01T00:00:00.000Z',2,'old');}finally{db.close();}
  const input={market:'stocks',instrument:'AAPL',asOf:new Date().toISOString()};const legacy=catalog.listCorporateActionsAsOf(input);
  assert.equal(legacy.records.length,0);assert.equal(legacy.coverage,'partial');assert.match(legacy.reason,/旧记录/);
  catalog.saveCorporateAction({id:'change',market:'stocks',instrument:'AAPL',kind:'split',effectiveAt:'2026-01-01T00:00:00Z',factor:2,source:'fixture'});
  await new Promise(r=>setTimeout(r,10));
  catalog.saveCorporateAction({id:'change',market:'stocks',instrument:'MSFT',kind:'split',effectiveAt:'2026-01-01T00:00:00Z',factor:2,source:'fixture'});
  await new Promise(r=>setTimeout(r,5));assert.equal(catalog.listCorporateActionsAsOf({...input,asOf:new Date().toISOString()}).records.length,0);
  assert.throws(()=>catalog.listCorporateActionVersionsAsOf({...input,asOf:new Date().toISOString()}),/identity|身份/i);
  assert.throws(()=>catalog.listCorporateActionsAsOf({...input,asOf:new Date(Date.now()+60000).toISOString()}),/future|未来/i);
 }finally{catalog.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('same-millisecond revisions do not rewrite an earlier cutoff',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-action-clock-')),catalog=new DataLakeCatalog({lakeRoot:path.join(dir,'lake'),databasePath:path.join(dir,'catalog.sqlite')});const RealDate=global.Date,ms=RealDate.now();
 class FrozenDate extends RealDate{constructor(...args){super(...(args.length?args:[ms]));}static now(){return ms;}}
 try{
  global.Date=FrozenDate;
  const base={id:'clock',market:'stocks',instrument:'AAPL',kind:'dividend',effectiveAt:'2026-01-01T00:00:00Z',factor:1,source:'fixture'};
  catalog.saveCorporateAction(base);const cutoff=new RealDate(ms).toISOString();catalog.saveCorporateAction({...base,currency:'USD'});
  assert.equal(catalog.listCorporateActionsAsOf({market:'stocks',instrument:'AAPL',asOf:cutoff}).records[0].action.currency,undefined);
 }finally{global.Date=RealDate;catalog.close();fs.rmSync(dir,{recursive:true,force:true});}
});
