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

test('comparison caps same-market panels at four instruments', () => {
  const instruments = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META'].map((symbol, index) => ({ id: String(index), type: 'stock', symbol }));
  assert.throws(() => compareInstruments('stocks', instruments), /最多同时比较 4 个标的/);
  assert.equal(compareInstruments('stocks', instruments.slice(0, 4)).length, 4);
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
