const assert = require('node:assert/strict');
const test = require('node:test');

const { createBinanceKlineAdapter, normalizeBinanceKlines } = require('../dist/data/binance-kline-adapter');

test('Binance kline normalizer keeps ordered numeric OHLCV rows', () => {
  const rows = normalizeBinanceKlines([
    [2000, '2', '3', '1', '2.5', '10'],
    ['bad', 'x', '3', '1', '2.5', '10'],
    [1000, '1', '2', '0.5', '1.5', '8'],
  ]);
  assert.deepEqual(rows.map(row => row.time), [1000, 2000]);
  assert.equal(rows[1].close, 2.5);
});
test('Binance kline adapter scopes the symbol and interval in the public request', async () => {
  let requestUrl = '';
  const adapter = createBinanceKlineAdapter({
    baseUrl: 'https://binance.test',
    fetchImpl: async (input) => {
      requestUrl = String(input);
      return { ok: true, json: async () => [[1000, '1', '2', '0.5', '1.5', '8']] };
    },
  });
  const result = await adapter.fetch({ symbol: 'BTC', period: '5m', limit: 20 });
  assert.equal(result.status, 'live');
  assert.match(requestUrl, /symbol=BTCUSDT/);
  assert.match(requestUrl, /interval=5m/);
  assert.match(requestUrl, /limit=20/);
});
