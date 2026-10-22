const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mm-lifecycle-routes-'));process.env.MONEYMONEY_DATA_DIR=root;
require('ts-node/register/transpile-only');
const express=require('express'),{SQLiteStateStore}=require('../src/storage/sqlite-state'),{UnifiedPaperLedgerStore}=require('../src/features/unified-paper-trading'),{createPaperLifecycleRouter}=require('../src/web/paper-lifecycle-routes');
test('lifecycle API scopes private reads and commits dividend cash together with its audit',async()=>{
 const state=new SQLiteStateStore(path.join(root,'isolated.sqlite'),root),ledger=new UnifiedPaperLedgerStore(state);
 ledger.ensureRunnerAccount('account','runner',1000);ledger.applyRunnerOrder('account','runner',{id:'buy',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',quantity:2,price:100,timestamp:'2024-01-01T00:00:00Z'});
 const actions=[{id:'dividend',market:'stocks',instrument:'AAPL',kind:'dividend',factor:.25,currency:'USD',source:'isolated issuer fixture',effectiveAt:'2024-02-01T00:00:00Z',paymentAt:'2024-02-15T00:00:00Z'}];
 let rejectAudit=true;const app=express();app.use(express.json(),(req,res,next)=>{req.user={role:req.headers['x-role']||'guest'};next();});
 app.use('/api/paper/accounts',createPaperLifecycleRouter({ledger,actions:()=>actions,state:{transaction:fn=>state.transaction(fn),appendAudit:row=>{if(rejectAudit)throw Error('isolated audit failure');state.appendAudit(row);}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/api/paper/accounts/account`;
 const get=(suffix,role='admin')=>fetch(base+suffix,{headers:{'x-role':role}}),post=()=>fetch(base+'/reconcile',{method:'POST',headers:{'x-role':'admin','content-type':'application/json'},body:JSON.stringify({market:'stocks'})});
 try{
  assert.equal((await get('/lifecycle?market=stocks','guest')).status,403);assert.equal((await get('/lifecycle?market=crypto')).status,400);
  assert.equal((await post()).status,400);assert.equal(ledger.getAccount('account').cash,800);assert.equal(state.listAudits().length,0);
  rejectAudit=false;assert.equal((await post()).status,200);assert.equal(ledger.getAccount('account').cash,800.5);assert.equal(state.listAudits().length,1);
  await post();assert.equal(ledger.getAccount('account').cash,800.5);
  const legacy=await (await fetch(base+'/reconcile',{method:'POST',headers:{'x-role':'admin','content-type':'application/json'},body:'{}'})).json();
  assert.equal(legacy.market,'all');assert.equal(legacy.data.ledger.cash,800.5);
  const response=await get('/lifecycle?market=stocks');assert.equal(response.headers.get('cache-control'),'private, no-store');
  const stock=await response.json();assert.equal(stock.market,'stocks');assert.equal(stock.data.performance.corporateIncome,.5);assert.deepEqual(stock.data.pendingOptionSettlements,[]);
  const option=await (await get('/lifecycle?market=options')).json();assert.deepEqual(option.data.receivables,[]);assert.deepEqual(option.data.events,[]);assert.deepEqual(option.data.costAdjustments,[]);assert.equal(option.data.performance.corporateIncome,0);
  assert.equal(ledger.get().cash,ledger.get().startingCash);assert.equal(ledger.getAccount('account').orders.length,1);
 }finally{await new Promise(resolve=>server.close(resolve));state.close();}
});

test('identified late-split costs persist with their audit and do not cross independent accounts',async()=>{
 const state=new SQLiteStateStore(path.join(root,'split.sqlite'),root),ledger=new UnifiedPaperLedgerStore(state);
 ledger.ensureRunnerAccount('late','runner-late',10000);
 for(const order of [{id:'pre',side:'BUY',quantity:10,price:100,timestamp:'2025-01-01T00:00:00Z'},{id:'post',side:'BUY',quantity:5,price:40,timestamp:'2025-02-02T00:00:00Z'},{id:'sale',side:'SELL',quantity:5,price:60,timestamp:'2025-02-03T00:00:00Z'}])ledger.applyRunnerOrder('late','runner-late',{...order,instrumentType:'stock',instrumentId:'stock:us:AAPL'});
 const original=ledger.getAccount('late'),action={id:'late-split',market:'stocks',instrument:'AAPL',kind:'split',factor:2,source:'isolated issuer',effectiveAt:'2025-02-01T00:00:00Z'};
 let rejectAudit=true;const app=express();app.use(express.json(),(req,res,next)=>{req.user={role:'admin'};next();});
 app.use('/api/paper/accounts',createPaperLifecycleRouter({ledger,actions:()=>[action],state:{transaction:fn=>state.transaction(fn),appendAudit:row=>{if(rejectAudit)throw Error('isolated failure');state.appendAudit(row);}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/api/paper/accounts/late`;
 const post=()=>fetch(base+'/reconcile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({market:'stocks'})});
 try{
  assert.equal((await post()).status,400);assert.deepEqual(ledger.getAccount('late'),original);
  rejectAudit=false;const first=await (await post()).json();assert.equal(first.data.costAdjustments[0].adjustedPnlUsd,60);
  const reopened=new UnifiedPaperLedgerStore(state);assert.equal(reopened.getAccount('late').positions[0].quantity,20);assert.deepEqual(reopened.getAccount('late').orders,original.orders);
  await post();assert.equal(reopened.getAccount('late').realizedPnl,60);assert.equal(reopened.getAccount('late').cash,original.cash);
  assert.equal(reopened.get().cash,reopened.get().startingCash);
  state.set('ai-paper-runners',[{id:'runner-late',accountId:'late',status:'RUNNING',budgetUsd:10000}],1);
  const protectedBefore=reopened.getAccount('late');
  const blocked=await post();assert.equal(blocked.status,409);
  assert.match((await blocked.json()).reason,/跑单.*同步|跑单.*执行状态/);
  assert.deepEqual(reopened.getAccount('late'),protectedBefore);
  assert.equal(state.get('ai-paper-runners')[0].status,'RUNNING');
 }finally{await new Promise(resolve=>server.close(resolve));state.close();}
});
