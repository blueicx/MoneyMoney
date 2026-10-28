const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { previewPositionSizing } = require('../src/features/position-sizing');

const evidence = {
  market: 'stocks', instrument: 'stock:us:AAPL', kind: 'backtest', source: 'fixture',
  publishedAt: '2026-01-01T00:00:00Z', observedAt: '2026-01-01T00:00:01Z', fetchedAt: '2026-01-01T00:00:02Z',
  contentHash: 'a'.repeat(64), coverage: 'complete', unknownReason: null,
};

test('fractional Kelly preview is capped and never executes', () => {
  const result = previewPositionSizing({ stats: { kind: 'backtest', evidence, samples: 120, winRate: 0.6, payoffRatio: 1.5 }, bankroll: 100000, currency: 'usd', maxFraction: 0.25 });
  assert.equal(result.dataStatus, 'ready');
  assert.equal(result.model, 'fractional-kelly');
  assert.equal(result.noExecution, true);
  assert.equal(result.currency, 'USD');
  assert.equal(result.fractions.full, 0.25);
  assert.equal(result.fractions.half, 0.125);
  assert.ok(Math.abs(result.amounts.full - 25000) < 1e-9);
  assert.equal(result.methodologyRef, 'kelly-sizing@1');
});

test('brier path becomes an explicit capped edge heuristic', () => {
  const result = previewPositionSizing({ stats: { kind: 'brier', evidence: { ...evidence, kind: 'brier' }, samples: 80, brierScore: 0.18, baselineBrier: 0.25 }, bankroll: 1000, currency: 'USDT' });
  assert.equal(result.model, 'capped-edge-heuristic');
  assert.ok(Math.abs(result.fractions.full - 0.14) < 1e-9);
});

test('insufficient or missing statistics stay unavailable with reasons', () => {
  const low = previewPositionSizing({ stats: { kind: 'backtest', evidence, samples: 5, winRate: 0.6, payoffRatio: 1.5 }, bankroll: 1000, currency: 'USD' });
  assert.equal(low.dataStatus, 'unavailable');
  assert.match(low.missing[0], /样本数/);
  const negative = previewPositionSizing({ stats: { kind: 'backtest', evidence, samples: 100, winRate: 0.3, payoffRatio: 1.1 }, bankroll: 1000, currency: 'USD' });
  assert.equal(negative.dataStatus, 'unavailable');
  const noEdge = previewPositionSizing({ stats: { kind: 'brier', evidence, samples: 100, brierScore: 0.3, baselineBrier: 0.25 }, bankroll: 1000, currency: 'USD' });
  assert.equal(noEdge.dataStatus, 'unavailable');
});

test('position sizing refuses unverifiable evidence and bad currency', () => {
  assert.throws(() => previewPositionSizing({ stats: { kind: 'backtest', evidence: { ...evidence, contentHash: null }, samples: 100, winRate: 0.6, payoffRatio: 1.5 }, bankroll: 1, currency: 'USD' }), /证据引用/);
  assert.throws(() => previewPositionSizing({ stats: { kind: 'backtest', evidence, samples: 100, winRate: 0.6, payoffRatio: 1.5 }, bankroll: 1, currency: 'US$' }), /币种/);
});
