const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');require('ts-node/register/transpile-only');
test('filled runner evidence persists immutable snapshot and decision, survives restart and rejects tampering',()=>{
 assert.ok(fs.existsSync('src/features/runner-execution-evidence.ts'),'durable runner evidence missing');
 const {SQLiteStateStore}=require('../src/storage/sqlite-state'),{RunnerExecutionEvidenceStore,runnerSnapshotHash}=require('../src/features/runner-execution-evidence');
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'mm-runner-evidence-')),'state.sqlite');let db=new SQLiteStateStore(file,path.dirname(file));
 const snapshot={market:'stocks',instrument:'AAPL',dataStatus:'delayed',source:'fixture',dataAt:'2026-10-07T23:59:00Z',price:100,quote:{market:'stocks',price:100,bestBid:99,bestAsk:101},candidateSignals:['fixture']};snapshot.snapshotHash=runnerSnapshotHash(snapshot);
 const record={id:'decision-1',runnerId:'runner-1',market:'stocks',instrument:'AAPL',snapshotHash:snapshot.snapshotHash,orderId:'order-1',action:'BUY',at:'2026-10-08T00:00:00Z',reason:'fixture',riskChecks:[],signals:[],idempotencyKey:'fixture'};
 try{
  let store=new RunnerExecutionEvidenceStore(db);const id=store.save(snapshot,record,'stock:us:AAPL','ai-runner:runner-1');assert.match(id,/^rs_/);db.close();db=new SQLiteStateStore(file,path.dirname(file));store=new RunnerExecutionEvidenceStore(db);
  assert.equal(store.snapshot(id).payload.quote.bestAsk,101);assert.equal(store.signal(record.id).orderId,'order-1');assert.equal(store.signal(record.id).snapshotIds[0],id);
  assert.throws(()=>store.save({...snapshot,price:200},record,'stock:us:AAPL','ai-runner:runner-1'),/Hash/);
  assert.throws(()=>store.save(snapshot,{...record,orderId:'other'},'stock:us:AAPL','ai-runner:runner-1'),/不可变|冲突/);
  assert.throws(()=>store.save(snapshot,{...record,market:'crypto'},'stock:us:AAPL','ai-runner:runner-1'),/市场|身份/);
  assert.throws(()=>store.save(snapshot,record,'stock:us:MU','ai-runner:runner-1'),/标的|身份/);
  assert.equal(store.signal(record.id).orderId,'order-1');
  const {paperChartLineage}=require('../src/features/paper-chart-lineage');
  const order={id:record.orderId,instrumentType:'stock',instrumentId:'stock:us:AAPL',accountId:'ai-runner:runner-1',runnerId:'runner-1',signalId:record.id,dataSnapshotId:id,price:101,quantity:1,side:'BUY',timestamp:'2026-10-08T00:00:01Z'};
  const ledger={orders:[],runnerAccounts:{'ai-runner:runner-1':{accountId:order.accountId,runnerId:record.runnerId,orders:[order]}}};
  assert.equal(paperChartLineage(ledger,'stocks',order.instrumentId,undefined,store).markers.length,1);
  // The same enclosing SQLite transaction owns ledger mutation AND immutable archive.
  assert.throws(()=>db.transaction(()=>{db.set('fixture:ledger',{orders:[order]});store.save(snapshot,{...record,orderId:'conflict'},order.instrumentId,order.accountId);}),/不可变|冲突/);
  assert.equal(db.get('fixture:ledger'),null);
  db.set('ai-runner:execution-snapshot:'+id,{...store.snapshot(id),hash:'bad'});assert.equal(store.snapshot(id),null);
  assert.equal(paperChartLineage(ledger,'stocks',order.instrumentId,undefined,store).markers.length,0);
 }finally{db.close();}
});
test('runner fill producers explicitly pass decision and durable snapshot references for both entry and exit',()=>{
 const server=fs.readFileSync('src/web/server.ts','utf8'),runner=fs.readFileSync('src/features/ai-paper-runner.ts','utf8');
 assert.ok((server.match(/signalId: record.id/g)||[]).length>=2,'entry and exit must link current decision');assert.ok(server.includes('runnerExecutionEvidence.save(snapshot,record,'));assert.ok((runner.match(/signalId: costs.signalId/g)||[]).length>=2);
});
