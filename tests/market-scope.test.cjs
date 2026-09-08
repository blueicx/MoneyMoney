const assert = require('node:assert/strict');
const test = require('node:test');
const {
  marketScopeForInstrumentType,
  marketScopeForTab,
  filterInstrumentResults,
  defaultTabForMarketScope,
} = require('../dist/features/market-scope');

test('maps instrument types to market scopes', () => {
  assert.equal(marketScopeForInstrumentType('stock'), 'stocks');
  assert.equal(marketScopeForInstrumentType('crypto'), 'crypto');
  assert.equal(marketScopeForInstrumentType('prediction'), 'prediction');
});

test('maps legacy tabs to their market scope and default tabs', () => {
  assert.equal(marketScopeForTab('binance'), 'crypto');
  assert.equal(marketScopeForTab('options'), 'options');
  assert.equal(marketScopeForTab('radar'), 'prediction');
  assert.equal(defaultTabForMarketScope('crypto'), 'binance');
  assert.equal(defaultTabForMarketScope('watchlist'), 'positions');
});

test('filters unified results without merging same-name instruments across markets', () => {
  const items = [
    { id: 'stock:us:BTC', type: 'stock' },
    { id: 'crypto:binance:BTCUSDT', type: 'crypto' },
    { id: 'prediction:predictfun:42', type: 'prediction' },
  ];
  assert.deepEqual(filterInstrumentResults(items, 'crypto'), [items[1]]);
  assert.deepEqual(filterInstrumentResults(items, 'overview'), items);
});

test('filters explicit stock and crypto scopes independently', () => {
  const items = [
    { id: 'stock:us:AAPL', type: 'stock' },
    { id: 'crypto:binance:BTCUSDT', type: 'crypto' },
  ];
  assert.deepEqual(filterInstrumentResults(items, 'stocks').map(item => item.type), ['stock']);
  assert.deepEqual(filterInstrumentResults(items, 'crypto').map(item => item.type), ['crypto']);
});
