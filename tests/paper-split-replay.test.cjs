const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { emptyUnifiedPaperLedger, applyUnifiedPaperOrder, calculateUnifiedPerformance } = require('../src/features/unified-paper-trading');
const { reconcilePaperCorporateActions } = require('../src/features/paper-account-lifecycle');
const { filterUnifiedPaperLedger } = require('../src/features/market-scope-view');
const now = Date.parse('2026-03-01T00:00:00Z');
const action = { id: 'split', market: 'stocks', instrument: 'AAPL', kind: 'split', effectiveAt: '2026-01-01T00:00:00Z', factor: 2, source: 'isolated official split evidence' };
function fixture(withSell = false) {
  let ledger = emptyUnifiedPaperLedger(10000);
  const add = (id, side, quantity, price, timestamp) => {
    ledger = applyUnifiedPaperOrder(ledger, { id, instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side, quantity, price, timestamp });
  };
  add('pre', 'BUY', 10, 100, '2025-12-01T00:00:00Z');
  add('post', 'BUY', 5, 40, '2026-01-02T00:00:00Z');
  if (withSell) add('sell', 'SELL', 5, 60, '2026-01-03T00:00:00Z');
  ledger.positions[0].currentPrice = 60;
  ledger.positions[0].markUpdatedAt = '2026-02-01T00:00:00Z';
  ledger.positions[0].markStatus = 'delayed';
  return ledger;
}
test('complete identified executions replay a late split without changing cash or immutable orders', () => {
  const ledger = fixture(), result = reconcilePaperCorporateActions(ledger, [action], now);
  assert.equal(result.applied, 1);
  assert.equal(result.ledger.positions[0].quantity, 25);
  assert.equal(result.ledger.positions[0].averageEntryPrice, 48);
  assert.equal(result.ledger.positions[0].currentPrice, 60);
  assert.equal(result.ledger.cash, ledger.cash);
  assert.deepEqual(result.ledger.orders, ledger.orders);
  assert.equal(ledger.positions[0].quantity, 15);
  assert.deepEqual(reconcilePaperCorporateActions(result.ledger, [action], now).ledger, result.ledger);
});
test('late split sale cost corrections are separately traceable and used in scoped attribution', () => {
  const ledger = fixture(true), result = reconcilePaperCorporateActions(ledger, [action], now);
  assert.equal(result.applied, 1);
  assert.equal(result.ledger.positions[0].quantity, 20);
  assert.equal(result.ledger.positions[0].averageEntryPrice, 48);
  assert.equal(result.ledger.realizedPnl, 60);
  assert.equal(result.ledger.positions[0].realizedPnl, 60);
  assert.equal(result.ledger.cash, ledger.cash);
  assert.deepEqual(result.ledger.orders, ledger.orders);
  const correction = result.ledger.corporateCostAdjustments[0];
  assert.equal(correction.orderId, 'sell');
  assert.equal(correction.originalPnlUsd, -100);
  assert.equal(correction.adjustedPnlUsd, 60);
  assert.deepEqual(correction.actionIds, ['split']);
  const performance = calculateUnifiedPerformance(result.ledger);
  assert.equal(performance.attributionByAsset.stock, 300);
  assert.equal(performance.strategyAttribution.unattributed, 60);
  assert.equal(performance.winRate, 1);
  assert.equal(performance.equity - result.ledger.startingCash, performance.totalPnl);
  assert.equal(filterUnifiedPaperLedger(result.ledger, 'stocks').realizedPnl, 60);
  assert.equal(filterUnifiedPaperLedger(result.ledger, 'crypto').corporateCostAdjustments.length, 0);
});
test('incomplete, conflicting, duplicate or boundary-ambiguous histories stay pending', () => {
  for (const mutate of [
    ledger => { delete ledger.orders[0].id; },
    ledger => { ledger.positions[0].averageEntryPrice = 99; },
    ledger => { ledger.orders[0].timestamp = action.effectiveAt; },
    ledger => { ledger.orders[0].id = ledger.orders[1].id; },
    ledger => { ledger.orders[0].quantity = -1; },
  ]) {
    const ledger = fixture(); mutate(ledger);
    const result = reconcilePaperCorporateActions(ledger, [action], now);
    assert.equal(result.applied, 0);
    assert.equal(result.pending, 1);
    assert.deepEqual(result.ledger.positions, ledger.positions);
    assert.equal(result.ledger.cash, ledger.cash);
  }
});

test('legacy or modified histories are not certified merely because quantities happen to match', () => {
  for (const mutate of [
    ledger => { delete ledger.orderHistoryProof; },
    ledger => { ledger.orders[0].reason = 'modified after execution'; },
  ]) {
    const ledger = fixture(); mutate(ledger);
    const result = reconcilePaperCorporateActions(ledger, [action], now);
    assert.equal(result.applied, 0);
    assert.equal(result.pending, 1);
    assert.deepEqual(result.ledger.positions, ledger.positions);
  }
});

test('extreme split ratios never overflow value or round a live holding away without settlement evidence', () => {
  for (const factor of [1e300, 1e-300]) {
    for (const ledger of [fixture(), applyUnifiedPaperOrder(emptyUnifiedPaperLedger(10000), { id:'only', instrumentId:'stock:us:AAPL', instrumentType:'stock',side:'BUY',quantity:10,price:100,timestamp:'2025-12-01T00:00:00Z' })]) {
      const result = reconcilePaperCorporateActions(ledger, [{...action, factor}], now);
      assert.equal(result.applied, 0);
      assert.deepEqual(result.ledger.positions, ledger.positions);
    }
  }
});
test('pending late split may resolve after history repair, but revised evidence cannot silently replace it', () => {
  const ledger = fixture(); delete ledger.orders[0].id;
  const pending = reconcilePaperCorporateActions(ledger, [action], now);
  pending.ledger.orders[0].id = 'post';
  const conflict = reconcilePaperCorporateActions(pending.ledger, [{ ...action, factor: 3 }], now);
  assert.equal(conflict.applied, 0); assert.equal(conflict.ledger.positions[0].quantity, 15);
  const resolved = reconcilePaperCorporateActions(pending.ledger, [action], now);
  assert.equal(resolved.applied, 1); assert.equal(resolved.ledger.positions[0].quantity, 25);
  assert.equal(resolved.ledger.lifecycleEvents.length, 1);
  assert.equal(resolved.ledger.lifecycleEvents[0].status, 'applied');
  assert.ok(resolved.ledger.lifecycleEvents[0].previousReason);
});
test('a late split never pretends an undated mark is a post-split market quote', () => {
  const ledger = fixture(); delete ledger.positions[0].markUpdatedAt;
  const result = reconcilePaperCorporateActions(ledger, [action], now);
  assert.equal(result.applied, 1);
  assert.equal(result.ledger.positions[0].currentPrice, 40);
  assert.equal(result.ledger.positions[0].markStatus, 'stale');
  assert.equal(result.ledger.positions[0].markUpdatedAt, '2026-01-02T00:00:00Z');
  assert.match(result.ledger.positions[0].markSource, /成交|execution/);
});

test('future marks cannot be retained as verified present valuations', () => {
  const ledger = fixture(); ledger.positions[0].markUpdatedAt = '2027-01-01T00:00:00Z';
  const result = reconcilePaperCorporateActions(ledger, [action], now);
  assert.equal(result.ledger.positions[0].markStatus, 'stale');
  assert.equal(result.ledger.positions[0].currentPrice, 40);
});

test('successive late splits and future sales match timely reconciliation under seeded execution histories', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const first = { ...action, factor: seed % 2 ? 2 : 1.5 };
    const second = { ...action, id: 'split-2', factor: 2, effectiveAt: '2026-02-01T00:00:00Z' };
    const buy = { id: 'pre', instrumentType: 'stock', instrumentId: 'stock:us:AAPL', side: 'BUY', quantity: 10 + seed, price: 100, timestamp: '2025-12-01T00:00:00Z' };
    const post = { ...buy, id: 'post', quantity: 5, price: 40, timestamp: '2026-01-02T00:00:00Z' };
    const sale = { ...buy, id: 'sell', side: 'SELL', quantity: 2, price: 60, timestamp: '2026-01-03T00:00:00Z' };
    const last = { ...post, id: 'last', price: 20, timestamp: '2026-02-02T00:00:00Z' };
    let timely = applyUnifiedPaperOrder(emptyUnifiedPaperLedger(100000), buy);
    timely = reconcilePaperCorporateActions(timely, [first], Date.parse('2026-01-01T12:00:00Z')).ledger;
    timely = applyUnifiedPaperOrder(applyUnifiedPaperOrder(timely, post), sale);
    timely = reconcilePaperCorporateActions(timely, [second], Date.parse('2026-02-01T12:00:00Z')).ledger;
    timely = applyUnifiedPaperOrder(timely, last);
    const raw = [buy, post, sale, last].reduce(applyUnifiedPaperOrder, emptyUnifiedPaperLedger(100000));
    const result = reconcilePaperCorporateActions(raw, [second, first], now);
    assert.equal(result.applied, 2);
    const late = result.ledger;
    assert.equal(late.positions[0].quantity, timely.positions[0].quantity);
    assert.ok(Math.abs(late.positions[0].averageEntryPrice - timely.positions[0].averageEntryPrice) < 1e-7);
    assert.ok(Math.abs(late.realizedPnl - timely.realizedPnl) < 1e-7, 'eight-decimal cost arithmetic must agree');
    assert.equal(late.cash, timely.cash);
    assert.deepEqual(late.orders, raw.orders);
    const next = { ...sale, id: 'future-sell', quantity: 1, price: 30, timestamp: '2026-03-02T00:00:00Z' };
    assert.ok(Math.abs(applyUnifiedPaperOrder(late, next).realizedPnl - applyUnifiedPaperOrder(timely, next).realizedPnl) < 1e-7);
  }
});
