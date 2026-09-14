const test = require('node:test');
const assert = require('node:assert');
const { StrategyRegistry, ChanAnalysis } = require('../dist/features/strategy-registry.js');

test('Strategy Registry registers and evaluates strategies', () => {
    const registry = new StrategyRegistry();
    registry.register('test-strat', {
        analyze: (ctx) => [{ price: ctx.prices[0], time: 100, direction: 'buy', pattern: 'bullish_engulfing', explanation: 'Test explanation' }]
    });

    const points = registry.evaluatePoints('test-strat', { marketId: 'BTC', timeframe: '1h', prices: [50000] });
    assert.strictEqual(points.length, 1);
    assert.strictEqual(points[0].direction, 'buy');
    assert.strictEqual(points[0].pattern, 'bullish_engulfing');
});

test('Chan Analysis identifies basic strokes', () => {
    const highs = [10, 20, 15, 25, 20];
    const lows = [5, 15, 10, 20, 15];
    const strokes = ChanAnalysis.analyzeBi(highs, lows);
    
    assert.strictEqual(strokes.length, 3);
    assert.strictEqual(strokes[0].type, 'top');
    assert.strictEqual(strokes[0].price, 20);
    assert.strictEqual(strokes[1].type, 'bottom');
    assert.strictEqual(strokes[1].price, 10);
});
