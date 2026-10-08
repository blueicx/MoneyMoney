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
test('execution evidence is returned only for the exact persisted order, account, signal and snapshot',()=>{
 const {SQLiteStateStore}=require('../src/storage/sqlite-state'),{RunnerExecutionEvidenceStore,runnerSnapshotHash}=require('../src/features/runner-execution-evidence');
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'mm-runner-evidence-link-')),'state.sqlite'),db=new SQLiteStateStore(file,path.dirname(file));
 const snapshot={market:'stocks',instrument:'AAPL',dataStatus:'delayed',source:'Yahoo',dataAt:'2026-10-08T10:00:00Z',price:100,rsi14:31,sma10:98,quote:{market:'stocks',price:100,bestBid:99,bestAsk:101,fetchedAt:'2026-10-08T10:00:00Z'},evidence:[{dataset:'bars',source:'Yahoo 1m',status:'delayed',dataAt:'2026-10-08T10:00:00Z',retrievedAt:'2026-10-08T10:00:01Z'}],candidateSignals:['RSI14=31 超卖']};snapshot.snapshotHash=runnerSnapshotHash(snapshot);
 const record={id:'decision-link-1',runnerId:'runner-link-1',market:'stocks',instrument:'AAPL',snapshotHash:snapshot.snapshotHash,orderId:'order-link-1',action:'BUY',at:'2026-10-08T10:00:01Z',dataStatus:'delayed',source:'Yahoo',dataAt:snapshot.dataAt,evidence:snapshot.evidence,signals:['RSI14 超卖'],riskChecks:[{name:'fresh quote',passed:true}],reason:'verified test decision',strategyVersion:'rsi-v2',idempotencyKey:'fixture'};
 const order={id:record.orderId,instrumentType:'stock',instrumentId:'stock:us:AAPL',accountId:'ai-runner:runner-link-1',runnerId:record.runnerId,signalId:record.id,dataSnapshotId:'rs_'+snapshot.snapshotHash,price:100,quantity:1,side:'BUY',timestamp:'2026-10-08T10:00:02Z',strategyVersion:'rsi-v2'};
 const account={accountId:order.accountId,runnerId:record.runnerId,startingCash:1000,cash:900,positions:[],orders:[order],realizedPnl:0,peakEquity:1000,maxDrawdownPct:0};
 const ledger={startingCash:1000,cash:1000,positions:[],orders:[],realizedPnl:0,peakEquity:1000,maxDrawdownPct:0,runnerAccounts:{[account.accountId]:account}};
 const expected={market:'stocks',instrument:order.instrumentId,accountId:account.accountId,orderId:order.id,signalId:record.id,snapshotId:order.dataSnapshotId};
 try{
  const store=new RunnerExecutionEvidenceStore(db);store.save(snapshot,record,order.instrumentId,account.accountId);
  const found=store.executionForOrder(ledger,expected);assert.ok(found,'exact ledger lineage should be returned');assert.equal(found.orderId,order.id);assert.equal(found.decision.reason,record.reason);assert.equal(found.decision.riskChecks[0].passed,true);assert.equal(found.snapshot.fields.quote.bestAsk,101);
  for(const change of [{orderId:'other-order'},{accountId:'other-account'},{signalId:'other-signal'},{snapshotId:'rs_'+'f'.repeat(64)},{instrument:'stock:us:MSFT'},{market:'crypto'}])assert.equal(store.executionForOrder(ledger,{...expected,...change}),null);
  assert.equal(store.executionForOrder({...ledger,runnerAccounts:{...ledger.runnerAccounts,'duplicate':{...account,accountId:'duplicate',orders:[{...order,accountId:'duplicate'}]}}},expected),null,'duplicate order identities must fail closed');
  const late={...order,timestamp:'2026-10-08T09:59:00Z'};assert.equal(store.executionForOrder({...ledger,runnerAccounts:{[account.accountId]:{...account,orders:[late]}}},expected),null,'evidence after the fill must not be returned');
 }finally{db.close();}
});
test('corrupt persisted decision shapes fail closed without throwing',()=>{
 const {SQLiteStateStore}=require('../src/storage/sqlite-state'),{RunnerExecutionEvidenceStore,runnerSnapshotHash}=require('../src/features/runner-execution-evidence');
 const {createHash}=require('node:crypto'),file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'mm-runner-evidence-corrupt-')),'state.sqlite'),db=new SQLiteStateStore(file,path.dirname(file));
 const snapshot={market:'stocks',instrument:'AAPL',dataStatus:'delayed',source:'Yahoo',dataAt:'2026-10-08T10:00:00Z',price:100,evidence:[]};snapshot.snapshotHash=runnerSnapshotHash(snapshot);
 const record={id:'decision-corrupt-1',runnerId:'runner-corrupt-1',market:'stocks',instrument:'AAPL',snapshotHash:snapshot.snapshotHash,orderId:'order-corrupt-1',action:'BUY',at:'2026-10-08T10:00:01Z',riskChecks:[],signals:[],evidence:[]};
 const order={id:record.orderId,instrumentType:'stock',instrumentId:'stock:us:AAPL',accountId:'ai-runner:'+record.runnerId,runnerId:record.runnerId,signalId:record.id,dataSnapshotId:'rs_'+snapshot.snapshotHash,price:100,quantity:1,side:'BUY',timestamp:'2026-10-08T10:00:02Z'};
 const ledger={orders:[],runnerAccounts:{[order.accountId]:{accountId:order.accountId,runnerId:record.runnerId,orders:[order]}}},expected={market:'stocks',instrument:order.instrumentId,accountId:order.accountId,orderId:order.id,signalId:record.id,snapshotId:order.dataSnapshotId};
 const store=new RunnerExecutionEvidenceStore(db),key='ai-runner:execution-signal:'+record.id;
 try{
  store.save(snapshot,record,order.instrumentId,order.accountId);
  const malformed=[
   row=>{row.decision=null;},
   row=>{row.snapshotIds=null;},
   row=>{row.decision.evidence=[null];},
   row=>{row.decision.riskChecks=[null];},
  ];
  for(const mutate of malformed){
   const stored=db.get(key),{hash,...base}=stored;mutate(base);base.hash=createHash('sha256').update(JSON.stringify(base)).digest('hex');db.set(key,base);
   assert.doesNotThrow(()=>store.executionForOrder(ledger,expected));assert.equal(store.executionForOrder(ledger,expected),null);
   db.set(key,stored);
  }
  assert.equal(store.executionForOrder(ledger,{...expected,instrument:null}),null);
 }finally{db.close();}
});
test('prediction paper fills link BUY decisions to their explicit YES or NO outcome',()=>{
 const {SQLiteStateStore}=require('../src/storage/sqlite-state'),{RunnerExecutionEvidenceStore,runnerSnapshotHash}=require('../src/features/runner-execution-evidence');
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'mm-runner-evidence-prediction-')),'state.sqlite'),db=new SQLiteStateStore(file,path.dirname(file)),store=new RunnerExecutionEvidenceStore(db);
 const market='prediction',symbol='event-123',instrument='prediction:predictfun:EVENT-123',accountId='ai-runner:prediction-runner',at='2026-10-08T10:00:01Z';
 const snapshot={market,instrument:symbol,dataStatus:'delayed',source:'Predict.fun',dataAt:'2026-10-08T10:00:00Z',price:.4,evidence:[]};snapshot.snapshotHash=runnerSnapshotHash(snapshot);
 const record={id:'prediction-decision',runnerId:'prediction-runner',market,instrument:symbol,snapshotHash:snapshot.snapshotHash,orderId:'prediction-order',action:'BUY',at,signals:[],riskChecks:[],evidence:[]};
 const canonical='prediction:predictfun:'+symbol.toUpperCase();
 try{
  for(const side of ['YES','NO']){
   const current={...record,id:record.id+'-'+side,orderId:record.orderId+'-'+side,side};store.save(snapshot,current,canonical,accountId);
   const expected={market,instrument:canonical,accountId,orderId:current.orderId,signalId:current.id,snapshotId:'rs_'+snapshot.snapshotHash};
   const order={id:current.orderId,instrumentType:'prediction',instrumentId:canonical,accountId,runnerId:current.runnerId,signalId:current.id,dataSnapshotId:expected.snapshotId,price:.4,quantity:2,side,timestamp:'2026-10-08T10:00:02Z'};
   const ledger={orders:[],runnerAccounts:{[accountId]:{accountId,runnerId:record.runnerId,orders:[order]}}};
   assert.ok(store.executionForOrder(ledger,expected),`BUY intent must link its ${side} contract fill`);
   assert.equal(store.executionForOrder({...ledger,runnerAccounts:{[accountId]:{accountId,runnerId:record.runnerId,orders:[{...order,side:side==='YES'?'NO':'YES'}]}}},expected),null,'outcome side must match the persisted decision');
  }
  const close={...record,id:'prediction-close',orderId:'prediction-close-order',action:'SELL',side:'NO'};store.save(snapshot,close,canonical,accountId);
  const closeExpected={market,instrument:canonical,accountId,orderId:close.orderId,signalId:close.id,snapshotId:'rs_'+snapshot.snapshotHash};
  const closeOrder={id:close.orderId,instrumentType:'prediction',instrumentId:canonical,accountId,runnerId:close.runnerId,signalId:close.id,dataSnapshotId:closeExpected.snapshotId,price:.4,quantity:2,side:'SELL',outcome:'NO',timestamp:'2026-10-08T10:00:02Z'};
  assert.ok(store.executionForOrder({orders:[],runnerAccounts:{[accountId]:{accountId,runnerId:record.runnerId,orders:[closeOrder]}}},closeExpected));
  assert.equal(store.executionForOrder({orders:[],runnerAccounts:{[accountId]:{accountId,runnerId:record.runnerId,orders:[{...closeOrder,outcome:'YES'}]}}},closeExpected),null,'closing outcome must match the persisted decision');
 }finally{db.close();}
});
test('execution-evidence HTTP endpoint is private and verifies the requested order from the unified ledger',()=>{
 const server=fs.readFileSync('src/web/server.ts','utf8'),start=server.indexOf("app.get('/api/paper/execution-evidence'");assert.notEqual(start,-1,'linked execution evidence endpoint missing');
 const end=server.indexOf("app.get('/api/paper/chart-markers'",start),route=server.slice(start,end);
 assert.match(route,/if\(!adminOnly\(req,res\)\)return/);assert.match(route,/runnerExecutionEvidence\.executionForOrder\(unifiedPaperLedgerStore\.get\(\),expected\)/);
 for(const field of ['market','instrument','accountId','orderId','signalId','snapshotId'])assert.match(route,new RegExp(`req\\.query\\.${field}`),`endpoint must require ${field}`);
});
