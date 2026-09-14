const test = require('node:test');
const assert = require('node:assert');
const { DataSourceRouter } = require('../dist/features/data-source-router.js');

test('Data Source Router routes based on capabilities', async () => {
    const router = new DataSourceRouter();
    
    router.register('mock-live', {
        fetchLive: async () => ({ value: 42 }),
        fetchCached: async () => null,
        lastUpdated: Date.now()
    });
    
    const liveRes = await router.fetch('mock-live', {});
    assert.strictEqual(liveRes.capability.status, 'live');
    assert.strictEqual(liveRes.data.value, 42);

    router.register('mock-cached', {
        fetchLive: async () => { throw new Error('Network offline'); },
        fetchCached: async () => ({ value: 24 }),
        lastUpdated: 12345
    });

    const cachedRes = await router.fetch('mock-cached', {});
    assert.strictEqual(cachedRes.capability.status, 'cached');
    assert.strictEqual(cachedRes.capability.reason, 'Network offline');
    assert.strictEqual(cachedRes.data.value, 24);
    
    const missingRes = await router.fetch('non-existent', {});
    assert.strictEqual(missingRes.capability.status, 'unavailable');
});