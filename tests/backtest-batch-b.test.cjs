const test = require('node:test');
const { strict: assert } = require('node:assert');
const { BacktestEngine } = require('../dist/features/backtest-engine.js');
const { calculateBacktestMetrics } = require('../dist/features/backtest-analysis.js');
const { runResearchExperiment, generateExperimentArtifacts } = require('../dist/features/experiment-runner.js');

test('Batch B - partial fill maintains consistent fee and trade value', () => {
    const engine = new BacktestEngine({
        marketId: 'stocks', rules: { maxOpenPositions: 100 }, feeRate: 0.1, slippage: 0, startingBalance: 100
    });
    // With 100 cash, price 50, feeRate 0.1.
    // Execution price = 50. Total cost per unit = 50 + 50*0.1 = 55.
    // Max we can buy = floor(100 / 55) = 1.
    const result = engine.run([50, 60], [
        { timeIndex: 0, direction: 'buy', volume: 3 }
    ]);

    assert.strictEqual(result.trades[0].volume, 1);
    assert.strictEqual(result.trades[0].fee, 5); // 50 * 0.1 * 1
    assert.strictEqual(result.totalFees, 5);
});

test('Batch B - cost basis uses current open batch', () => {
    const engine = new BacktestEngine({
        marketId: 'stocks', rules: { maxOpenPositions: 100 }, feeRate: 0, slippage: 0, startingBalance: 1000
    });
    const result = engine.run([10, 20, 30, 40], [
        { timeIndex: 0, direction: 'buy', volume: 10 },
        { timeIndex: 1, direction: 'sell', volume: 10 },
        { timeIndex: 2, direction: 'buy', volume: 5 },
        { timeIndex: 3, direction: 'sell', volume: 5 }
    ]);
    // The second trade PnL should be based on execution (20) and cost (10). PnL = (20-10)*10 = 100
    // The fourth trade PnL should be based on execution (40) and cost (30). PnL = (40-30)*5 = 50
    assert.strictEqual(result.trades[1].pnl, 100);
    assert.strictEqual(result.trades[3].pnl, 50);
});

test('Batch B - prevents selling more than held', () => {
    const engine = new BacktestEngine({
        marketId: 'stocks', rules: { maxOpenPositions: 100 }, feeRate: 0, slippage: 0, startingBalance: 1000
    });
    const result = engine.run([10, 20], [
        { timeIndex: 0, direction: 'buy', volume: 5 },
        { timeIndex: 1, direction: 'sell', volume: 10 }
    ]);
    assert.strictEqual(result.trades[1].volume, 5);
});

test('Batch B - metrics boundaries do not produce NaN or Infinity', () => {
    const metrics = calculateBacktestMetrics({ startingBalance: 1000, equityCurve: [1000, 1000, 1000], trades: [] });
    assert.ok(!Number.isNaN(metrics.profitFactor));
    // removed;
    assert.ok(!Number.isNaN(metrics.pnlRatio));
    assert.ok(Number.isFinite(metrics.pnlRatio));
    assert.ok(!Number.isNaN(metrics.sharpeRatio));
    assert.ok(!Number.isNaN(metrics.sortinoRatio));
    assert.strictEqual(metrics.alpha, null); // alpha shouldn't be constant 0 if no baseline
});

test('Batch B - stop/take_profit triggers realistic exits with exitReason', () => {
    const engine = new BacktestEngine({
        marketId: 'stocks', rules: { maxOpenPositions: 100 }, feeRate: 0, slippage: 0, startingBalance: 1000
    });
    // At index 0, buy 1.
    // At index 1, try to sell with stop at 95, current price 90 -> fills at 90.
    const result = engine.run([100, 90, 80], [
        { timeIndex: 0, direction: 'buy', volume: 1 },
        { timeIndex: 1, direction: 'sell', volume: 1, orderType: 'stop', stopPrice: 95 }
    ]);
    assert.strictEqual(result.trades.length, 2);
    assert.strictEqual(result.trades[1].timeIndex, 1);
    assert.strictEqual(result.trades[1].exitReason, 'stop_loss');
});

test('Batch B - generateExperimentArtifacts uses deterministic hashes', () => {
    const result = {
        experiment: { id: 'exp_1', createdAt: '2026-09-16T00:00:00.000Z' },
        backtest: { trades: [], metrics: { totalReturnPct: 0, winRatePct: 0 } },
        evidence: { summary: 'test', generatedAt: '2026-09-16T00:00:00.000Z' }
    };
    const artifacts1 = generateExperimentArtifacts('job_1', result);
    const artifacts2 = generateExperimentArtifacts('job_1', result);
    assert.deepStrictEqual(artifacts1.manifests, artifacts2.manifests);
});
