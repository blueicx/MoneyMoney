const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { runEventStudy, buildEventStudyCohort, classifyEventCategory, EventStudyRepository } = require('../dist/features/event-study');

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

test('cohort uses only earlier published same-category events with completed outcomes', () => {
  const history = Array.from({ length: 90 }, (_, index) => {
    const close = 100 + index + (index % 3);
    return { timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), open: close, high: close + 2, low: close - 2, close };
  });
  const at = index => history[index].timestamp;
  const events = [10, 20, 30, 40, 50, 60].map(index => ({ id: `past-${index}`, market: 'stocks', instrument: 'AAPL', title: 'Quarterly earnings report', occurredAt: at(index), publishedAt: at(index) }));
  events.push({ id: 'future-published', market: 'stocks', instrument: 'AAPL', title: 'Quarterly earnings report', occurredAt: at(25), publishedAt: at(75) });
  events.push({ id: 'other-kind', market: 'stocks', instrument: 'AAPL', title: 'Insider transaction', occurredAt: at(15), publishedAt: at(15) });
  events.push({ id: 'other-market', market: 'crypto', instrument: 'BTCUSDT', title: 'Quarterly earnings report', occurredAt: at(15), publishedAt: at(15) });
  const result = buildEventStudyCohort({ market: 'stocks', instrument: 'AAPL', eventAt: at(70), title: 'Quarterly earnings report', bars: history, events, afterBars: 2 });
  assert.equal(result.category, 'earnings');
  assert.equal(result.sampleSize, 6);
  assert.deepEqual(result.eventIds, events.slice(0, 6).map(item => item.id));
  assert.ok(result.confidence95Pct && result.confidence95Pct.length === 2);
  assert.ok(result.placebo && result.placebo.sampleSize > 0);
  assert.deepEqual(result, buildEventStudyCohort({ market: 'stocks', instrument: 'AAPL', eventAt: at(70), title: 'Quarterly earnings report', bars: history, events, afterBars: 2 }));
  assert.equal(classifyEventCategory('SEC Form 4 insider transaction'), 'insider');
});

test('cohort with sparse evidence warns and does not invent a confidence interval', () => {
  const result = buildEventStudyCohort({ market: 'stocks', instrument: 'AAPL', eventAt: bars[4].timestamp, title: 'Earnings', bars, events: [], afterBars: 1 });
  assert.equal(result.sampleSize, 0);
  assert.equal(result.confidence95Pct, null);
  assert.match(result.warnings.join(' '), /样本/);
});

test('cohort limit is applied after filtering future events so old eligible evidence is not starved', () => {
  const history = Array.from({ length: 250 }, (_, index) => {
    const close = 100 + index;
    return { timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), open: close, high: close + 1, low: close - 1, close };
  });
  const at = index => history[index].timestamp;
  const futureNoise = Array.from({ length: 200 }, (_, index) => ({
    id: `future-${index}`, market: 'stocks', instrument: 'AAPL', title: 'Quarterly earnings report', occurredAt: at(5 + index % 20), publishedAt: at(245),
  }));
  const eligible = { id: 'eligible-old', market: 'stocks', instrument: 'AAPL', title: 'Quarterly earnings report', occurredAt: at(10), publishedAt: at(10) };
  const result = buildEventStudyCohort({ market: 'stocks', instrument: 'AAPL', eventAt: at(240), title: 'Quarterly earnings report', bars: history, events: [...futureNoise, eligible], afterBars: 2 });
  assert.equal(result.sampleSize, 1);
  assert.deepEqual(result.eventIds, ['eligible-old']);
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
  assert.throws(() => repository.save({ id: 'unsafe', market: 'stocks', instrument: 'AAPL', eventAt: '2026-01-03T00:00:00.000Z', sourceUrl: 'javascript:alert(1)' }), /http\(s\)/i);
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
  assert.match(server, /selectResearchEvent\(eventEntities, eventId, asOf\)/);
  assert.match(server, /buildEventStudyCohort\(/);
  assert.match(server, /classifyEventCategory\(/);
  assert.match(server, /evidenceRefs: selectedEvent/);
  assert.match(html, /openEventResearchFromTimeline\(this\)/);
  assert.match(html, /同类历史事件/);
  assert.match(html, /事件标题/);
});
