const test = require('node:test');
const assert = require('node:assert/strict');

test('screener exposes only fields owned by the selected market', () => {
  const { createScreener, filterRows, sortRows, paginateRows } = require('../dist/features/market-screener');
  assert.deepEqual(createScreener('stocks').fields.map(field => field.key), ['changePct', 'marketCap']);
  assert.deepEqual(createScreener('options').fields.map(field => field.key), ['impliedVolPct', 'openInterest', 'putCallOIRatio']);
  assert.deepEqual(createScreener('crypto').fields.map(field => field.key), ['changePct', 'fundingRate', 'openInterest']);
  assert.deepEqual(createScreener('prediction').fields.map(field => field.key), ['yesPrice', 'noPrice', 'liquidity']);
  assert.throws(() => filterRows('stocks', [{ changePct: 1 }], { fundingRate: { gte: 0 } }), /scope/);
});

test('screener filters, sorts stably, and paginates without mutating input', () => {
  const { filterRows, sortRows, paginateRows } = require('../dist/features/market-screener');
  const rows = [
    { symbol: 'AAPL', changePct: 2, marketCap: 100 },
    { symbol: 'MSFT', changePct: 2, marketCap: 200 },
    { symbol: 'TSLA', changePct: -1, marketCap: 80 },
  ];
  const filtered = filterRows('stocks', rows, { changePct: { gte: 0 } });
  assert.deepEqual(filtered.map(row => row.symbol), ['AAPL', 'MSFT']);
  const sorted = sortRows('stocks', filtered, { field: 'changePct', direction: 'desc' });
  assert.deepEqual(sorted.map(row => row.symbol), ['AAPL', 'MSFT']);
  assert.deepEqual(paginateRows(sorted, 1, 2).rows.map(row => row.symbol), ['MSFT']);
  assert.deepEqual(rows.map(row => row.symbol), ['AAPL', 'MSFT', 'TSLA']);
});

test('comparison rejects mixed markets and normalizes missing fields', () => {
  const { compareInstruments, createCompareSnapshot } = require('../dist/features/instrument-compare');
  assert.throws(() => compareInstruments('stocks', [{ type: 'stock' }, { type: 'crypto' }]), /market scope/);
  const result = compareInstruments('stocks', [{ id: 'stock:us:AAPL', type: 'stock', symbol: 'AAPL', quote: { price: 1 } }]);
  assert.equal(result[0].quote.price, 1);
  assert.equal(result[0].quote.changePct, null);
  assert.equal(result[0].freshness.status, 'unavailable');
  assert.match(createCompareSnapshot('stocks', result).id, /^cmp_/);
});
