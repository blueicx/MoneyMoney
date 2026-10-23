const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'mm-runner-income-'));process.env.MONEYMONEY_DATA_DIR=data;
require('ts-node/register/transpile-only');
const {SQLiteStateStore}=require('../src/storage/sqlite-state'),{UnifiedPaperLedgerStore}=require('../src/features/unified-paper-trading');
const action={id:'issuer-dividend',market:'stocks',instrument:'AAPL',kind:'dividend',factor:.25,currency:'USD',effectiveAt:'2025-02-01T00:00:00Z',paymentAt:'2025-02-15T00:00:00Z',source:'Isolated issuer evidence'};
const at=Date.parse('2025-03-01T00:00:00Z');
function fixture(name){
 const state=new SQLiteStateStore(path.join(data,name+'.sqlite'),data),store=new UnifiedPaperLedgerStore(state);
 store.ensureRunnerAccount('ai-runner:fixture','fixture',1000);
 const order={id:'entry',instrumentId:'stock:us:AAPL',instrumentType:'stock',side:'BUY',price:100,quantity:2,timestamp:'2025-01-01T00:00:00Z'};
 store.applyRunnerOrder('ai-runner:fixture','fixture',order);
 const runner={id:'fixture',accountId:'ai-runner:fixture',venue:'Stocks',symbolOrMarketId:'AAPL',universe:{market:'stocks',hash:'frozen'},mode:'rules',model:'fixed/model',policy:{maxBudgetUsd:1000},budgetUsd:1000,cashUsd:800,status:'RUNNING',executionState:'ready',createdAt:'2025-01-01T00:00:00Z',peakEquityUsd:1000,
  positions:[{id:'lot',instrumentId:order.instrumentId,entryOrderId:'entry',entryTime:order.timestamp,entryPrice:100,quantity:2,currentPrice:100,status:'OPEN'}],trades:[{id:'trade',orderId:'entry',action:'BUY',price:100,quantity:2,timestamp:order.timestamp}],aiCalls:[]};
 state.set('ai-paper-runners',[runner],1);return {state,store,runner};
}
test('manual verified dividend payment atomically synchronizes runner cash without changing its configuration or lots',()=>{
 const {state,store,runner}=fixture('valid');try{
  const result=store.reconcileCorporateActions(runner.accountId,[action],at);
  assert.equal(result.blockedReason,undefined);assert.equal(result.ledger.cash,800.5);
  const saved=state.get('ai-paper-runners')[0];assert.equal(saved.cashUsd,800.5);assert.equal(saved.corporateIncomeUsd,.5);
  const {cashUsd,corporateIncomeUsd,...unchanged}=saved,{cashUsd:oldCash,...before}=runner;assert.deepEqual(unchanged,before);
  assert.equal(new UnifiedPaperLedgerStore(state).getAccount(runner.accountId).cash,800.5);
  store.reconcileCorporateActions(runner.accountId,[action],at+1000);assert.equal(state.get('ai-paper-runners')[0].cashUsd,800.5);
  assert.equal(store.get().cash,1000);assert.deepEqual(result.ledger.orders,store.getAccount(runner.accountId).orders);
 }finally{state.close();}
});
test('missing payment evidence records only a receivable and does not invent runner cash',()=>{
 const {state,store,runner}=fixture('receivable');try{
  const result=store.reconcileCorporateActions(runner.accountId,[{...action,paymentAt:undefined}],at);
  assert.equal(result.blockedReason,undefined);assert.equal(result.ledger.cash,800);assert.equal(result.ledger.corporateReceivables[0].status,'awaiting-payment-date');
  assert.equal(state.get('ai-paper-runners')[0].cashUsd,800);
 }finally{state.close();}
});
test('mismatched balances, lineage, market or history fail closed without normalizing existing runners',()=>{
 for(const [name,mutate]of Object.entries({cash:r=>r.cashUsd--,lot:r=>r.positions[0].quantity++,market:r=>r.venue='Binance',legacy:r=>r.executionState='legacy-readonly',link:r=>r.positions[0].entryOrderId='missing',income:r=>r.corporateIncomeUsd=99})){
  const {state,store,runner}=fixture(name);try{mutate(runner);state.set('ai-paper-runners',[runner]);const before=store.getAccount(runner.accountId);
   const result=store.reconcileCorporateActions(runner.accountId,[action],at);assert.ok(result.blockedReason,name);assert.deepEqual(store.getAccount(runner.accountId),before);assert.deepEqual(state.get('ai-paper-runners')[0],runner);
  }finally{state.close();}
 }
});
test('outer audit failure rolls back both the dividend ledger and runner state',()=>{
 const {state,store,runner}=fixture('rollback');try{const before=store.getAccount(runner.accountId);
  assert.throws(()=>state.transaction(()=>{const result=store.reconcileCorporateActions(runner.accountId,[action],at);assert.equal(result.blockedReason,undefined);throw Error('audit failed');}),/audit failed/);
  assert.deepEqual(store.getAccount(runner.accountId),before);assert.deepEqual(state.get('ai-paper-runners')[0],runner);
 }finally{state.close();}
});
test('dividend income belongs to net return but never to closed-trade win rate',()=>{
 const {summarizeRunner}=require('../src/features/ai-paper-runner');
 const {state,runner}=fixture('summary');try{
  runner.cashUsd=800.5;runner.corporateIncomeUsd=.5;runner.trades=[];runner.universe.instruments=[{venue:'Stocks',symbolOrMarketId:'AAPL'}];const summary=summarizeRunner(runner);
  assert.equal(summary.totalPnlUsd,.5);assert.equal(summary.corporateIncomeUsd,.5);assert.equal(summary.realizedPnlUsd,0);assert.equal(summary.closedCount,0);assert.equal(summary.winRateReliable,false);
 }finally{state.close();}
});

test('duplicate bindings, missing trade lineage and split effects stay blocked',()=>{
 for(const variant of ['binding','trade','split','proof']){
  const {state,store,runner}=fixture('blocked-'+variant);try{
   if(variant==='binding')state.set('ai-paper-runners',[runner,{...runner,id:'other'}]);
   if(variant==='trade'){runner.trades[0].orderId='unknown';state.set('ai-paper-runners',[runner]);}
   if(variant==='proof'){const root=store.get();delete root.runnerAccounts[runner.accountId].orderHistoryProof;state.set('paper-ledger',root);}
   const before=store.getAccount(runner.accountId),raw=state.get('ai-paper-runners');
   const result=store.reconcileCorporateActions(runner.accountId,[variant==='split'?{...action,kind:'split',factor:2}:action],at);
   assert.ok(result.blockedReason,variant);assert.deepEqual(store.getAccount(runner.accountId),before);assert.deepEqual(state.get('ai-paper-runners'),raw);
  }finally{state.close();}
 }
});

test('cash synchronization leaves other registered runners byte-for-byte unchanged',()=>{
 const {state,store,runner}=fixture('isolation');try{
  const other={...runner,id:'other',accountId:'ai-runner:other',venue:'Binance',cashUsd:999,unrelated:{model:'keep'}};
  state.set('ai-paper-runners',[runner,other]);store.reconcileCorporateActions(runner.accountId,[action],at);
  assert.deepEqual(state.get('ai-paper-runners')[1],other);
  assert.equal(state.get('ai-paper-runners')[0].corporateIncomeUsd,.5);
 }finally{state.close();}
});

test('runner summary displays corporate income separately using the existing themed workspace',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/web/public/modules/dashboard-runtime.js'),'utf8');
 assert.match(source,/s\.corporateIncomeUsd/);assert.match(source,/股息收入/);assert.match(source,/不计入平仓胜率/);
});

test('a receivable can become paid later without duplicate income, including after all lots close',()=>{
 const {state,store,runner}=fixture('late-payment');try{
  store.reconcileCorporateActions(runner.accountId,[{...action,paymentAt:undefined}],at);
  const sale={id:'exit',instrumentId:'stock:us:AAPL',instrumentType:'stock',side:'SELL',price:110,quantity:2,timestamp:'2025-02-10T00:00:00Z'};
  store.applyRunnerOrder(runner.accountId,runner.id,sale);
  const raw=state.get('ai-paper-runners')[0];raw.cashUsd=1020;Object.assign(raw.positions[0],{status:'CLOSED',exitOrderId:sale.id,exitPrice:110,exitTime:sale.timestamp,pnlUsd:20});
  raw.trades.push({orderId:sale.id,action:'SELL',price:110,quantity:2,timestamp:sale.timestamp});state.set('ai-paper-runners',[raw]);
  const result=store.reconcileCorporateActions(runner.accountId,[action],at);assert.equal(result.blockedReason,undefined);assert.equal(result.ledger.cash,1020.5);
  assert.equal(state.get('ai-paper-runners')[0].corporateIncomeUsd,.5);store.reconcileCorporateActions(runner.accountId,[action],at);assert.equal(state.get('ai-paper-runners')[0].cashUsd,1020.5);
 }finally{state.close();}
});
