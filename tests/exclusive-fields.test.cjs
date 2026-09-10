const test = require('node:test');
const assert = require('node:assert');

test('exclusive depth data fields isolation', () => {
    // A simple test to verify isolation logic
    const { getFields } = require('../dist/features/research-workspace');
    assert.ok(getFields('crypto').includes('fundingRate'));
    assert.ok(!getFields('stocks').includes('fundingRate'));
    assert.ok(getFields('prediction').includes('orderbook'));
    assert.ok(!getFields('stocks').includes('orderbook'));
});
