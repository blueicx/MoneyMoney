const test = require('node:test');
const assert = require('node:assert');

test('performance cache', () => {
    const { createResponseCache } = require('../dist/features/performance-cache');
    const cache = createResponseCache({ ttlMs: 1000, staleMs: 5000 });
    cache.set('stocks:AAPL', { price: 1 }, 'source-1');
    assert.equal(cache.read('stocks:AAPL', 'source-1').status, 'fresh');
    assert.equal(cache.read('stocks:AAPL', 'other').status, 'miss');
});
