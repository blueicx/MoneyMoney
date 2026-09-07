const assert = require('node:assert/strict');

const {
  instrumentId,
  normalizeInstrumentRef,
  parseInstrumentQuery,
  dedupeInstrumentRefs,
  freshnessStatus,
  UNIFIED_AI_CACHE_TTL_MS,
} = require('../dist/features/unified-instruments');

assert.equal(instrumentId({ type: 'stock', venue: 'US', symbol: 'aapl' }), 'stock:us:AAPL');
assert.equal(instrumentId({ type: 'crypto', venue: 'Binance', symbol: 'btcusdt' }), 'crypto:binance:BTCUSDT');
assert.equal(instrumentId({ type: 'prediction', venue: 'PredictFun', symbol: '42' }), 'prediction:predictfun:42');

assert.deepEqual(normalizeInstrumentRef({
  type: 'stock', venue: 'US', symbol: 'aapl', title: 'Apple', aliases: ['AAPL'],
}), {
  id: 'stock:us:AAPL', type: 'stock', venue: 'us', symbol: 'AAPL', title: 'Apple', aliases: ['AAPL'],
});

assert.deepEqual(parseInstrumentQuery('BTCUSDT'), { type: 'crypto', symbol: 'BTCUSDT', venue: 'binance' });
assert.deepEqual(parseInstrumentQuery('stock:us:NVDA'), { type: 'stock', symbol: 'NVDA', venue: 'us' });
assert.deepEqual(parseInstrumentQuery('prediction:predictfun:market-7'), { type: 'prediction', symbol: 'market-7', venue: 'predictfun' });
assert.equal(parseInstrumentQuery('Apple'), null);

const first = normalizeInstrumentRef({ type: 'stock', venue: 'us', symbol: 'AAPL', title: 'Apple' });
const duplicate = normalizeInstrumentRef({ type: 'stock', venue: 'US', symbol: 'aapl', title: 'Apple Inc.' });
const crypto = normalizeInstrumentRef({ type: 'crypto', venue: 'binance', symbol: 'BTCUSDT', title: 'Bitcoin' });
assert.equal(dedupeInstrumentRefs([first, duplicate, crypto]).length, 2);
assert.equal(dedupeInstrumentRefs([first, duplicate])[0].title, 'Apple');

const now = Date.now();
assert.equal(freshnessStatus(new Date(now - 10_000).toISOString(), 60_000, now).status, 'fresh');
assert.equal(freshnessStatus(new Date(now - 120_000).toISOString(), 60_000, now).status, 'stale');
assert.equal(freshnessStatus(null, 60_000, now).status, 'unavailable');
assert.equal(UNIFIED_AI_CACHE_TTL_MS, 15 * 60_000);

console.log('unified instrument helpers: all assertions passed');
