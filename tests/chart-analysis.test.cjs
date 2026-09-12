const test = require('node:test');
const assert = require('node:assert/strict');
const analysis = require('../src/web/public/chart-analysis.js');

function bars() {
  return [
    { time: 1, open: 10, high: 10.3, low: 9.8, close: 10.02, volume: 100 },
    { time: 2, open: 10.1, high: 10.15, low: 9.1, close: 10.05, volume: 120 },
    { time: 3, open: 10.0, high: 10.1, low: 9.1, close: 9.2, volume: 130 },
    { time: 4, open: 9.0, high: 10.2, low: 8.9, close: 10.1, volume: 140 },
    { time: 5, open: 10.2, high: 10.9, low: 10.15, close: 10.3, volume: 150 },
  ];
}

test('detects candlestick patterns with stable labels and directions', () => {
  const found = analysis.detectCandlestickPatterns(bars());
  assert.ok(found.some(item => item.type === 'hammer' && item.direction === 'bullish'));
  assert.ok(found.some(item => item.type === 'bullish-engulfing' && item.direction === 'bullish'));
  assert.ok(found.every(item => item.label && Number.isInteger(item.index)));
});

test('overlay configuration gates patterns, signals, indicators and volume', () => {
  const output = analysis.buildChartOverlays({
    bars: bars(),
    signals: [{ index: 3, side: 'buy', label: '动量买入' }],
    config: { patterns: false, signals: true, structures: true, volume: false, indicators: { ma: false, boll: true } },
  });
  assert.equal(output.patterns.length, 0);
  assert.equal(output.signals.length, 1);
  assert.ok(output.structures.length > 0);
  assert.equal(output.volume.length, 0);
  assert.equal(output.lines.some(line => line.type === 'boll'), true);
  assert.equal(output.lines.some(line => line.type === 'ma'), false);
});

test('replay actions stay within the available bar range', () => {
  assert.equal(analysis.stepReplay(0, 5, 'previous'), 0);
  assert.equal(analysis.stepReplay(0, 5, 'next'), 1);
  assert.equal(analysis.stepReplay(4, 5, 'next'), 4);
  assert.equal(analysis.stepReplay(4, 5, 'reset'), 0);
  assert.equal(analysis.stepReplay(4, 0, 'next'), -1);
});

test('detects selectable strategy signals with a strategy label and price', () => {
  const series = Array.from({ length: 35 }, (_, index) => {
    const close = index < 20 ? 100 - index * 0.8 : 84 + (index - 20) * 1.5;
    return { time: index + 1, open: close - 0.4, high: close + 0.6, low: close - 0.8, close, volume: 100 + index };
  });
  const found = analysis.detectStrategySignals(series, { maCross: true, rsiReversal: true, bollinger: true, volumeBreakout: true });
  assert.ok(found.length > 0);
  assert.ok(found.every(item => Number.isInteger(item.index) && item.price > 0 && item.strategy && item.label));
  assert.ok(found.some(item => item.strategy === 'maCross'));
});

test('keeps strategy defaults when loading an older overlay preference', () => {
  const config = analysis.normalizeOverlayConfig({ signals: true, indicators: { ma: true } });
  assert.equal(config.strategies.maCross, true);
  assert.equal(config.strategies.rsiReversal, false);
  assert.equal(config.strategies.bollinger, false);
  assert.equal(config.strategies.volumeBreakout, false);
});
