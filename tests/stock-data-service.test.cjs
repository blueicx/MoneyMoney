const test = require('node:test');
const assert = require('node:assert/strict');
const { StockDataService } = require('../dist/features/stock-data-service');

function snapshot(id, data, status = 'fresh') {
  return { data, source: id, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), latencyMs: 3, status };
}

test('stock service returns quote, bars, filings and source snapshots independently', async () => {
  const service = new StockDataService({
    quote: { fetch: async () => snapshot('nasdaq-public-quote', { symbol: 'AAPL', price: 227.16 }) },
    bars: { fetch: async () => snapshot('nasdaq-public-history', [{ close: 227.16 }]) },
    filings: { fetch: async () => snapshot('sec-edgar-submissions', [{ form: '10-K' }]) },
    fundamentals: { fetch: async () => snapshot('sec-edgar-companyfacts', { companyName: 'Apple Inc.' }) },
  });
  const result = await service.overview('AAPL');
  assert.equal(result.symbol, 'AAPL');
  assert.equal(result.quote.price, 227.16);
  assert.equal(result.filings[0].form, '10-K');
  assert.equal(result.sources.every(item => item.status === 'fresh'), true);
});

test('one source failure does not erase successful stock cards', async () => {
  const service = new StockDataService({
    quote: { fetch: async () => snapshot('nasdaq-public-quote', { symbol: 'NVDA', price: 120 }) },
    bars: { fetch: async () => { throw new Error('history unavailable'); } },
    filings: { fetch: async () => snapshot('sec-edgar-submissions', []) },
    fundamentals: { fetch: async () => snapshot('sec-edgar-companyfacts', null, 'failed') },
  });
  const result = await service.overview('NVDA');
  assert.equal(result.quote.price, 120);
  assert.deepEqual(result.bars, []);
  assert.equal(result.sourceStatus['nasdaq-public-history'], 'unavailable');
});

test('quote-only path does not wait for history or SEC sources', async () => {
  let detailCalls = 0;
  const service = new StockDataService({
    quote: { fetch: async () => snapshot('nasdaq-public-quote', { symbol: 'AAPL', price: 227.16 }) },
    bars: { fetch: async () => { detailCalls += 1; return snapshot('nasdaq-public-history', []); } },
    filings: { fetch: async () => { detailCalls += 1; return snapshot('sec-edgar-submissions', []); } },
    fundamentals: { fetch: async () => { detailCalls += 1; return snapshot('sec-edgar-companyfacts', null); } },
  });
  const result = await service.quote('AAPL');
  assert.equal(result.quote.price, 227.16);
  assert.equal(result.snapshot.source, 'nasdaq-public-quote');
  assert.equal(detailCalls, 0);
});

test('non-stock symbols are rejected before any network adapter runs', async () => {
  const service = new StockDataService({ quote: { fetch: async () => { throw new Error('must not run'); } } });
  await assert.rejects(() => service.overview('crypto:binance:BTCUSDT'), /股票代码无效/);
});
