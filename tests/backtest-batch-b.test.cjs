const test = require('node:test');
const assert = require('node:assert');
const { BacktestEngine } = require('../dist/features/backtest-engine');
const { calculateBacktestMetrics } = require('../dist/features/backtest-analysis');
const { runResearchExperiment, generateExperimentArtifacts } = require('../dist/features/experiment-runner');

test('BacktestEngine - handles partial fills on insufficient cash', () => {
    const engine = new BacktestEngine({
        marketId: 'test', rules: { minTradeVolume: 1 }, feeRate: 0.1, slippage: 0, startingBalance: 100
    });
    const result = engine.run([50, 50], [{ timeIndex: 0, direction: 'buy', volume: 3 }]);
    assert.strictEqual(result.trades.length, 1);
    assert.strictEqual(result.trades[0].volume, 1);
    assert.equal(result.equityCurve[1], 95);
    assert.equal(result.ledger.unrealizedPnl, -5);
});

test('BacktestEngine - calculates weighted average cost and does not mix historical lots', () => {
    const engine = new BacktestEngine({
        marketId: 'test', rules: { }, feeRate: 0, slippage: 0, startingBalance: 1000
    });
    const result = engine.run([10, 20, 30, 40], [
        { timeIndex: 0, direction: 'buy', volume: 10, price: 10 },
        { timeIndex: 1, direction: 'sell', volume: 10, price: 20 },
        { timeIndex: 2, direction: 'buy', volume: 10, price: 30 },
        { timeIndex: 3, direction: 'sell', volume: 10, price: 40 }
    ]);
    assert.strictEqual(result.trades[3].pnl, 100);
});

test('BacktestEngine - stop and take_profit respect current kline', () => {
    const engine = new BacktestEngine({
        marketId: 'test', rules: { }, feeRate: 0, slippage: 0, startingBalance: 1000
    });
    const result = engine.run([100, 90, 80], [
        { timeIndex: 0, direction: 'buy', volume: 1, price: 100 },
        { timeIndex: 1, direction: 'sell', volume: 1, orderType: 'stop', stopPrice: 95, price: 90 },
        { timeIndex: 2, direction: 'sell', volume: 1, orderType: 'stop', stopPrice: 95, price: 80 }
    ]);
    assert.strictEqual(result.trades.length, 2);
    assert.strictEqual(result.trades[1].timeIndex, 1);
    assert.strictEqual(result.trades[1].price, 90);
});

test('BacktestEngine - indicators boundary (negative equity does not NaN cagr)', () => {
    const metrics = calculateBacktestMetrics({
        startingBalance: 100,
        equityCurve: [100, 50, -10],
        trades: []
    });
    assert.ok(Number.isFinite(metrics.cagrPct) || metrics.cagrPct === 0);
    assert.ok(!Number.isNaN(metrics.cagrPct));
});

test('BacktestEngine - alpha is null when no benchmark', () => {
    const metrics = calculateBacktestMetrics({
        startingBalance: 100,
        equityCurve: [100, 110],
        trades: []
    });
    assert.strictEqual(metrics.alpha, null);
    assert.ok(metrics.alphaReason);
});

test('generateExperimentArtifacts - stable hash', () => {
    const result = {
        experiment: { id: 'exp_1' },
        backtest: { trades: [], metrics: { totalReturnPct: 0, winRatePct: 0 } },
        evidence: { summary: 'test', generatedAt: '2026-09-16T00:00:00.000Z' }
    };
    const artifacts1 = generateExperimentArtifacts('job_1', result);
    const artifacts2 = generateExperimentArtifacts('job_1', result);
    assert.deepStrictEqual(artifacts1.manifests, artifacts2.manifests);
});
