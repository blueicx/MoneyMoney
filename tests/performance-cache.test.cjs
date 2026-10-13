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

test('Performance cache exposes origin latency and distinguishes origin, coalesced, and cache responses', async () => {
  const { createPerformanceCache } = await import('../dist/features/performance-cache.js');
  const cache = createPerformanceCache();
  let calls = 0;
  let release;
  const fetcher = async () => {
    calls += 1;
    await new Promise(resolve => { release = resolve; });
    return { rows: [1, 2, 3] };
  };
  const originPromise = cache.fetch('AAPL:5m', fetcher, { scope: 'stocks', source: 'yahoo', ttl: 1000 });
  await new Promise(resolve => setImmediate(resolve));
  const coalescedPromise = cache.fetch('AAPL:5m', fetcher, { scope: 'stocks', source: 'yahoo', ttl: 1000 });
  release();
  const [origin, coalesced] = await Promise.all([originPromise, coalescedPromise]);
  assert.equal(calls, 1, 'coalesced callers must share one provider request');
  assert.equal(origin.cacheMode, 'origin');
  assert.equal(coalesced.cacheMode, 'coalesced');
  assert.equal(typeof origin.providerLatencyMs, 'number');
  assert.equal(coalesced.providerLatencyMs, origin.providerLatencyMs);
  assert.equal(typeof origin.providerLatencyAt, 'number');

  const cached = await cache.fetch('AAPL:5m', fetcher, { scope: 'stocks', source: 'yahoo', ttl: 1000 });
  assert.equal(cached.cacheMode, 'cache');
  assert.equal(cached.providerLatencyMs, origin.providerLatencyMs, 'cache telemetry is the last provider measurement, not a new request');
  assert.equal(cached.providerLatencyAt, origin.providerLatencyAt);
});

test('stale cache telemetry is marked stale while retaining the timestamp of the last provider measurement', async () => {
  const { createPerformanceCache } = await import('../dist/features/performance-cache.js');
  const cache = createPerformanceCache();
  const initial = await cache.fetch('BTCUSDT:1m', async () => ({ close: 10 }), { scope: 'crypto', source: 'binance', ttl: 5, staleTtl: 500 });
  await new Promise(resolve => setTimeout(resolve, 10));
  const stale = await cache.fetch('BTCUSDT:1m', async () => new Promise(() => {}), { scope: 'crypto', source: 'binance', ttl: 5, staleTtl: 500, timeoutMs: 1000 });
  assert.equal(stale.cacheMode, 'stale');
  assert.equal(stale.providerLatencyAt, initial.providerLatencyAt);
  assert.equal(stale.providerLatencyMs, initial.providerLatencyMs);
});

test('provider failure telemetry survives immutable thrown values', async () => {
  const { createPerformanceCache } = await import('../dist/features/performance-cache.js');
  const cache = createPerformanceCache();
  const frozenFailure = Object.freeze(new Error('immutable upstream failure'));
  const result = await cache.fetch('AAPL:1d', async () => { throw frozenFailure; }, { scope: 'stocks', source: 'yahoo', ttl: 1000 });
  assert.equal(result.cacheMode, 'error');
  assert.match(result.error.message, /immutable upstream failure/);
  assert.ok(Number.isFinite(result.providerLatencyMs) && result.providerLatencyMs >= 0);
  assert.equal(result.providerLatencyMs, result.error.providerLatencyMs);
  assert.ok(Number.isFinite(result.providerLatencyAt));
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
