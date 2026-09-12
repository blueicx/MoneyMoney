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
  const fresh = await cache.fetch('scope1:source1:key1', fetcher, { ttl: 100 });
  assert.equal(fresh.status, 'fresh');
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
  assert.deepStrictEqual(stale.data, { version: 1 });
  await new Promise(resolve => setTimeout(resolve, 5));
  const refreshed = await cache.fetch('stocks:nasdaq:AAPL', fetcher, { ttl: 50, staleTtl: 100 });
  assert.equal(refreshed.status, 'fresh');
  assert.deepStrictEqual(refreshed.data, { version: 2 });
  assert.equal(callCount, 2);
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
