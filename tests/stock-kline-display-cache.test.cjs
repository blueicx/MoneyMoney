const test = require('node:test');
const assert = require('node:assert/strict');

test('stock K-line display cache is only available to an explicit latest source-basis chart request', async () => {
  const { isCacheableLatestStockChart, stockKlineDisplayCacheKey } = await import('../dist/features/stock-kline-display-cache.js');
  const live = { chartWindow: '1', adjustment: 'source' };
  assert.equal(isCacheableLatestStockChart(live), true);
  assert.equal(isCacheableLatestStockChart({ ...live, asOf: '2026-10-01T23:59:59Z' }), false);
  assert.equal(isCacheableLatestStockChart({ ...live, date: '2026-10-01' }), false);
  assert.equal(isCacheableLatestStockChart({ ...live, before: 1000 }), false);
  assert.equal(isCacheableLatestStockChart({ ...live, adjustment: 'forward' }), false);
  assert.equal(isCacheableLatestStockChart({ adjustment: 'source' }), false);
  assert.equal(stockKlineDisplayCacheKey('usAAPL', '1D', { startTime: 10, limit: 300 }), 'USAAPL:1d:10:300');
  assert.notEqual(stockKlineDisplayCacheKey('AAPL', '1d'), stockKlineDisplayCacheKey('MSFT', '1d'));
});
