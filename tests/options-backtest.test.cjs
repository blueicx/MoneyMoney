const test = require('node:test');
const assert = require('node:assert/strict');
const { runAssetBacktest } = require('../dist/features/kelly-backtest.js');

test('Options backtest returns explicitly unavailable due to missing IV/Greeks', () => {
  const result = runAssetBacktest({
    market: 'options',
    instrumentId: 'SPY260918C500',
    dataSource: 'dummy',
    bars: [],
    strategy: 'momentum',
    lookback: 10,
    threshold: 0.05,
    holding: 5,
    startingBalance: 1000
  });

  assert.equal(result.availability, 'unavailable');
  assert.match(result.reason, /隐含波动率/);
  assert.equal(result.market, 'options');
  assert.equal(result.barCount, 0);
  assert.deepEqual(result.equityCurve, []);
  assert.equal(result.metrics.profitFactor, 0);
});
