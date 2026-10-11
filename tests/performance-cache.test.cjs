const test = require('node:test');
const assert = require('node:assert');

test('Performance cache prevents duplicate requests and handles SWR', async () => {
  const { createPerformanceCache, createCacheEtag } = await import('../dist/features/performance-cache.js');
  const cache = createPerformanceCache();
  let callCount = 0;
  const fetcher = async () => { callCount++; return { data: `ok-${callCount}` }; };
  const [res1, res2] = await Promise.all([
    cache.fetch('scope1:source1:key1', fetcher, { ttl: 100 }),
    cache.fetch('scope1:source1:key1', fetcher, { ttl: 100 })
  ]);
  assert.strictEqual(callCount, 1, 'Concurrent requests should be deduplicated');
  assert.deepStrictEqual(res1.data, res2.data);
  assert.equal(res1.cacheHit, false, 'the request that populated the cache is not a cache hit');
  const fresh = await cache.fetch('scope1:source1:key1', fetcher, { ttl: 100 });
  assert.equal(fresh.status, 'fresh');
  assert.equal(fresh.cacheHit, true, 'a fresh cache response must be distinguishable from an upstream fetch');
  assert.equal(callCount, 1, 'Fresh cache hits should not call upstream');
  assert.match(createCacheEtag(fresh.data), /^"[0-9a-f]+"$/);
});

test('Performance cache serves stale data while refreshing once', async () => {
  const { createPerformanceCache } = await import('../dist/features/performance-cache.js');
  const cache = createPerformanceCache();
  let callCount = 0;
  const fetcher = async () => ({ version: ++callCount });
  await cache.fetch('stocks:nasdaq:AAPL', fetcher, { ttl: 50, staleTtl: 100 });
  await new Promise(resolve => setTimeout(resolve, 60));
  const stale = await cache.fetch('stocks:nasdaq:AAPL', fetcher, { ttl: 50, staleTtl: 100 });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.cacheHit, true);
  assert.deepStrictEqual(stale.data, { version: 1 });
  let refreshed;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    refreshed = await cache.fetch('stocks:nasdaq:AAPL', fetcher, { ttl: 50, staleTtl: 100 });
    if (refreshed.status === 'fresh') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(refreshed.status, 'fresh');
  assert.deepStrictEqual(refreshed.data, { version: 2 });
  assert.equal(callCount, 2);
});

test('Performance cache bounds entries and evicts the least recently used settled value', async () => {
  const { createPerformanceCache } = await import('../dist/features/performance-cache.js');
  const cache = createPerformanceCache({ maxEntries: 2 });
  let calls = 0;
  const load = key => cache.fetch(key, async () => ({ key, call: ++calls }), { ttl: 1000 });
  await load('a');
  await load('b');
  await load('a'); // touch a; b becomes least recently used
  await load('c');
  const a = await load('a');
  const b = await load('b');
  assert.equal(a.cacheHit, true);
  assert.equal(b.cacheHit, false);
  assert.equal(calls, 4);
});

test('stale refresh failures are absorbed and exposed on the next cached response', async () => {
  const { createPerformanceCache } = await import('../dist/features/performance-cache.js');
  const cache = createPerformanceCache();
  await cache.fetch('ticker', async () => ({ price: 100 }), { ttl: 5, staleTtl: 500 });
  await new Promise(resolve => setTimeout(resolve, 10));
  const stale = await cache.fetch('ticker', async () => { throw new Error('refresh offline'); }, { ttl: 5, staleTtl: 500 });
  assert.equal(stale.status, 'stale');
  await new Promise(resolve => setTimeout(resolve, 10));
  const observed = await cache.fetch('ticker', async () => ({ price: 101 }), { ttl: 5, staleTtl: 500 });
  assert.equal(observed.status, 'stale');
  assert.match(observed.error.message, /refresh offline/);
});

test('Performance cache reports an expired refresh failure', async () => {
  const { createPerformanceCache } = await import('../dist/features/performance-cache.js');
  const cache = createPerformanceCache();
  await cache.fetch('options:cboe:SPY', async () => ({ spot: 500 }), { ttl: 5, staleTtl: 5 });
  await new Promise(resolve => setTimeout(resolve, 20));
  const failed = await cache.fetch('options:cboe:SPY', async () => { throw new Error('upstream down'); }, { ttl: 5, staleTtl: 5 });
  assert.equal(failed.status, 'expired');
  assert.deepStrictEqual(failed.data, { spot: 500 });
  assert.match(failed.error.message, /upstream down/);
});

test('Performance cache isolates identical keys by scope and source', async () => {
  const { createPerformanceCache } = await import('../dist/features/performance-cache.js');
  const cache = createPerformanceCache();
  let stockCalls = 0;
  let cryptoCalls = 0;
  const stock = await cache.fetch('ticker', async () => ({ market: 'stocks', call: ++stockCalls }), { scope: 'stocks', source: 'nasdaq', ttl: 1000 });
  const crypto = await cache.fetch('ticker', async () => ({ market: 'crypto', call: ++cryptoCalls }), { scope: 'crypto', source: 'binance', ttl: 1000 });
  assert.deepEqual(stock.data, { market: 'stocks', call: 1 });
  assert.deepEqual(crypto.data, { market: 'crypto', call: 1 });
  assert.equal(stockCalls, 1);
  assert.equal(cryptoCalls, 1);
});

test('Performance cache bounds a slow fetch and keeps the previous value', async () => {
  const { createPerformanceCache } = await import('../dist/features/performance-cache.js');
  const cache = createPerformanceCache();
  await cache.fetch('ticker', async () => ({ price: 100 }), { scope: 'stocks', source: 'nasdaq', ttl: 1, staleTtl: 1 });
  await new Promise(resolve => setTimeout(resolve, 10));
  const result = await cache.fetch('ticker', () => new Promise(() => {}), { scope: 'stocks', source: 'nasdaq', ttl: 1, staleTtl: 1, timeoutMs: 5 });
  assert.equal(result.status, 'expired');
  assert.deepEqual(result.data, { price: 100 });
  assert.match(result.error.message, /timed out/i);
});
