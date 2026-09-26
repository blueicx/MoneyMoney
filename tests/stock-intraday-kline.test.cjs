const test = require('node:test');
const assert = require('node:assert/strict');
const { filterStockBarsForTradingDate, resolveStockExchangeTimeZone } = require('../dist/features/stock-intraday-kline.js');

test('intraday bars are selected by exchange-local trading date and include truthful OHLCV and navigation', () => {
  const bars = [
    { time: Date.parse('2026-09-25T13:30:00Z'), open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
    { time: Date.parse('2026-09-25T13:35:00Z'), open: 100.5, high: 102, low: 100, close: 101.5, volume: 20 },
    { time: Date.parse('2026-09-26T13:30:00Z'), open: 102, high: 103, low: 101, close: 102.5, volume: 30 },
  ];
  const result = filterStockBarsForTradingDate(bars, '2026-09-25', 'America/New_York');
  assert.equal(result.bars.length, 2);
  assert.deepEqual(result.ohlc, { open: 100, high: 102, low: 99, close: 101.5, volume: 30 });
  assert.equal(result.date, '2026-09-25');
  assert.equal(result.previousDate, null);
  assert.equal(result.nextDate, '2026-09-26');
  assert.throws(() => filterStockBarsForTradingDate(bars, '2026-02-30', 'America/New_York'), /date/i);
});

test('exchange timezone is explicit for common US, Hong Kong and mainland symbols', () => {
  assert.equal(resolveStockExchangeTimeZone('AAPL'), 'America/New_York');
  assert.equal(resolveStockExchangeTimeZone('HK0700'), 'Asia/Hong_Kong');
  assert.equal(resolveStockExchangeTimeZone('sh600519'), 'Asia/Shanghai');
});
