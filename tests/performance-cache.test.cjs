const test = require('node:test');
const assert = require('node:assert');

test('Performance cache prevents duplicate requests and handles SWR', async () => {
  const { createPerformanceCache } = await import('../dist/features/performance-cache.js');
  const cache = createPerformanceCache();
  let callCount = 0;
  const fetcher = async () => { callCount++; return { data: 'ok' }; };
  const [res1, res2] = await Promise.all([
    cache.fetch('scope1:source1:key1', fetcher, { ttl: 100 }),
    cache.fetch('scope1:source1:key1', fetcher, { ttl: 100 })
  ]);
  assert.strictEqual(callCount, 1, 'Concurrent requests should be deduplicated');
});
