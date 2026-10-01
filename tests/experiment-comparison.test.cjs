const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareExperiments } = require('../dist/features/experiment-comparison');
const result = (id, overrides = {}) => ({ experiment: { id, market: 'stocks', instrument: 'stock:us:AAPL', dataFrom: '2026-01-01', dataTo: '2026-02-01', feeRate: .001, slippage: .002, ...overrides }, backtest: { equityCurve: [100, 95, 110], trades: [], metrics: { totalReturnPct: 10 } }, evidence: { outOfSample: { totalReturnPct: 2 } }, folds: [] });
test('comparison preserves real curves and flags interval/cost differences without ranking', () => {
  const data = compareExperiments([result('a'), result('b', { feeRate: .003, dataTo: '2026-03-01' })]);
  assert.deepEqual(data.experiments[0].equityCurve, [100, 95, 110]);
  assert.equal(data.experiments[0].drawdownCurve[1], -5);
  assert.ok(data.differences.some(row => row.field === 'feeRate'));
  assert.ok(data.differences.some(row => row.field === 'dataTo'));
  assert.equal(data.ranking, null);
});
test('comparison rejects duplicate IDs, mixed markets and invalid selection size', () => {
  assert.throws(() => compareExperiments([result('a')]), /2–6/);
  assert.throws(() => compareExperiments([result('a'), result('a')]), /重复/);
  assert.throws(() => compareExperiments([result('a'), result('b', { market: 'crypto', instrument: 'crypto:binance:BTCUSDT' })]), /同一市场/);
});

test('comparison reports actual cost totals without inventing missing values', () => {
  const a = result('a'); a.backtest.totalFees=4; a.backtest.totalSlippage=8;
  const data = compareExperiments([a,result('b')]);
  assert.equal(data.experiments[0].totalFees,4);
  assert.equal(data.experiments[0].totalSlippage,8);
  assert.equal(data.experiments[1].totalFees,null);
});
