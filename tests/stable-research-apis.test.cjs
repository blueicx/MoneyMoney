const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const serverSource = fs.readFileSync('src/web/server.ts', 'utf8');
const repositorySource = fs.readFileSync('src/features/research-repository.ts', 'utf8');

test('stable research and paper API routes are registered', () => {
  for (const route of [
    "app.get('/api/research/experiments/:id'",
    "app.post('/api/research/experiments/:id/rerun'",
    "app.get('/api/paper/orders/:id'",
    "app.get('/api/alerts/deliveries'",
    "app.post('/api/alerts/:id/ack'",
    "app.get('/api/kline/:market/:instrument'",
    "app.get('/api/kline/:market/:instrument/replay'",
    "app.post('/api/kline/:market/:instrument/drawings'",
    "app.get('/api/data/corporate-actions'",
    "app.get('/api/data/providers'",
    "app.get('/api/data/coverage'",
    "dataLakeCatalog.listRevisions",
  ]) assert.ok(serverSource.includes(route), `missing ${route}`);
});

test('repository exposes persistent lookup helpers for stable APIs', () => {
  for (const method of ['listExperiments', 'listAlertDeliveries', 'updateAlertDeliveryStatus']) {
    assert.match(repositorySource, new RegExp(`\\b${method}\\s*\\(`), `missing ${method}`);
  }
});

test('repository delivery status updates are persisted with bounded listing', () => {
  assert.match(repositorySource, /ORDER BY rowid DESC LIMIT \?/);
  assert.match(repositorySource, /const next = \{ \.\.\.delivery, status/);
});

test('stable K-line route keeps explicit market scope and no cross-market fallback', () => {
  const start = serverSource.indexOf("app.get('/api/kline/:market/:instrument'");
  assert.ok(start >= 0);
  const block = serverSource.slice(start, start + 7000);
  assert.match(block, /MARKET_IDS/);
  assert.match(block, /market.*stocks|market.*crypto|market.*options|market.*prediction/s);
  assert.match(block, /unavailable|暂无数据|当前市场不支持/);
});

test('K-line time machine reads persisted asOf snapshots without live fallback', () => {
  const start = serverSource.indexOf('async function scopedKlinePayload');
  assert.ok(start >= 0);
  const block = serverSource.slice(start, start + 6000);
  assert.match(block, /queryBarsAsOf\(/);
  assert.match(block, /asOf/);
  assert.match(block, /没有在 asOf 时点之前发布的数据分区|历史数据不可用|来源不可用/);
  const stockRoute = serverSource.slice(serverSource.indexOf("app.get('/api/stock/kline'"), serverSource.indexOf("app.get('/api/diagnostics'"));
  assert.match(stockRoute, /asOf/);
  assert.match(stockRoute, /queryBarsAsOf\(/);
  assert.match(stockRoute, /不回退|historical|历史/);
});

test('stock K-line UI exposes an explicit data time machine control', () => {
  const html = fs.readFileSync('src/web/public/index.html', 'utf8');
  assert.match(html, /data-chart-as-of/);
  assert.match(html, /applyStockKlineAsOf/);
  assert.match(html, /clearStockKlineAsOf/);
  assert.match(html, /[?&]asOf=/);
});
