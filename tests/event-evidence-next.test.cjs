const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEventEvidence,
  matchesEventScope,
  filterTimelineItems,
} = require('../dist/features/event-evidence.js');

test('event evidence preserves source values and classifies direction conservatively', () => {
  const evidence = buildEventEvidence({
    scope: 'stocks', instrumentId: 'stock:us:AAPL', title: 'US GDP release',
    actual: '105', forecast: '100', previous: '98', source: 'SEC', url: 'https://example.invalid/aapl',
  });
  assert.equal(evidence.scope, 'stocks');
  assert.equal(evidence.instrumentId, 'stock:us:AAPL');
  assert.equal(evidence.direction, 'bullish');
  assert.equal(evidence.actual, '105');
  assert.equal(evidence.forecast, '100');
  assert.equal(evidence.previous, '98');
  assert.equal(evidence.url, 'https://example.invalid/aapl');
});

test('instrument timeline excludes market-wide rows from a specific stock', () => {
  assert.equal(matchesEventScope({ scope: 'stocks', instrumentId: 'stock:us:AAPL' }, 'stocks', 'stock:us:AAPL'), true);
  assert.equal(matchesEventScope({ scope: 'crypto', instrumentId: 'crypto:binance:BTCUSDT' }, 'stocks', 'stock:us:AAPL'), false);
  const items = filterTimelineItems([
    { scope: 'stocks', instrumentId: null, title: 'market event' },
    { scope: 'stocks', instrumentId: 'stock:us:AAPL', title: 'stock' },
    { scope: 'crypto', instrumentId: 'crypto:binance:BTCUSDT', title: 'crypto' },
    { scope: 'stocks', instrumentId: 'stock:us:MSFT', title: 'other stock' },
  ], 'stocks', 'stock:us:AAPL');
  assert.deepEqual(items.map(item => item.title), ['stock']);
  assert.deepEqual(filterTimelineItems([
    { scope: 'stocks', instrumentId: null, title: 'market event' },
    { scope: 'stocks', instrumentId: 'stock:us:AAPL', title: 'stock' },
  ], 'stocks'), ['market event', 'stock'].map(title => ({ scope: 'stocks', instrumentId: title === 'stock' ? 'stock:us:AAPL' : null, title })));
});

test('missing comparison values become unavailable instead of guessed', () => {
  const evidence = buildEventEvidence({ scope: 'options', title: 'rate decision', actual: null, forecast: null, previous: null });
  assert.equal(evidence.direction, 'unavailable');
  assert.equal(evidence.source, null);
});
