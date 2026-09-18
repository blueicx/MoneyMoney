const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STOCK_KLINE_PERIODS,
  normalizeYahooChartPayload,
  aggregateStockBars,
  createYahooStockKlineAdapter,
} = require('../dist/data/yahoo-adapter');

test('stock period catalog is a single selectable set', () => {
  assert.deepEqual(Object.keys(STOCK_KLINE_PERIODS), ['5m', '15m', '1h', '1d', '3d', '5d', '60d', '120d', '1y', '5y']);
  assert.equal(STOCK_KLINE_PERIODS['5m'].interval, '5m');
  assert.equal(STOCK_KLINE_PERIODS['1d'].interval, '1d');
  assert.equal(STOCK_KLINE_PERIODS['3d'].aggregateDays, 3);
});

test('Yahoo chart payload becomes ordered numeric OHLCV bars', () => {
  const result = normalizeYahooChartPayload({
    chart: { result: [{
      timestamp: [30, 10, 20, 40],
      indicators: { quote: [{
        open: [3, 1, 2, null], high: [4, 2, 3, 4], low: [2, 0, 2, 3], close: [3.5, 1.5, 2.5, 3.5], volume: [30, 10, 20, 40],
      }] },
    }] },
  });
  assert.deepEqual(result, [
    { time: 10000, open: 1, high: 2, low: 0, close: 1.5, volume: 10 },
    { time: 20000, open: 2, high: 3, low: 2, close: 2.5, volume: 20 },
    { time: 30000, open: 3, high: 4, low: 2, close: 3.5, volume: 30 },
  ]);
});

test('daily stock bars can be aggregated into real multi-day period bars', () => {
  const bars = [1, 2, 3, 4, 5].map((day, index) => ({
    time: Date.UTC(2026, 0, day), open: day, high: day + 0.5, low: day - 0.5, close: day + 0.25, volume: day * 10,
  }));
  assert.deepEqual(aggregateStockBars(bars, 3), [
    { time: bars[0].time, open: 1, high: 3.5, low: 0.5, close: 3.25, volume: 60 },
    { time: bars[3].time, open: 4, high: 5.5, low: 3.5, close: 5.25, volume: 90 },
  ]);
});

test('Yahoo stock kline adapter maps a period to a real chart request', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let requestedUrl = '';
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({ chart: { result: [{
        timestamp: [10],
        indicators: { quote: [{ open: [1], high: [2], low: [0.5], close: [1.5], volume: [100] }] },
      }] } }),
    };
  };
  const adapter = createYahooStockKlineAdapter();
  const result = await adapter.fetch({ symbol: 'AAPL', period: '5m' });
  assert.equal(result.status, 'live');
  assert.equal(result.data[0].close, 1.5);
  assert.match(requestedUrl, /query1\.finance\.yahoo\.com\/v8\/finance\/chart\/AAPL/);
  assert.match(requestedUrl, /interval=5m/);
});

test('Yahoo stock kline adapter preserves mainland stock exchange mapping', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let requestedUrl = '';
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({ chart: { result: [{ timestamp: [10], indicators: { quote: [{ open: [1], high: [2], low: [1], close: [2], volume: [1] }] } }] } }),
    };
  };
  const result = await createYahooStockKlineAdapter().fetch({ symbol: 'sh600519', period: '1d' });
  assert.equal(result.status, 'live');
  assert.match(requestedUrl, /chart\/600519\.SS/);
});
