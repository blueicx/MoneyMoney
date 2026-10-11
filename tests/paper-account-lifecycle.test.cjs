const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { reconcilePaperCorporateActions, pendingOptionSettlements } = require('../src/features/paper-account-lifecycle');

const empty = { startingCash: 1000, cash: 700, positions: [
  { instrumentId: 'stock:us:AAPL', instrumentType: 'stock', title: 'Apple', quantity: 10, averageEntryPrice: 100, currentPrice: 120, openedAt: '2025-01-01T00:00:00Z', realizedPnl: 0 },
  { instrumentId: 'crypto:binance:BTCUSDT', instrumentType: 'crypto', title: 'BTC', quantity: 1, averageEntryPrice: 50, currentPrice: 50, openedAt: '2025-01-01T00:00:00Z', realizedPnl: 0 },
], orders: [{ instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side: 'BUY', quantity: 10, price: 100, timestamp: '2025-01-01T00:00:00Z' }], realizedPnl: 0, peakEquity: 1000, maxDrawdownPct: 0 };

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
