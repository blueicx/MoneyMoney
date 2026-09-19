const test = require('node:test');
const assert = require('node:assert/strict');
const { DataSourceRouter } = require('../dist/features/data-source-router');

test('coalesces concurrent requests for the same source and params', async () => {
  const router = new DataSourceRouter();
  let calls = 0;
  router.register('quote', {
    markets: ['stocks'],
    capabilities: ['quote'],
    ttlMs: 0,
    fetchLive: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return { symbol: 'AAPL', price: 200 };
    },
  });

  const results = await Promise.all([
    router.fetch('quote', { marketId: 'stocks', capability: 'quote', symbol: 'AAPL' }),
    router.fetch('quote', { marketId: 'stocks', capability: 'quote', symbol: 'AAPL' }),
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(results.map(item => item.data), [{ symbol: 'AAPL', price: 200 }, { symbol: 'AAPL', price: 200 }]);
});

test('opens a source circuit after repeated failures and closes after a successful probe', async () => {
  const router = new DataSourceRouter();
  let calls = 0;
  router.register('unstable', {
    markets: ['crypto'],
    capabilities: ['quote'],
    quality: 'medium',
    retry: { maxAttempts: 1 },
    circuit: { failureThreshold: 2, openMs: 1000 },
    fetchLive: async () => {
      calls += 1;
      if (calls <= 2) throw new Error('upstream down');
      return { symbol: 'BTCUSDT', price: 77000 };
    },
  });

  const first = await router.fetch('unstable', { marketId: 'crypto', capability: 'quote' });
  const second = await router.fetch('unstable', { marketId: 'crypto', capability: 'quote', forceRefresh: true });
  const blocked = await router.fetch('unstable', { marketId: 'crypto', capability: 'quote', forceRefresh: true });
  assert.equal(first.capability.status, 'unavailable');
  assert.equal(second.capability.status, 'unavailable');
  assert.equal(blocked.capability.status, 'unavailable');
  assert.match(blocked.capability.reason, /熔断|circuit/i);
  assert.equal(calls, 2);

  router.resetCircuit('unstable');
  const recovered = await router.fetch('unstable', { marketId: 'crypto', capability: 'quote', forceRefresh: true });
  assert.equal(recovered.capability.status, 'live');
  assert.equal(recovered.capability.quality, 'medium');
  assert.equal(calls, 3);
});

test('source summaries expose health and completeness metadata without leaking params', () => {
  const router = new DataSourceRouter();
  router.register('news', {
    markets: ['stocks'],
    capabilities: ['news'],
    quality: 'high',
    completeness: 0.82,
    latency: 'delayed',
    fetchLive: async () => [],
  });
  const summary = router.listSources('stocks', 'news')[0];
  assert.equal(summary.completeness, 0.82);
  assert.equal(summary.latency, 'delayed');
  assert.equal(summary.health.status, 'healthy');
  assert.equal(JSON.stringify(summary).includes('fetchLive'), false);
});
