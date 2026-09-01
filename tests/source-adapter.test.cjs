const assert = require('node:assert/strict');
const test = require('node:test');
const { ResilientDataSourceAdapter } = require('../dist/data/source-adapter');

test('retries a transient source failure and returns a fresh snapshot', async () => {
  let attempts = 0;
  const adapter = new ResilientDataSourceAdapter({ id: 'test', group: 'test', retries: 2, backoffMs: 1, fetcher: async () => {
    attempts += 1;
    if (attempts < 2) throw new Error('temporary');
    return { value: 42 };
  }});
  const snapshot = await adapter.fetch();
  assert.equal(snapshot.status, 'fresh');
  assert.deepEqual(snapshot.data, { value: 42 });
  assert.equal(attempts, 2);
});

test('serves stale cached data after later failures', async () => {
  let fail = false;
  const adapter = new ResilientDataSourceAdapter({ id: 'test-stale', group: 'test', ttlMs: 1, retries: 0, fetcher: async () => {
    if (fail) throw new Error('offline');
    return 'cached';
  }});
  assert.equal((await adapter.fetch()).status, 'fresh');
  await new Promise(resolve => setTimeout(resolve, 5));
  fail = true;
  const stale = await adapter.fetch();
  assert.equal(stale.status, 'stale');
  assert.equal(stale.data, 'cached');
});
