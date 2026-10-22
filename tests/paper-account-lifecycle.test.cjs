const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { reconcilePaperCorporateActions, pendingOptionSettlements } = require('../src/features/paper-account-lifecycle');

const empty = { startingCash: 1000, cash: 700, positions: [
  { instrumentId: 'stock:us:AAPL', instrumentType: 'stock', title: 'Apple', quantity: 10, averageEntryPrice: 100, currentPrice: 120, openedAt: '2025-01-01T00:00:00Z', realizedPnl: 0 },
  { instrumentId: 'crypto:binance:BTCUSDT', instrumentType: 'crypto', title: 'BTC', quantity: 1, averageEntryPrice: 50, currentPrice: 50, openedAt: '2025-01-01T00:00:00Z', realizedPnl: 0 },
], orders: [{ instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side: 'BUY', quantity: 10, price: 100, timestamp: '2025-01-01T00:00:00Z' }], realizedPnl: 0, peakEquity: 1000, maxDrawdownPct: 0 };

test('late split reconciliation never scales post-split purchases or rewrites immutable executions', () => {
  const ledger=structuredClone(empty);
  ledger.positions[0].quantity=15; ledger.positions[0].averageEntryPrice=80;
  ledger.orders.unshift({instrumentId:'stock:us:AAPL',instrumentType:'stock',side:'BUY',quantity:5,price:40,timestamp:'2026-01-02T00:00:00Z'});
  const action={id:'late-split',market:'stocks',instrument:'AAPL',kind:'split',effectiveAt:'2026-01-01T00:00:00Z',factor:2,source:'official split evidence'};
  const result=reconcilePaperCorporateActions(ledger,[action],Date.parse('2026-02-01T00:00:00Z'));
  assert.deepEqual(result.ledger.positions,ledger.positions);
  assert.deepEqual(result.ledger.orders,ledger.orders);
  assert.equal(result.pending,1);assert.match(result.ledger.lifecycleEvents[0].reason,/生效后.*成交|历史重放/);
});

test('only applied splits affect ex-date dividend holdings; unresolved split blocks guessing entitlement',()=>{
  const ledger=structuredClone(empty);
  ledger.lifecycleEvents=[{id:'corporate:unresolved',actionId:'unresolved',kind:'split',instrument:'AAPL',effectiveAt:'2025-12-01T00:00:00Z',factor:2,status:'pending-review',source:'official',reason:'unresolved'}];
  const result=reconcilePaperCorporateActions(ledger,[{id:'blocked-dividend',market:'stocks',instrument:'AAPL',kind:'dividend',effectiveAt:'2026-01-01T00:00:00Z',factor:1,currency:'USD',source:'official'}],Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(result.ledger.corporateReceivables.length,0);assert.equal(result.pending,1);
});

test('source-backed payment dates settle existing dividend receivables once, without paying before the date',()=>{
  const action={id:'payable',market:'stocks',instrument:'AAPL',kind:'dividend',effectiveAt:'2026-01-01T00:00:00Z',factor:0.25,currency:'USD',source:'issuer dividend record'};
  const first=reconcilePaperCorporateActions(empty,[action],Date.parse('2026-01-02T00:00:00Z'));
  const enriched={...action,paymentAt:'2026-01-20T00:00:00Z'};
  const future=reconcilePaperCorporateActions(first.ledger,[enriched],Date.parse('2026-01-19T00:00:00Z'));
  assert.equal(future.ledger.cash,empty.cash);
  const paid=reconcilePaperCorporateActions(future.ledger,[enriched],Date.parse('2026-01-21T00:00:00Z'));
  assert.equal(paid.ledger.cash,702.5);assert.equal(paid.ledger.corporateReceivables[0].status,'paid');
  assert.equal(paid.ledger.corporateReceivables[0].paymentAt,new Date(enriched.paymentAt).toISOString());
  assert.equal(paid.ledger.lifecycleEvents.filter(e=>e.status==='cash-paid').length,1);
  assert.equal(reconcilePaperCorporateActions(paid.ledger,[enriched],Date.parse('2026-01-22T00:00:00Z')).ledger.cash,702.5);
  assert.equal(empty.cash,700);
});

test('dividend payment does not convert unknown or foreign account currency and rejects changed evidence',()=>{
  const action={id:'foreign-payable',market:'stocks',instrument:'AAPL',kind:'dividend',effectiveAt:'2026-01-01T00:00:00Z',factor:0.25,currency:'CNY',source:'issuer',paymentAt:'2026-01-20T00:00:00Z'};
  const foreign=reconcilePaperCorporateActions(empty,[action],Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(foreign.ledger.cash,700);assert.notEqual(foreign.ledger.corporateReceivables[0].status,'paid');
  const base={...action,id:'changed',currency:'USD',paymentAt:undefined};
  const first=reconcilePaperCorporateActions(empty,[base],Date.parse('2026-01-02T00:00:00Z'));
  const changed=reconcilePaperCorporateActions(first.ledger,[{...base,factor:10,paymentAt:action.paymentAt}],Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(changed.ledger.cash,700);assert.equal(changed.ledger.corporateReceivables[0].amount,2.5);
  assert.ok(changed.pending>0);
});

test('unverified action sources never mutate account positions or create income',()=>{
  for(const kind of ['split','dividend']){
    const result=reconcilePaperCorporateActions(empty,[{id:'missing-source-'+kind,market:'stocks',instrument:'AAPL',kind,effectiveAt:'2026-01-01T00:00:00Z',factor:2,currency:'USD',source:''}],Date.parse('2026-02-01T00:00:00Z'));
    assert.equal(result.applied,0);assert.deepEqual(result.ledger.positions,empty.positions);assert.equal(result.ledger.corporateReceivables.length,0);
  }
});

test('stock return attribution includes paid dividends separately from trading profit and excludes unpaid or foreign income',()=>{
  const {calculateUnifiedPerformance}=require('../src/features/unified-paper-trading');
  const ledger={...structuredClone(empty),corporateReceivables:[{amount:2.5,currency:'USD',status:'paid'},{amount:500,currency:'USD',status:'awaiting-payment'},{amount:300,currency:'CNY',status:'paid'}]};
  const report=calculateUnifiedPerformance(ledger);
  assert.equal(report.corporateIncome,2.5);assert.equal(report.realizedPnl,0);
  assert.equal(report.totalPnl,report.unrealizedPnl+2.5);assert.equal(report.attributionByAsset.stock,report.unrealizedPnl+2.5);
});

test('verified split actions are market-scoped, idempotent, and preserve position value', () => {
  const action = { id: 'split-2-for-1', market: 'stocks', instrument: 'AAPL', kind: 'split', effectiveAt: '2026-01-01T00:00:00Z', factor: 2, source: 'verified test source' };
  const first = reconcilePaperCorporateActions(empty, [action], Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(first.ledger.positions[0].quantity, 20);
  assert.equal(first.ledger.positions[0].averageEntryPrice, 50);
  assert.equal(first.ledger.positions[0].currentPrice, 60);
  assert.equal(first.ledger.positions[1].quantity, 1);
  const second = reconcilePaperCorporateActions(first.ledger, [action], Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(second.ledger.positions[0].quantity, 20);
  assert.equal(second.alreadyApplied, 1);
});

test('market-scoped performance retains paid stock income without leaking it into crypto',()=>{
  const {filterUnifiedPaperLedger}=require('../src/features/market-scope-view');
  const {calculateUnifiedPerformance}=require('../src/features/unified-paper-trading');
  const ledger={...structuredClone(empty),corporateReceivables:[{instrumentId:'stock:us:AAPL',amount:2.5,currency:'USD',status:'paid'}]};
  const stock=filterUnifiedPaperLedger(ledger,'stocks'),crypto=filterUnifiedPaperLedger(ledger,'crypto');
  assert.equal(stock.cash,2.5);assert.equal(calculateUnifiedPerformance(stock).corporateIncome,2.5);
  assert.equal(calculateUnifiedPerformance(crypto).corporateIncome,0);
});

test('pending reviews are not duplicated and independent account payments persist across store instances',()=>{
  const {UnifiedPaperLedgerStore}=require('../src/features/unified-paper-trading');
  const values=new Map(),state={get:key=>structuredClone(values.get(key)||null),set:(key,value)=>values.set(key,structuredClone(value)),transaction:fn=>fn()};
  const store=new UnifiedPaperLedgerStore(state);store.ensureRunnerAccount('isolated','runner',1000);
  store.applyRunnerOrder('isolated','runner',{id:'buy',instrumentId:'stock:us:AAPL',instrumentType:'stock',side:'BUY',price:100,quantity:2,timestamp:'2025-01-01T00:00:00Z'});
  const action={id:'income',market:'stocks',instrument:'AAPL',kind:'dividend',effectiveAt:'2026-01-01T00:00:00Z',paymentAt:'2026-02-01T00:00:00Z',factor:.25,currency:'USD',source:'issuer'};
  store.reconcileCorporateActions('isolated',[action],Date.parse('2026-01-20T00:00:00Z'));
  const reopened=new UnifiedPaperLedgerStore(state);assert.equal(reopened.getAccount('isolated').corporateReceivables[0].status,'awaiting-payment');
  reopened.reconcileCorporateActions('isolated',[action],Date.parse('2026-02-02T00:00:00Z'));
  reopened.reconcileCorporateActions('isolated',[action],Date.parse('2026-02-03T00:00:00Z'));
  assert.equal(reopened.getAccount('isolated').cash,800.5);assert.equal(reopened.get().cash,reopened.get().startingCash);
  const invalid={...action,id:'invalid',currency:''};const pending=reconcilePaperCorporateActions(empty,[invalid]);
  assert.equal(reconcilePaperCorporateActions(pending.ledger,[invalid]).ledger.lifecycleEvents.length,1);
});

test('a real USAR ticker is not misread as a legacy us-prefixed AAPL-style identity', () => {
  const ledger = { ...empty, positions: [{ instrumentId: 'stock:us:USAR', instrumentType: 'stock', title: 'USAR', quantity: 3, averageEntryPrice: 10, currentPrice: 12, openedAt: '2025-01-01T00:00:00Z', realizedPnl: 0 }], orders: [] };
  const result = reconcilePaperCorporateActions(ledger, [{ id: 'usar-split', market: 'stocks', instrument: 'USAR', kind: 'split', effectiveAt: '2026-01-01T00:00:00Z', factor: 2, source: 'verified test source' }], Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(result.applied, 1);
  assert.equal(result.ledger.positions[0].quantity, 6);
});

test('unified ledger store persists corporate-action reconciliation exactly once', () => {
  const { UnifiedPaperLedgerStore } = require('../src/features/unified-paper-trading');
  const values = new Map();
  const state = { get: key => structuredClone(values.get(key) || null), set: (key, value) => values.set(key, structuredClone(value)), transaction: fn => fn() };
  const store = new UnifiedPaperLedgerStore(state);
  store.apply({ instrumentId:'stock:us:AAPL', instrumentType:'stock', side:'BUY', price:100, quantity:2, timestamp:'2025-01-01T00:00:00Z' });
  const action = { id:'split-ledger', market:'stocks', instrument:'AAPL', kind:'split', effectiveAt:'2026-01-01T00:00:00Z', factor:2, source:'verified' };
  store.reconcileCorporateActions('unified-paper-ledger',[action],Date.parse('2026-02-01T00:00:00Z'));
  store.reconcileCorporateActions('unified-paper-ledger',[action],Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(store.get().positions[0].quantity,4);
  assert.equal(store.get().lifecycleEvents.length,1);
});

test('dividends create traceable receivables only when ex-date shares can be reconstructed', () => {
  const action = { id: 'dividend-1', market: 'stocks', instrument: 'AAPL', kind: 'dividend', effectiveAt: '2026-01-01T00:00:00Z', factor: 0.25, currency: 'USD', source: 'verified test source' };
  const result = reconcilePaperCorporateActions(empty, [action], Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(result.ledger.cash, empty.cash, 'ex-date must not be mistaken for the payment date');
  assert.equal(result.ledger.corporateReceivables[0].amount, 2.5);
  assert.equal(result.ledger.corporateReceivables[0].status, 'awaiting-payment-date');
  const repeated = reconcilePaperCorporateActions(result.ledger, [action], Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(repeated.ledger.corporateReceivables.length, 1);
  assert.equal(repeated.alreadyApplied, 1);
});

test('dividend receivables preserve source currency and unknown currency is not guessed', () => {
  const cny = { id: 'dividend-cny', market: 'stocks', instrument: 'AAPL', kind: 'dividend', effectiveAt: '2026-01-01T00:00:00Z', factor: 0.25, currency: 'CNY', source: 'verified test source' };
  const result = reconcilePaperCorporateActions(empty, [cny], Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(result.ledger.corporateReceivables[0].currency, 'CNY');
  const unknown = reconcilePaperCorporateActions(empty, [{ ...cny, id: 'dividend-unknown', currency: undefined }], Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(unknown.ledger.corporateReceivables.length, 0);
  assert.equal(unknown.pending, 1);
  assert.match(unknown.ledger.lifecycleEvents[0].reason, /币种/);
});

test('symbol changes, delistings, missing dividend history, and option expiry stay pending without evidence', () => {
  const actions = [
    { id: 'rename', market: 'stocks', instrument: 'AAPL', kind: 'symbol-change', effectiveAt: '2026-01-01T00:00:00Z', oldSymbol: 'AAPL', newSymbol: 'NEW', source: 'source' },
    { id: 'delist', market: 'stocks', instrument: 'AAPL', kind: 'delisting', effectiveAt: '2026-01-01T00:00:00Z', source: 'source' },
  ];
  const noOrders = { ...empty, orders: [] };
  const result = reconcilePaperCorporateActions(noOrders, actions, Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(result.ledger.positions[0].instrumentId, 'stock:us:AAPL');
  assert.ok(result.pending >= 2);
  const options = pendingOptionSettlements([{ instrumentId: 'option:us:AAPL:2026-01-15:100:C', instrumentType: 'option', quantity: 1 }], Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(options.length, 1);
  assert.equal(options[0].status, 'pending-evidence');
  assert.match(options[0].reason, /官方结算证据/);
});
