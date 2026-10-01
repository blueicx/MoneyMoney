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

test('Form 4 archive failures remain unavailable or partial instead of becoming a false empty result', () => {
  const unavailable = buildStockCoverageMap('MU', { insider: { status: 'fulfilled', value: {
    symbol: 'MU', windowDays: 90, updatedAt: '2026-10-01T00:00:00.000Z', transactions: [],
    dataStatus: 'unavailable', failedFilings: 4, successfulFilings: 0, reason: 'SEC Form 4 原文 4/4 下载失败',
  } } });
  assert.equal(unavailable.capabilities.insider.status, 'unavailable');
  assert.match(unavailable.capabilities.insider.reason, /原文 4\/4 下载失败/);

  const partial = buildStockCoverageMap('MU', { insider: { status: 'fulfilled', value: {
    symbol: 'MU', windowDays: 90, updatedAt: '2026-10-01T00:00:00.000Z', transactions: [{ filedAt: '2026-09-28' }],
    dataStatus: 'partial', failedFilings: 2, successfulFilings: 3, reason: 'SEC Form 4 原文部分下载失败',
  } } });
  assert.equal(partial.capabilities.insider.status, 'partial');
  assert.equal(partial.capabilities.insider.count, 1);
  assert.match(partial.capabilities.insider.reason, /部分下载失败/);
});
