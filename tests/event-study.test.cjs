const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { runEventStudy, EventStudyRepository } = require('../dist/features/event-study');

const bars = [
  { timestamp: '2026-01-01T00:00:00.000Z', open: 100, high: 101, low: 99, close: 100, volume: 10 },
  { timestamp: '2026-01-02T00:00:00.000Z', open: 100, high: 103, low: 98, close: 101, volume: 12 },
  { timestamp: '2026-01-03T00:00:00.000Z', open: 101, high: 110, low: 100, close: 108, volume: 20 },
  { timestamp: '2026-01-04T00:00:00.000Z', open: 108, high: 109, low: 95, close: 97, volume: 25 },
  { timestamp: '2026-01-05T00:00:00.000Z', open: 97, high: 102, low: 96, close: 101, volume: 18 },
];

test('event study computes window return, MFE, MAE and recovery without future entry data', () => {
  const result = runEventStudy({ market: 'stocks', instrument: 'AAPL', eventAt: '2026-01-03T00:00:00.000Z', bars, beforeBars: 1, afterBars: 2 });
  assert.equal(result.eventBar.close, 108);
  assert.equal(result.window.length, 4);
  assert.equal(result.rawReturnPct, -6.4815);
  assert.equal(result.mfePct, 0.9259);
  assert.equal(result.maePct, -12.037);
  assert.equal(result.recoveryBars, null);
  assert.equal(result.benchmarkAdjustedReturnPct, null);
  assert.match(result.disclaimer, /历史.*统计/);
  assert.ok(result.warnings.some(item => /单事件/.test(item)));
});

test('event study computes benchmark adjustment only when timestamps align', () => {
  const benchmark = bars.map((bar, index) => {
    const close = [100, 100, 100, 95, 98][index];
    return { ...bar, open: close, close, high: close + 1, low: close - 1 };
  });
  const result = runEventStudy({ market: 'stocks', instrument: 'AAPL', eventAt: '2026-01-03T00:00:00.000Z', bars, benchmarkBars: benchmark, beforeBars: 0, afterBars: 2 });
  assert.equal(result.benchmarkAdjustedReturnPct, -4.4815);
});

test('event study rejects unsorted bars and cross-market identity', () => {
  assert.throws(() => runEventStudy({ market: 'stocks', instrument: 'AAPL', eventAt: '2026-01-03T00:00:00.000Z', bars: [bars[1], bars[0]] }), /ordered/i);
  assert.throws(() => runEventStudy({ market: 'crypto', instrument: 'AAPL', eventAt: '2026-01-03T00:00:00.000Z', bars }), /market|instrument/i);
});

test('event study repository keeps records isolated by market and supports shared state contracts', () => {
  const documents = new Map();
  const store = { get: key => documents.get(key) || null, set: (key, value) => documents.set(key, value) };
  const repository = new EventStudyRepository(store);
  const stocks = repository.save({ id: 'study-stock', market: 'stocks', instrument: 'AAPL', eventAt: '2026-01-03T00:00:00.000Z' });
  repository.save({ id: 'study-crypto', market: 'crypto', instrument: 'BTCUSDT', eventAt: '2026-01-03T00:00:00.000Z' });
  assert.equal(stocks.id, 'study-stock');
  assert.deepEqual(repository.list('stocks').map(item => item.instrument), ['AAPL']);
  assert.equal(repository.get('study-crypto').market, 'crypto');
});

test('event study API is wired to point-in-time bars and private evidence routes', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  const html = fs.readFileSync('src/web/public/index.html', 'utf8');
  assert.match(server, /app\.post\('\/api\/event-studies'/);
  assert.match(server, /queryBarsAsOf\(\{ market, instrument, timeframe, asOf \}\)/);
  assert.match(server, /app\.get\('\/api\/events\/:id\/evidence'/);
  assert.match(server, /eventStudyRepository\.save/);
  assert.match(html, /id="event-study-at"/);
  assert.match(html, /runEventStudyUi\(\)/);
});
