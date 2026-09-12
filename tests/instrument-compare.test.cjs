const test = require('node:test');
const { strict: assert } = require('node:assert');
const { compareInstruments, createCompareSnapshot } = require('../dist/features/instrument-compare');

test('comparison blocks mixed market types', () => {
  assert.throws(() => compareInstruments('stocks', [
    { id: '1', type: 'stock', symbol: 'AAPL' },
    { id: '2', type: 'crypto', symbol: 'BTC' }
  ]), /只能比较同一/);
});

test('comparison enforces the selected market type', () => {
  assert.throws(() => compareInstruments('crypto', [
    { id: '1', type: 'stock', symbol: 'AAPL' }
  ]), /只能比较同一/);
  assert.doesNotThrow(() => compareInstruments('crypto', [
    { id: '2', type: 'crypto', symbol: 'BTC' }
  ]));
});

test('comparison creates replayable snapshots', () => {
  const snapshot = createCompareSnapshot('stocks', [
    { id: '1', type: 'stock', symbol: 'AAPL', quote: { price: 150, changePct: 1 } }
  ]);
  assert.ok(snapshot.id.startsWith('cmp_'));
  assert.equal(snapshot.scope, 'stocks');
  assert.equal(snapshot.instruments[0].quote.price, 150);
  assert.equal(snapshot.instruments[0].freshness.status, 'unavailable');
});
