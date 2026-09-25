const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  instrumentId,
  normalizeInstrumentRef,
  parseInstrumentQuery,
  dedupeInstrumentRefs,
  freshnessStatus,
  buildInstrumentOverviewSections,
  overviewDataStatus,
  filterEventsForInstrument,
  buildInstrumentTimeline,
  UNIFIED_AI_CACHE_TTL_MS,
} = require('../dist/features/unified-instruments');

assert.equal(instrumentId({ type: 'stock', venue: 'US', symbol: 'aapl' }), 'stock:us:AAPL');
assert.equal(instrumentId({ type: 'crypto', venue: 'Binance', symbol: 'btcusdt' }), 'crypto:binance:BTCUSDT');
assert.equal(instrumentId({ type: 'prediction', venue: 'PredictFun', symbol: '42' }), 'prediction:predictfun:42');

assert.deepEqual(normalizeInstrumentRef({
  type: 'stock', venue: 'US', symbol: 'aapl', title: 'Apple', aliases: ['AAPL'],
}), {
  id: 'stock:us:AAPL', type: 'stock', venue: 'us', symbol: 'AAPL', title: 'Apple', aliases: ['AAPL'],
});

assert.deepEqual(parseInstrumentQuery('BTCUSDT'), { type: 'crypto', symbol: 'BTCUSDT', venue: 'binance' });
assert.deepEqual(parseInstrumentQuery('stock:us:NVDA'), { type: 'stock', symbol: 'NVDA', venue: 'us' });
assert.deepEqual(parseInstrumentQuery('prediction:predictfun:market-7'), { type: 'prediction', symbol: 'market-7', venue: 'predictfun' });
assert.equal(parseInstrumentQuery('Apple'), null);

const first = normalizeInstrumentRef({ type: 'stock', venue: 'us', symbol: 'AAPL', title: 'Apple' });
const duplicate = normalizeInstrumentRef({ type: 'stock', venue: 'US', symbol: 'aapl', title: 'Apple Inc.' });
const crypto = normalizeInstrumentRef({ type: 'crypto', venue: 'binance', symbol: 'BTCUSDT', title: 'Bitcoin' });
assert.equal(dedupeInstrumentRefs([first, duplicate, crypto]).length, 2);
assert.equal(dedupeInstrumentRefs([first, duplicate])[0].title, 'Apple');

const now = Date.now();
assert.equal(freshnessStatus(new Date(now - 10_000).toISOString(), 60_000, now).status, 'fresh');
assert.equal(freshnessStatus(new Date(now - 120_000).toISOString(), 60_000, now).status, 'stale');
assert.equal(freshnessStatus(null, 60_000, now).status, 'unavailable');
assert.equal(UNIFIED_AI_CACHE_TTL_MS, 15 * 60_000);

const sections = buildInstrumentOverviewSections({
  quote: { price: 100 },
  marketData: null,
  klines: [{ close: 100 }],
  events: [],
  news: [],
  analysis: { status: 'unavailable' },
  sourceStatus: { quote: 'ok', market: 'unavailable', klines: 'ok', events: 'unavailable', news: 'unavailable' },
});
assert.deepEqual(sections.map(section => section.id), ['quote', 'history', 'events', 'news', 'analysis', 'timeline']);
assert.equal(sections.find(section => section.id === 'quote').status, 'live');
assert.equal(overviewDataStatus({ quote: 'ok', market: 'unavailable', klines: 'ok' }).state, 'degraded');
assert.equal(overviewDataStatus({ quote: 'stale', market: 'unavailable', klines: 'unavailable' }).state, 'cached');

const eventRows = [
  { id: 'earnings-2026-09-16-AAPL', title: 'AAPL 财报', category: 'earnings' },
  { id: 'earnings-2026-09-16-SNDK', title: 'SNDK 财报', category: 'earnings' },
  { id: 'macro-cpi', title: 'CPI y/y', category: 'macro' },
];
assert.deepEqual(filterEventsForInstrument(eventRows, { type: 'stock', symbol: 'AAPL' }).map(item => item.id), ['earnings-2026-09-16-AAPL']);
assert.deepEqual(filterEventsForInstrument(eventRows, { type: 'stock', symbol: 'SNDK' }).map(item => item.id), ['earnings-2026-09-16-SNDK']);
assert.deepEqual(filterEventsForInstrument(eventRows, { type: 'crypto', symbol: 'BTCUSDT' }), []);

const secTimeline = buildInstrumentTimeline([], [], [
  { form: '8-K', accessionNumber: '0001-26-000001', filingDate: '2026-09-20', acceptedAt: '2026-09-20T17:00:00.000Z', reportUrl: 'https://www.sec.gov/example' },
  { form: '10-K', accessionNumber: '0001-26-000002', filingDate: '2026-09-19' },
]);
assert.equal(secTimeline[0].publishedAt, '2026-09-20T17:00:00.000Z');
assert.equal(secTimeline[0].source, 'SEC EDGAR');
assert.equal(secTimeline[0].url, 'https://www.sec.gov/example');
assert.equal(secTimeline[1].publishedAt, null);
const unifiedSource = fs.readFileSync(path.join(__dirname, '../src/features/unified-instruments.ts'), 'utf8');
assert.doesNotMatch(unifiedSource, /normalized\.type === 'crypto'\s*\? newsFeed\.getNews\(\)/);

console.log('unified instrument helpers: all assertions passed');
