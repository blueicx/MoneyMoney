const test = require('node:test');
const { strict: assert } = require('node:assert');
const { StrategyRegistry, ChanAnalysis } = require('../dist/features/strategy-registry.js');

test('strategy definitions are versioned and scoped to market/timeframe', () => {
  const registry = new StrategyRegistry();
  registry.register('momentum-v2', {
    version: '2.0.0', lifecycle: 'active', marketScope: ['stocks'], timeframes: ['1h'], requiredHistory: 3,
    allowBacktest: true, allowPaper: true, allowAlerts: false,
    analyze: context => [{ index: context.prices.length - 1, price: context.prices.at(-1), time: context.times?.at(-1) ?? context.prices.length - 1, direction: 'buy', explanation: 'test signal' }],
  });

  assert.equal(registry.get('momentum-v2').version, '2.0.0');
  assert.deepEqual(registry.evaluatePoints('momentum-v2', { marketId: 'stocks', timeframe: '1h', prices: [10, 11, 12], times: [100, 200, 300] }), [{ index: 2, price: 12, time: 300, direction: 'buy', explanation: 'test signal' }]);
  assert.deepEqual(registry.evaluatePoints('momentum-v2', { marketId: 'crypto', timeframe: '1h', prices: [10, 11, 12] }), []);
  assert.throws(() => registry.evaluatePoints('momentum-v2', { marketId: 'stocks', timeframe: '5m', prices: [10, 11, 12] }), /timeframe/);
  assert.deepEqual(registry.evaluatePoints('momentum-v2', { marketId: 'stocks', timeframe: '1h', prices: [10, 11] }), []);
});

test('Chan analysis returns explainable fractals, strokes, segments, hubs, trends and points', () => {
  const highs = [10, 20, 15, 25, 20, 30, 25, 35, 30, 40, 35];
  const lows = [5, 15, 10, 20, 15, 25, 20, 30, 25, 35, 30];
  const times = highs.map((_, index) => 1_000 + index * 60);
  const fractals = ChanAnalysis.analyzeFractal(highs, lows, times);
  assert.ok(fractals.length >= 4);
  assert.equal(fractals[0].type, 'top_fractal');
  assert.equal(fractals[0].time, times[1]);
  assert.equal(fractals[0].confirmed, true);
  assert.match(fractals[0].explanation, /通常|顶分型|top/i);

  const strokes = ChanAnalysis.analyzeBi(highs, lows, times);
  const segments = ChanAnalysis.analyzeSegment(strokes);
  const hubs = ChanAnalysis.analyzeHub(segments);
  const trends = ChanAnalysis.analyzeTrend(hubs);
  const points = ChanAnalysis.analyzeBuySellPoints(trends, hubs, strokes);
  assert.ok(strokes.length >= 4);
  assert.ok(segments.every(segment => segment.start.index < segment.end.index));
  assert.ok(hubs.every(hub => hub.low < hub.high && hub.startIndex <= hub.endIndex));
  assert.ok(trends.every(trend => ['up', 'down', 'range'].includes(trend.direction)));
  assert.ok(points.every(point => /^((buy|sell)[123])$/.test(point.type)));
  assert.ok([...fractals, ...strokes, ...points].every(point => point.explanation.length > 0));
});

test('Chan analysis exposes structured results and confirmation state', () => {
  const result = ChanAnalysis.analyze({ highs: [10, 20, 15, 25], lows: [5, 15, 10, 20], times: [1, 2, 3, 4] });
  assert.ok(Array.isArray(result.fractals));
  assert.ok(Array.isArray(result.points));
  assert.ok(result.fractals.every(item => typeof item.confirmed === 'boolean'));
});
