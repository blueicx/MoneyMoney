const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStockCoverageMap } = require('../dist/features/instrument-coverage');

test('stock coverage distinguishes empty data from source failure and reports actual time spans', () => {
  const coverage = buildStockCoverageMap('SNDK', {
    overview: { status: 'fulfilled', value: {
      quote: { price: 80, asOf: '2026-09-22T15:59:00Z' }, bars: [{ date: '2026-01-02' }, { date: '2026-09-22' }], filings: [], fundamentals: null,
      sources: [
        { source: 'quote', status: 'fresh', fetchedAt: '2026-09-22T10:00:00Z' },
        { source: 'bars', status: 'fresh', fetchedAt: '2026-09-22T10:00:00Z' },
        { source: 'filings', status: 'fresh', fetchedAt: '2026-09-22T10:00:00Z' },
        { source: 'fundamentals', status: 'unavailable', fetchedAt: '2026-09-22T10:00:00Z', error: 'SEC mapping missing' },
      ],
    } },
    news: { status: 'fulfilled', value: [{ publishedAt: '2026-09-21T12:00:00Z' }] },
    insider: { status: 'rejected', reason: new Error('SEC ticker not found') },
  });
  assert.equal(coverage.market, 'stocks');
  assert.equal(coverage.instrument, 'stock:us:SNDK');
  assert.equal(coverage.capabilities.quote.status, 'live');
  assert.equal(coverage.capabilities.quote.updatedAt, '2026-09-22T15:59:00Z');
  assert.equal(coverage.capabilities.quote.retrievedAt, '2026-09-22T10:00:00Z');
  assert.equal(coverage.capabilities.bars.coverage.from, '2026-01-02');
  assert.equal(coverage.capabilities.bars.updatedAt, '2026-09-22');
  assert.equal(coverage.capabilities.news.status, 'live');
  assert.equal(coverage.capabilities.news.updatedAt, '2026-09-21T12:00:00Z');
  assert.equal(coverage.capabilities.insider.status, 'unavailable');
  assert.match(coverage.capabilities.insider.reason, /SEC ticker not found/);
  assert.equal(coverage.capabilities.fundamentals.status, 'unavailable');
});

test('stock coverage rejects cross-market identifiers', () => {
  assert.throws(() => buildStockCoverageMap('crypto:binance:BTCUSDT', {}), /股票代码/);
});
