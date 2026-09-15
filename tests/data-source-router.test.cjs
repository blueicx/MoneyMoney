const test = require('node:test');
const { strict: assert } = require('node:assert');
const { DataSourceRouter } = require('../dist/features/data-source-router.js');

test('router uses live data and exposes capability metadata', async () => {
  const router = new DataSourceRouter();
  router.register('stocks-live', { markets: ['stocks'], capabilities: ['quote'], quality: 'high', fetchLive: async params => ({ symbol: params.symbol, price: 123 }) });
  const result = await router.fetch('stocks-live', { marketId: 'stocks', capability: 'quote', symbol: 'AAPL' });
  assert.deepEqual(result.data, { symbol: 'AAPL', price: 123 });
  assert.equal(result.capability.status, 'live');
  assert.equal(result.capability.quality, 'high');
  assert.deepEqual(result.capability.marketScope, ['stocks']);
});

test('router never falls back across markets and reports unsupported capability clearly', async () => {
  const router = new DataSourceRouter();
  router.register('stocks-only', { markets: ['stocks'], capabilities: ['quote'], fetchLive: async () => ({ price: 1 }) });
  const result = await router.fetch('stocks-only', { marketId: 'crypto', capability: 'quote' });
  assert.equal(result.data, null);
  assert.equal(result.capability.status, 'unavailable');
  assert.match(result.capability.reason, /market|市场|支持/i);
  const missing = await router.fetch('missing', { marketId: 'stocks', capability: 'news' });
  assert.equal(missing.capability.status, 'unavailable');
  assert.match(missing.capability.reason, /Source not found/);
});

test('router retries, falls back to cache, and distinguishes empty data', async () => {
  const router = new DataSourceRouter();
  let calls = 0;
  router.register('retry-empty', { markets: ['options'], capabilities: ['optionsChain'], retry: { maxAttempts: 2, delayMs: 0 }, fetchLive: async () => { calls += 1; if (calls === 1) throw new Error('temporary'); return []; }, fetchCached: async () => [{ contract: 'AAPL-2027' }], lastUpdated: 42 });
  const empty = await router.fetch('retry-empty', { marketId: 'options', capability: 'optionsChain' });
  assert.equal(calls, 2);
  assert.equal(empty.capability.status, 'empty');
  router.register('cached-only', { markets: ['prediction'], capabilities: ['events'], fetchLive: async () => { throw new Error('offline'); }, fetchCached: async () => ({ event: 'cached' }), lastUpdated: 100 });
  const cached = await router.fetch('cached-only', { marketId: 'prediction', capability: 'events' });
  assert.deepEqual(cached.data, { event: 'cached' });
  assert.equal(cached.capability.status, 'cached');
});
