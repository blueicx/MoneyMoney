const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreStockTechnicalSnapshot } = require('../dist/features/trade-assistant');

test('trade assistant exposes the reusable stock technical scorer', () => {
  assert.equal(typeof scoreStockTechnicalSnapshot, 'function');
});

test('technical scorer uses the established daily indicators and returns an explainable action', { skip: typeof scoreStockTechnicalSnapshot !== 'function' }, () => {
  const bars = Array.from({ length: 80 }, (_, index) => {
    const close = 50 + index * 0.7 + Math.sin(index / 3);
    return { time: Date.UTC(2026, 0, index + 1), open: close - 0.3, high: close + 1, low: close - 1, close, volume: 1000 };
  });
  const action = scoreStockTechnicalSnapshot('usSNDK', { symbol: 'SNDK', name: 'SanDisk', price: bars.at(-1).close, changePct: 2.3 }, bars);
  assert.equal(action.venue, 'Stocks');
  assert.equal(action.symbol, 'usSNDK');
  assert.equal(action.entry, Number(bars.at(-1).close.toFixed(2)));
  assert.ok(['BUY', 'SELL', 'WAIT'].includes(action.action));
  assert.ok(action.reasons.some(reason => reason.includes('均线')));
  assert.equal(action.metrics['当日涨跌'], '2.3%');
});

test('technical scorer refuses short or invalid daily history', { skip: typeof scoreStockTechnicalSnapshot !== 'function' }, () => {
  const shortBars = Array.from({ length: 59 }, (_, index) => ({ time: index, open: 10, high: 11, low: 9, close: 10, volume: 1 }));
  assert.equal(scoreStockTechnicalSnapshot('usSNDK', { symbol: 'SNDK', price: 10, changePct: 0 }, shortBars), null);
  const invalidBars = Array.from({ length: 60 }, (_, index) => ({ time: index, open: 10, high: 9, low: 11, close: 10, volume: 1 }));
  assert.equal(scoreStockTechnicalSnapshot('usSNDK', { symbol: 'SNDK', price: 10, changePct: 0 }, invalidBars), null);
});
