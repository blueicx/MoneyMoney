const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-timeline-no-ai-'));
process.env.MONEYMONEY_DATA_DIR = dataDir;
const stock = require('../dist/features/stock-data-service');
const news = require('../dist/features/stock-news');
const calendar = require('../dist/features/event-calendar');
const ai = require('../dist/features/ai-runtime-config');
const binance = require('../dist/features/binance');
const options = require('../dist/features/options-market');
const prediction = require('../dist/features/prediction-radar');
const { UnifiedInstrumentService, normalizeInstrumentRef } = require('../dist/features/unified-instruments');

test('data-only timeline and overview reads never start a configured model or poison explicit analysis cache', async () => {
  const original = { stock: stock.stockDataService.overview, news: news.getStockNewsSnapshot,
    calendar: calendar.getUpcomingEventCalendar, ai: ai.getAiRuntimeConfig, fetch: global.fetch };
  let modelCalls = 0;
  const stamp = '2026-10-26T12:00:00.000Z';
  stock.stockDataService.overview = async () => ({ quote: { price: 100, asOf: stamp }, bars: [],
    filings: [{ form: '8-K', accessionNumber: '0001', filingDate: '2026-10-25', acceptedAt: stamp }],
    snapshots: [{ source: 'sec-edgar-submissions', fetchedAt: stamp }],
    sourceStatus: { 'nasdaq-public-quote': 'fresh', 'nasdaq-public-history': 'fresh', 'sec-edgar-submissions': 'fresh' } });
  news.getStockNewsSnapshot = async symbol => ({ items: [{ title: `${symbol} news`, source: 'Fixture', publishedAt: stamp }],
    status: 'live', retrievedAt: stamp });
  calendar.getUpcomingEventCalendar = async () => ({ events: [], stale: false, sourceStatus: { earnings: 'ok' } });
  ai.getAiRuntimeConfig = () => ({ configured: true, apiUrl: 'https://model.example.invalid/chat', apiKey: 'fixture', model: 'fixture' });
  global.fetch = async url => {
    assert.equal(url, 'https://model.example.invalid/chat', 'the test must not issue network requests');
    modelCalls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'fixture analysis' } }] }) };
  };
  try {
    const service = new UnifiedInstrumentService();
    const ref = normalizeInstrumentRef({ type: 'stock', venue: 'us', symbol: 'SAFETEST', title: 'fixture' });
    const timeline = await service.timeline(ref);
    assert.equal(modelCalls, 0, 'reading events must never call a model');
    assert.ok(timeline.items.some(item => item.title === 'SAFETEST news'));
    assert.ok(timeline.items.some(item => item.publishedAt === stamp && item.source === 'SEC EDGAR'));

    const dataOnly = await service.overview(ref);
    assert.equal(modelCalls, 0, 'ordinary overview reads must not start a model');
    assert.equal(dataOnly.analysis.status, 'unavailable');
    const overview = await service.overview(ref, { includeAnalysis: true });
    assert.equal(modelCalls, 1, 'explicit analysis remains available after a data-only read');
    assert.equal(overview.analysis.text, 'fixture analysis');
    await service.timeline(ref);
    assert.equal(modelCalls, 1, 'later timeline reads must not start another model call');
    const again = await service.overview(ref);
    assert.equal(again.analysis.status, 'unavailable', 'explicit analysis must not leak into data-only cache');
    assert.equal(modelCalls, 1);
  } finally {
    stock.stockDataService.overview = original.stock;
    news.getStockNewsSnapshot = original.news;
    calendar.getUpcomingEventCalendar = original.calendar;
    ai.getAiRuntimeConfig = original.ai;
    global.fetch = original.fetch;
  }
});

test('data-only reads remain model-free across crypto, options and prediction markets', async () => {
  const original = { price: binance.binanceFeed.getPrice, klines: binance.binanceFeed.getKlines,
    option: options.getEquityOptionsSnapshot, radar: prediction.getCachedPredictionRadarSlice,
    ai: ai.getAiRuntimeConfig, fetch: global.fetch };
  let modelCalls = 0;
  binance.binanceFeed.getPrice = async () => ({ price: 100 });
  binance.binanceFeed.getKlines = async () => [];
  options.getEquityOptionsSnapshot = async () => ({ spot: 100, source: 'fixture', asset: 'TEST', expiries: [] });
  prediction.getCachedPredictionRadarSlice = () => ({ markets: [{ id: 'fixture-market', yesPrice: 0.5 }], updatedAt: new Date().toISOString() });
  ai.getAiRuntimeConfig = () => ({ configured: true, apiUrl: 'https://model.example.invalid/chat', apiKey: 'fixture', model: 'fixture' });
  global.fetch = async () => { modelCalls++; throw new Error('unexpected network access'); };
  try {
    const service = new UnifiedInstrumentService();
    for (const input of [
      { type: 'crypto', venue: 'binance', symbol: 'TESTUSDT' },
      { type: 'option', venue: 'cboe', symbol: 'TEST' },
      { type: 'prediction', venue: 'predictfun', symbol: 'fixture-market' },
    ]) {
      const ref = normalizeInstrumentRef(input);
      const overview = await service.overview(ref);
      const timeline = await service.timeline(ref);
      assert.equal(overview.instrument.id, ref.id);
      assert.equal(timeline.instrument.id, ref.id);
      assert.equal(overview.analysis.status, 'unavailable');
    }
    assert.equal(modelCalls, 0);
  } finally {
    binance.binanceFeed.getPrice = original.price; binance.binanceFeed.getKlines = original.klines;
    options.getEquityOptionsSnapshot = original.option; prediction.getCachedPredictionRadarSlice = original.radar;
    ai.getAiRuntimeConfig = original.ai; global.fetch = original.fetch;
  }
});

test.after(() => { try { require('../dist/storage/sqlite-state').stateStore.close(); } catch {} fs.rmSync(dataDir, { recursive: true, force: true }); });
