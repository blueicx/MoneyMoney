const test = require('node:test');
const { strict: assert } = require('node:assert');
const { BacktestEngine } = require('../dist/features/backtest-engine.js');

test('backtest applies fees and slippage and reports trades', () => {
  const engine = new BacktestEngine({ marketId: 'stocks', rules: { maxOpenPositions: 1 }, feeRate: 0.001, slippage: 0.01, preventFutureData: true });
  const result = engine.run([100, 110], [{ timeIndex: 0, direction: 'buy', strategyId: 's1' }, { timeIndex: 1, direction: 'sell', strategyId: 's1' }]);
  assert.equal(result.remainingPositions, 0);
  assert.ok(result.pnl > 7 && result.pnl < 9);
  assert.equal(result.trades.length, 2);
  assert.ok(result.totalFees > 0);
  assert.ok(result.totalSlippage > 0);
  assert.equal(result.lookAheadBiasDetected, false);
});

test('backtest rejects insufficient samples and flags out-of-range future signals', () => {
  const engine = new BacktestEngine({ marketId: 'stocks', rules: {}, feeRate: 0, slippage: 0, rejectOnInsufficientSamples: true, preventFutureData: true });
  assert.throws(() => engine.run([1, 2], []), /Insufficient samples/);
  const guarded = new BacktestEngine({ marketId: 'stocks', rules: {}, feeRate: 0, slippage: 0, preventFutureData: true });
  const result = guarded.run([100], [{ timeIndex: 2, direction: 'buy' }]);
  assert.equal(result.lookAheadBiasDetected, true);
  assert.equal(result.remainingPositions, 0);
  assert.equal(result.trades.length, 0);
});

test('backtest experiment context, segmentation and cache are reproducible', () => {
  const context = { marketId: 'crypto', instrumentId: 'BTC/USDT', timeframe: '15m', strategyId: 'mean-v1', strategyVersion: '1.2.0', dataSource: 'fixture', dataFrom: '2026-01-01', dataTo: '2026-01-02', seed: 7 };
  const engine = new BacktestEngine({ marketId: 'crypto', rules: {}, feeRate: 0, slippage: 0, useCache: true, experimentContext: context, segmentSize: 1 });
  const signals = [{ timeIndex: 0, direction: 'buy' }, { timeIndex: 1, direction: 'sell' }];
  const first = engine.run([100, 110], signals, 'stable-key');
  const second = engine.run([100, 110], signals, 'stable-key');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(first.experimentContext, context);
  assert.equal(first.segmentStatistics.length, 2);
  assert.deepEqual(second.trades, first.trades);
});

test('backtest exposes an equity curve and research metrics with a fixed starting balance', () => {
  const engine = new BacktestEngine({ marketId: 'stocks', rules: {}, feeRate: 0, slippage: 0, startingBalance: 1000 });
  const result = engine.run([100, 110, 105, 120], [
    { timeIndex: 0, direction: 'buy', source: 'maCross' },
    { timeIndex: 1, direction: 'sell', source: 'maCross' },
  ]);
  assert.equal(result.startingBalance, 1000);
  assert.equal(result.equityCurve.length, 3);
  assert.equal(result.metrics.totalReturnPct, 1);
  assert.equal(result.metrics.winRatePct, 50);
  assert.equal(result.trades[0].source, 'maCross');
});

test('advanced backtest engine supports limit orders, partial fills, stop loss, and takes into account cash balance', () => {
  const engine = new BacktestEngine({ marketId: 'stocks', rules: { maxOpenPositions: 1, minTradeVolume: 10, cooldownBars: 2 }, feeRate: 0.001, slippage: 0.01, startingBalance: 10000, preventFutureData: true });
  const result = engine.run([100, 95, 110, 105, 120, 115], [
    { timeIndex: 1, direction: 'buy', orderType: 'limit', limitPrice: 96, volume: 50 }, // Should fill at 95 (index 1)
    { timeIndex: 2, direction: 'sell', orderType: 'stop', stopPrice: 100, volume: 20 }, // Should NOT fill at 110 (index 2)
    { timeIndex: 4, direction: 'sell', orderType: 'take_profit', limitPrice: 118, volume: 30 } // Should fill at 120 (index 4)
  ]);
  assert.equal(result.trades.length, 2);
  assert.equal(result.trades[0].executionPrice < 96, true);
  assert.equal(result.trades[0].volume, 50);
  assert.equal(result.trades[1].executionPrice, 120 - 120 * 0.01);
  assert.equal(result.trades[1].volume, 30);
});

test('advanced backtest engine reports position ledger, underwater curve, holding time and exit reasons', () => {
  const engine = new BacktestEngine({ marketId: 'stocks', rules: { maxOpenPositions: 100 }, feeRate: 0, slippage: 0, startingBalance: 10000 });
  const result = engine.run([100, 110, 105, 120, 115, 130], [
    { timeIndex: 0, direction: 'buy', volume: 10 },
    { timeIndex: 1, direction: 'buy', volume: 1 }, // Forces equity to capture peak at 110
    { timeIndex: 2, direction: 'sell', volume: 11, exitReason: 'trailing_stop' } // Forces equity to capture drawdown at 105
  ]);
  assert.ok(result.ledger);
  assert.ok(result.underwaterCurve);
  assert.equal(Math.round(result.ledger.realizedPnl), 45); // 10*(105-100) + 1*(105-110) = 45
  assert.equal(result.ledger.maxDrawdown > 0, true);
  assert.equal(result.trades[2].exitReason, 'trailing_stop');
  assert.equal(result.trades[2].holdingTime, 2); // from index 0 to 2
});
