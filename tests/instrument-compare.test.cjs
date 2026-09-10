const test = require('node:test');
const assert = require('node:assert');

test('instrument compare scope validation and extraction', () => {
    const { compareInstruments } = require('../dist/features/instrument-compare');
    assert.throws(() => compareInstruments([{ type: 'stock' }, { type: 'crypto' }]), /same market scope/);
    assert.equal(compareInstruments([{ type: 'stock', symbol: 'AAPL', quote: { price: 1 } }])[0].quote.price, 1);
});
