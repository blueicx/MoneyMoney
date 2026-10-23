const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'mm-runner-split-'));process.env.MONEYMONEY_DATA_DIR=data;require('ts-node/register/transpile-only');
const {SQLiteStateStore}=require('../src/storage/sqlite-state'),{UnifiedPaperLedgerStore}=require('../src/features/unified-paper-trading');
const now=Date.parse('2025-03-01'),split={id:'split',market:'stocks',instrument:'AAPL',kind:'split',factor:2,effectiveAt:'2025-02-01T00:00:00Z',source:'Isolated issuer evidence, not production'};
function fixture(name){const state=new SQLiteStateStore(path.join(data,name+'.sqlite'),data),store=new UnifiedPaperLedgerStore(state);
 store.ensureRunnerAccount('account','runner',1000);const order={id:'entry',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:100,quantity:2,timestamp:'2025-01-01T00:00:00Z'};
 store.applyRunnerOrder('account','runner',order);
 const runner={id:'runner',accountId:'account',venue:'Stocks',symbolOrMarketId:'AAPL',universe:{market:'stocks',instruments:[{venue:'Stocks',symbolOrMarketId:'AAPL'}]},policy:{},executionState:'ready',status:'STOPPED',budgetUsd:1000,cashUsd:800,model:'fixed-model',peakEquityUsd:1000,
 positions:[{id:'lot',instrumentId:order.instrumentId,entryOrderId:order.id,entryTime:order.timestamp,entryPrice:100,currentPrice:100,quantity:2,status:'OPEN'}],trades:[{id:'trade',orderId:order.id,action:'BUY',price:100,quantity:2,timestamp:order.timestamp}],
 benchmarks:{AAPL:{market:'stocks',instrument:'AAPL',startPrice:100,currentPrice:100,allocationUsd:1000,observedAt:order.timestamp,updatedAt:order.timestamp}},equityHistory:[{at:order.timestamp,equityUsd:1000,drawdownPct:0}]};
 state.set('ai-paper-runners',[runner]);return{state,store,runner};}
test('manual split synchronizes identified open lots, benchmark units and stale marks atomically',()=>{const {state,store,runner}=fixture('open');try{
 const result=store.reconcileCorporateActions('account',[split],now);assert.equal(result.blockedReason,undefined);
 const raw=state.get('ai-paper-runners')[0];assert.equal(raw.positions[0].quantity,4);assert.equal(raw.positions[0].entryPrice,50);assert.equal(raw.positions[0].currentPrice,50);assert.equal(raw.positions[0].markStatus,'stale');assert.deepEqual(raw.positions[0].corporateActionIds,['split']);
 assert.equal(raw.cashUsd,800);assert.equal(result.ledger.cash,800);assert.equal(raw.model,runner.model);assert.equal(raw.status,'STOPPED');assert.deepEqual(raw.trades,runner.trades);assert.deepEqual(raw.equityHistory,runner.equityHistory);
 assert.equal(raw.lastDataStatus,'stale');assert.equal(result.ledger.valuationStatus,'stale');
 assert.equal(raw.benchmarks.AAPL.startPrice,50);assert.equal(raw.benchmarks.AAPL.currentPrice,50);
 const snapshot=state.get('ai-paper-runners');store.reconcileCorporateActions('account',[split],now);assert.deepEqual(state.get('ai-paper-runners'),snapshot);
 const dividend={...split,id:'dividend',kind:'dividend',factor:.25,currency:'USD',effectiveAt:'2025-02-10T00:00:00Z',paymentAt:'2025-02-15T00:00:00Z'};
 assert.equal(store.reconcileCorporateActions('account',[dividend],now).ledger.cash,801);assert.equal(state.get('ai-paper-runners')[0].cashUsd,801);
}finally{state.close();}});
test('late split adjusts pre-action lots only, keeps later entries in their original units',()=>{const {state,store,runner}=fixture('late');try{
 const order={id:'post',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:60,quantity:1,timestamp:'2025-02-02T00:00:00Z'};store.applyRunnerOrder('account','runner',order);
 runner.cashUsd=740;runner.positions.push({id:'later',instrumentId:order.instrumentId,entryOrderId:order.id,entryTime:order.timestamp,entryPrice:60,quantity:1,currentPrice:60,status:'OPEN'});runner.trades.push({orderId:order.id,action:'BUY',price:60,quantity:1,timestamp:order.timestamp});state.set('ai-paper-runners',[runner]);
 const result=store.reconcileCorporateActions('account',[split],now);assert.equal(result.blockedReason,undefined);assert.equal(result.ledger.positions[0].quantity,5);
 const rows=state.get('ai-paper-runners')[0].positions;assert.equal(rows[0].quantity,4);assert.equal(rows[1].quantity,1);assert.equal(rows[1].entryPrice,60);
}finally{state.close();}});
test('sequential and reverse splits remain idempotent and preserve original execution proof',()=>{const {state,store}=fixture('sequence');try{
 assert.equal(store.reconcileCorporateActions('account',[split],now).blockedReason,undefined);
 const second={...split,id:'reverse',factor:.5,effectiveAt:'2025-02-10T00:00:00Z'};
 const result=store.reconcileCorporateActions('account',[split,second],now);assert.equal(result.blockedReason,undefined);assert.equal(result.ledger.positions[0].quantity,2);
 const raw=state.get('ai-paper-runners')[0];assert.equal(raw.positions[0].entryPrice,100);assert.deepEqual(raw.positions[0].corporateActionIds,['split','reverse']);assert.equal(raw.benchmarks.AAPL.startPrice,100);
}finally{state.close();}});
test('audit failure rolls back split changes in both documents',()=>{const {state,store}=fixture('rollback');try{const before=store.getAccount('account'),runners=state.get('ai-paper-runners');
 assert.throws(()=>state.transaction(()=>{assert.equal(store.reconcileCorporateActions('account',[split],now).blockedReason,undefined);throw Error('audit failure');}),/audit failure/);
 assert.deepEqual(store.getAccount('account'),before);assert.deepEqual(state.get('ai-paper-runners'),runners);
}finally{state.close();}});
test('a verified post-split quote is not divided a second time by simple lifecycle reconciliation',()=>{const {state,store}=fixture('quote');try{
 const root=store.get(),position=root.runnerAccounts.account.positions[0];Object.assign(position,{currentPrice:55,markUpdatedAt:'2025-02-02T00:00:00Z',markStatus:'delayed',markSource:'Isolated quote evidence'});state.set('paper-ledger',root);
 const result=store.reconcileCorporateActions('account',[split],now);assert.equal(result.blockedReason,undefined);assert.equal(result.ledger.positions[0].currentPrice,55);assert.equal(state.get('ai-paper-runners')[0].positions[0].currentPrice,55);
}finally{state.close();}});

test('opposite splits in one confirmation keep both evidence IDs even if the net factor is one',()=>{const {state,store}=fixture('net-one');try{
 const reverse={...split,id:'reverse',factor:.5,effectiveAt:'2025-02-10T00:00:00Z'};
 assert.equal(store.reconcileCorporateActions('account',[split,reverse],now).blockedReason,undefined);
 const raw=state.get('ai-paper-runners')[0];assert.deepEqual(raw.positions[0].corporateActionIds,['split','reverse']);assert.equal(raw.positions[0].quantity,2);
}finally{state.close();}});
test('benchmarks adjusted from old units are not reported as fresh post-split returns',()=>{const {state,store}=fixture('benchmark');try{
 store.reconcileCorporateActions('account',[split],now);const runner=state.get('ai-paper-runners')[0];
 assert.equal(runner.benchmarks.AAPL.corporateAdjustmentPendingQuote,true);
 const summary=require('../src/features/ai-paper-runner').summarizeRunner(runner);assert.equal(summary.benchmarkReturnPct,null);assert.match(summary.benchmarkReason,/拆股.*报价/);
}finally{state.close();}});
test('affected closed lots are never reopened or paired by time to repair a late split',()=>{const {state,store,runner}=fixture('closed');try{
 const sale={id:'exit',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'SELL',quantity:2,price:60,timestamp:'2025-02-02T00:00:00Z'};store.applyRunnerOrder('account','runner',sale);
 runner.cashUsd=920;Object.assign(runner.positions[0],{status:'CLOSED',exitOrderId:'exit',exitTime:sale.timestamp,exitPrice:60,pnlUsd:-80});runner.trades.push({orderId:'exit',action:'SELL',quantity:2,price:60,timestamp:sale.timestamp});state.set('ai-paper-runners',[runner]);
 const before=store.getAccount('account');assert.ok(store.reconcileCorporateActions('account',[split],now).blockedReason);assert.deepEqual(store.getAccount('account'),before);assert.deepEqual(state.get('ai-paper-runners')[0],runner);
}finally{state.close();}});

test('a properly synchronized split lot can subsequently close and receive its entitled dividend',()=>{const {state,store}=fixture('subsequent-close');try{
 assert.equal(store.reconcileCorporateActions('account',[split],now).blockedReason,undefined);
 const sale={id:'exit',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'SELL',quantity:4,price:55,timestamp:'2025-02-20T00:00:00Z'};store.applyRunnerOrder('account','runner',sale);
 const raw=state.get('ai-paper-runners')[0];raw.cashUsd=1020;Object.assign(raw.positions[0],{status:'CLOSED',exitOrderId:'exit',exitTime:sale.timestamp,exitPrice:55,pnlUsd:20});raw.trades.push({orderId:'exit',action:'SELL',price:55,quantity:4,timestamp:sale.timestamp});state.set('ai-paper-runners',[raw]);
 const dividend={...split,id:'dividend',kind:'dividend',factor:.25,currency:'USD',effectiveAt:'2025-02-10T00:00:00Z',paymentAt:'2025-02-25T00:00:00Z'};
 const result=store.reconcileCorporateActions('account',[dividend],now);assert.equal(result.blockedReason,undefined);assert.equal(result.ledger.cash,1021);assert.equal(state.get('ai-paper-runners')[0].corporateIncomeUsd,1);
}finally{state.close();}});
test('invalid historical marks cannot become zero-valued runner holdings after a split',()=>{const {state,store}=fixture('invalid-mark');try{
 const root=store.get();root.runnerAccounts.account.positions[0].currentPrice=0;state.set('paper-ledger',root);
 const before=store.getAccount('account'),raw=state.get('ai-paper-runners');assert.ok(store.reconcileCorporateActions('account',[split],now).blockedReason);assert.deepEqual(store.getAccount('account'),before);assert.deepEqual(state.get('ai-paper-runners'),raw);
}finally{state.close();}});
test('the next verified quote clears benchmark waiting without changing order history or restarting the runner',()=>{const {state,store}=fixture('valuation-resume');try{
 store.reconcileCorporateActions('account',[split],now);
 const globalState=require('../src/storage/sqlite-state').stateStore;globalState.set('paper-ledger',store.get());globalState.set('ai-paper-runners',state.get('ai-paper-runners'));
 const {updateAiRunnerMarketState,summarizeRunner}=require('../src/features/ai-paper-runner');
 const updated=updateAiRunnerMarketState('runner',{market:'stocks',status:'delayed',instrument:'AAPL',source:'Isolated fresh quote',dataAt:new Date(now).toISOString(),prices:{AAPL:55}},new Date(now));
 assert.equal(updated.executionState,'ready');assert.equal(updated.status,'STOPPED');assert.equal(updated.model,'fixed-model');assert.equal(updated.benchmarks.AAPL.corporateAdjustmentPendingQuote,false);
 assert.equal(summarizeRunner(updated).benchmarkReturnPct,10);assert.equal(globalState.get('paper-ledger').runnerAccounts.account.orders.length,1);
}finally{state.close();}});
test('a timestamped cached post-split price keeps its units and cache status, never halves again',()=>{const {state,store}=fixture('cached-post');try{
 const root=store.get();Object.assign(root.runnerAccounts.account.positions[0],{currentPrice:55,markUpdatedAt:'2025-02-02T00:00:00Z',markStatus:'cached',markSource:'Isolated cached quote'});state.set('paper-ledger',root);
 const result=store.reconcileCorporateActions('account',[split],now);assert.equal(result.blockedReason,undefined);assert.equal(result.ledger.positions[0].currentPrice,55);assert.equal(result.ledger.valuationStatus,'cached');assert.equal(state.get('ai-paper-runners')[0].lastDataStatus,'cached');
}finally{state.close();}});
test('stock lots with option multipliers or short-side semantics fail closed',()=>{
 for(const [variant,patch]of [['multiplier',{contractMultiplier:100}],['short',{side:'SHORT'}]]){const {state,store,runner}=fixture('invalid-'+variant);try{
  Object.assign(runner.positions[0],patch);state.set('ai-paper-runners',[runner]);const before=store.getAccount('account');
  assert.ok(store.reconcileCorporateActions('account',[split],now).blockedReason,variant);assert.deepEqual(store.getAccount('account'),before);assert.deepEqual(state.get('ai-paper-runners')[0],runner);
 }finally{state.close();}}
});
test('explicit instrument references cannot contradict the ledger identity or frozen market scope',()=>{
 for(const [variant,mutate]of Object.entries({refMarket:r=>r.positions[0].instrument={venue:'Binance',symbolOrMarketId:'BTCUSDT'},refSymbol:r=>r.positions[0].instrument={venue:'Stocks',symbolOrMarketId:'MU'},universeMarket:r=>r.universe.instruments=[{venue:'Binance',symbolOrMarketId:'BTCUSDT'}],universeSymbol:r=>r.universe.instruments=[{venue:'Stocks',symbolOrMarketId:'MU'}]})){
  const {state,store,runner}=fixture('scope-'+variant);try{mutate(runner);state.set('ai-paper-runners',[runner]);const before=store.getAccount('account');assert.ok(store.reconcileCorporateActions('account',[split],now).blockedReason,variant);assert.deepEqual(store.getAccount('account'),before);assert.deepEqual(state.get('ai-paper-runners')[0],runner);}finally{state.close();}
 }
});
