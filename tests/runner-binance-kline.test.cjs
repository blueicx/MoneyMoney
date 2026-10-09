const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRunnerBinanceKlineUrl, fetchRunnerBinanceKlines } = require('../dist/features/runner-binance-kline');

test('runner klines use the VPS-reachable Binance public data endpoint', async () => {
  const url = buildRunnerBinanceKlineUrl('BTCUSDT');
  assert.equal(url.origin, 'https://data-api.binance.vision');
  assert.equal(url.pathname, '/api/v3/klines');
  assert.equal(url.searchParams.get('symbol'), 'BTCUSDT');
  assert.equal(url.searchParams.get('interval'), '1h');
  assert.equal(url.searchParams.get('limit'), '20');

  let request;
  const rows = await fetchRunnerBinanceKlines('ETHUSDT', new AbortController().signal, async (input, init) => {
    request = { url: String(input), signal: init.signal };
    return { ok: true, json: async () => [[1, '1', '2', '0.5', '1.5', '10']] };
  });
  assert.equal(new URL(request.url).origin, 'https://data-api.binance.vision');
  assert.ok(request.signal instanceof AbortSignal);
  assert.deepEqual(rows, [[1, '1', '2', '0.5', '1.5', '10']]);
});

test('runner kline endpoint refuses symbols outside Binance USDT spot scope', async () => {
  assert.throws(() => buildRunnerBinanceKlineUrl('BTCUSDC'), /USDT/);
  assert.throws(() => buildRunnerBinanceKlineUrl('BTCUSDT&limit=999'), /USDT/);
});
