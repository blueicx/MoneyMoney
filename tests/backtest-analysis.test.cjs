const test = require('node:test');
const { strict: assert } = require('node:assert');
const { calculateBacktestMetrics, createWalkForwardFolds, compareParameterGrid } = require('../dist/features/backtest-analysis.js');

test('backtest analysis calculates return, win rate, profit factor and drawdown', () => {
  const metrics = calculateBacktestMetrics({ startingBalance: 1000, equityCurve: [1000, 1100, 1050, 1200, 1150], trades: [{ pnl: 100 }, { pnl: -50 }, { pnl: 150 }, { pnl: -50 }] });
  assert.equal(metrics.totalReturnPct, 15);
  assert.equal(metrics.tradesCount, 4);
  assert.equal(metrics.winRatePct, 50);
  assert.equal(metrics.profitFactor, 2.5);
  assert.equal(metrics.maxDrawdownPct, -4.5455);
  assert.equal(metrics.maxDrawdownBars, 1);
});

test('walk-forward folds keep purge and embargo gaps without overlap', () => {
  const folds = createWalkForwardFolds({ length: 100, trainSize: 40, testSize: 20, step: 20, purge: 3, embargo: 2 });
  assert.deepEqual(folds[0], { trainStart: 0, trainEnd: 39, testStart: 45, testEnd: 64 });
  assert.ok(folds.every(fold => fold.trainEnd < fold.testStart));
  assert.ok(folds.every((fold, index) => index === 0 || fold.testStart > folds[index - 1].testEnd));
  assert.deepEqual(createWalkForwardFolds({ length: 10, trainSize: 8, testSize: 8, step: 1 }), []);
});

test('parameter comparison is deterministic and preserves market scope', () => {
  const result = compareParameterGrid({ market: 'stocks', parameters: { lookback: [5, 10], threshold: [0.02, 0.04] }, evaluate: params => params.lookback === 10 ? 2 : 1 });
  assert.deepEqual(result.map(item => item.parameters), [{ lookback: 10, threshold: 0.02 }, { lookback: 10, threshold: 0.04 }, { lookback: 5, threshold: 0.02 }, { lookback: 5, threshold: 0.04 }]);
  assert.equal(result[0].score, 2);
  assert.equal(result[0].market, 'stocks');
});
