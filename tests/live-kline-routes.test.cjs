const test = require('node:test'), assert = require('node:assert/strict'), express = require('express');
const { createLiveKlineRouter } = require('../dist/web/live-kline-routes');
const { LiveKlineHub } = require('../dist/features/live-kline-stream');
test('private SSE validates market scope and closes clients during hub shutdown', async () => {
  const hub = new LiveKlineHub({ enabled: false }), app = express();
  app.use((req, res, next) => { req.user = { role: req.headers['x-fixture-role'] || 'guest' }; next(); });
  app.use('/stream', createLiveKlineRouter(hub));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/stream?market=crypto&instrument=BTCUSDT&interval=5m')).status, 403);
    const headers = { 'x-fixture-role': 'admin' };
    assert.equal((await fetch(base + '/stream?market=stocks&instrument=AAPL', { headers })).status, 400);
    assert.equal((await fetch(base + '/stream?market=crypto&instrument=crypto:deribit:BTC-PERPETUAL', { headers })).status, 400);
    const controller = new AbortController();
    const response = await fetch(base + '/stream?market=crypto&instrument=BTCUSDT&interval=5m', { headers, signal: controller.signal });
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    const reader = response.body.getReader(), first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /disabled/);
    hub.close();
    const complete = await Promise.race([reader.read().then(row => row.done), new Promise(resolve => setTimeout(() => resolve(false), 300))]);
    controller.abort(); assert.equal(complete, true, 'shutdown must release SSE before server.close');
  } finally { hub.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
