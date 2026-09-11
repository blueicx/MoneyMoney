const test = require('node:test');
const assert = require('node:assert/strict');
const { runAssetBacktest } = require('../dist/features/kelly-backtest.js');

function bars(closes, step = 86400000) {
  return closes.map((close, index) => ({
    time: Date.UTC(2026, 0, 1) + index * step,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
  }));
}

test('stock backtest uses asset semantics and preserves the stock identity', () => {
  const result = runAssetBacktest({
    market: 'stocks',
    instrumentId: 'AAPL',
    dataSource: 'nasdaq-public-history',
    bars: bars([100, 101, 103, 106, 109, 112, 115, 118]),
    strategy: 'momentum',
    lookback: 1,
    threshold: 0.01,
    holding: 2,
    startingBalance: 1000,
  });

  assert.equal(result.market, 'stocks');
  assert.equal(result.instrumentId, 'AAPL');
  assert.equal(result.dataSource, 'nasdaq-public-history');
  assert.ok(result.totalTrades > 0);
  assert.equal(result.trades[0].instrumentId, 'AAPL');
  assert.equal(result.trades[0].side, 'long');
  assert.equal('marketId' in result.trades[0], false);
  assert.equal('action' in result.trades[0], false);
});

test('crypto backtest uses crypto bars and crypto identity', () => {
  const result = runAssetBacktest({
    market: 'crypto',
    instrumentId: 'BTCUSDT',
    dataSource: 'binance-public-klines',
    bars: bars([100, 98, 96, 94, 92, 90, 88, 86], 3600000),
    strategy: 'meanReversion',
    lookback: 1,
    threshold: 0.01,
    holding: 2,
    startingBalance: 1000,
  });

  assert.equal(result.market, 'crypto');
  assert.equal(result.instrumentId, 'BTCUSDT');
  assert.equal(result.dataSource, 'binance-public-klines');
  assert.ok(result.totalTrades > 0);
  assert.equal(result.trades[0].instrumentId, 'BTCUSDT');
  assert.equal(result.trades[0].side, 'long');
});

test('asset backtest rejects insufficient history instead of fabricating results', () => {
  assert.throws(() => runAssetBacktest({
    market: 'stocks',
    instrumentId: 'AAPL',
    dataSource: 'nasdaq-public-history',
    bars: bars([100, 101]),
    strategy: 'momentum',
    lookback: 10,
    threshold: 0.03,
    holding: 5,
    startingBalance: 1000,
  }), /历史数据不足/);
});
