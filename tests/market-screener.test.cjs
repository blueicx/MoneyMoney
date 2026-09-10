const test = require('node:test');
const assert = require('node:assert');

test('market screener allowed fields and validation', () => {
    const { createScreener, filterRows } = require('../dist/features/market-screener');
    
    const screener = createScreener('stocks', [{ symbol: 'AAPL', changePct: 2, marketCap: 100 }]);
    assert.deepEqual(screener.allowedFields, ['changePct', 'marketCap']);
    assert.throws(() => filterRows('stocks', screener.rows, { fundingRate: { gte: 0 } }), /scope/);
});
