const test = require('node:test');
const assert = require('node:assert');
const { BacktestEngine } = require('../dist/features/backtest-engine.js');

test('Backtest Engine applies fees, slippage, and future data protection', () => {
    const engine = new BacktestEngine({
        marketId: 'BTC',
        rules: {},
        feeRate: 0.001,
        slippage: 0.002,
        rejectOnInsufficientSamples: true,
        preventFutureData: true
    });

    const prices = Array(150).fill(0).map((_, i) => 100 + i);
    const signals = [
        { timeIndex: 50, direction: 'buy' },
        { timeIndex: 100, direction: 'sell' },
        { timeIndex: 200, direction: 'buy' }
    ];

    const result = engine.run(prices, signals);
    assert.strictEqual(result.remainingPositions, 0);
    assert.ok(result.pnl > 48.9 && result.pnl < 49.0);
});

test('Backtest Engine rejects on insufficient samples', () => {
     const engine = new BacktestEngine({
        marketId: 'BTC',
        rules: {},
        feeRate: 0.001,
        slippage: 0.002,
        rejectOnInsufficientSamples: true
    });

    assert.throws(() => engine.run([1, 2, 3], []), /Insufficient samples/);
});