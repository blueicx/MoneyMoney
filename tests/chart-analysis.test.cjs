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
  assert.ok(found.some(item => (item.type === 'hammer' || item.type === 'hanging-man')));
  assert.ok(found.some(item => item.type === 'bullish-engulfing' && item.direction === 'bullish'));
  assert.ok(found.every(item => item.label && Number.isInteger(item.index) && item.confidence && item.condition && item.meaning && item.disclaimer));
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

test('chart analysis exposes extended candlestick patterns and Chan structure graph', () => {
  const input = [
    { time: 1, open: 10, high: 10, low: 10, close: 10, volume: 1 },
    { time: 2, open: 10, high: 12, low: 10, close: 12, volume: 1 },
    { time: 3, open: 12, high: 12, low: 12, close: 12, volume: 1 },
    { time: 4, open: 12, high: 13, low: 11, close: 11, volume: 1 },
    { time: 5, open: 11, high: 11, low: 9, close: 9, volume: 1 },
    { time: 6, open: 9, high: 10, low: 9, close: 10, volume: 1 },
    { time: 7, open: 10, high: 11, low: 10, close: 11, volume: 1 },
  ];
  const patterns = analysis.detectCandlestickPatterns(input);
  assert.ok(patterns.some(item => ['spinning-top', 'marubozu', 'tweezer-top', 'tweezer-bottom', 'three-inside-up', 'three-inside-down'].includes(item.type)));
  const graph = analysis.detectChanStructures(input);
  assert.ok(Array.isArray(graph.fractals));
  assert.ok(Array.isArray(graph.strokes));
  assert.ok(Array.isArray(graph.segments));
  assert.ok(Array.isArray(graph.hubs));
  assert.ok(Array.isArray(graph.tradePoints));
  assert.ok(graph.fractals.every(item => item.index > 0 && item.index < input.length - 1));
});

test('Chan structures with trends and buy/sell points', () => {
  const input = [
    { time: 1, open: 10, high: 10, low: 10, close: 10, volume: 1 },
    { time: 2, open: 10, high: 12, low: 10, close: 12, volume: 1 },
    { time: 3, open: 12, high: 12, low: 12, close: 12, volume: 1 },
    { time: 4, open: 12, high: 13, low: 11, close: 11, volume: 1 },
    { time: 5, open: 11, high: 11, low: 9, close: 9, volume: 1 },
    { time: 6, open: 9, high: 10, low: 9, close: 10, volume: 1 },
    { time: 7, open: 10, high: 11, low: 10, close: 11, volume: 1 },
  ];
  const graph = analysis.detectChanStructures(input);
  assert.ok(Array.isArray(graph.trends));
  assert.ok(Array.isArray(graph.tradePoints));
});

test('Replay bounds and context protection', () => {
  assert.equal(analysis.stepReplay(0, 5, 'previous'), 0);
  assert.equal(analysis.stepReplay(4, 5, 'next'), 4);
  const state = analysis.protectReplayContext({ data: [], length: 0 });
  assert.equal(state.reason, 'Insufficient data');
  const safe = analysis.protectReplayContext({ market: 'stocks', instrument: 'AAPL', timeframe: '1d', data: [{ close: 1 }] });
  assert.equal(safe.safe, true);
});

test('Custom drawing tools interface', () => {
  const drawing = analysis.createDrawingTool('trendline');
  assert.equal(drawing.type, 'trendline');
  const item = drawing.create({ points: [{ time: 1, price: 10 }, { time: 2, price: 11 }] });
  assert.equal(item.type, 'trendline');
  assert.equal(drawing.update(item.id, { label: '阻力线' }).label, '阻力线');
  assert.equal(drawing.list().length, 1);
  const restored = analysis.createDrawingTool('trendline');
  restored.restore(drawing.serialize());
  assert.equal(restored.list()[0].label, '阻力线');
  assert.equal(restored.remove(item.id), true);
  assert.equal(restored.list().length, 0);
});

test('MACD overlay is calculated from bars and exposes an explicit empty reason', () => {
  const series = Array.from({ length: 50 }, (_, index) => ({ time: index + 1, open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, volume: 100 }));
  const macd = analysis.calculateMACD(series);
  assert.equal(macd.available, true);
  assert.equal(macd.macdLine.length, series.length);
  assert.ok(macd.histogram.some(value => Number.isFinite(value)));
  const empty = analysis.calculateMACD(series.slice(0, 5));
  assert.equal(empty.available, false);
  assert.match(empty.reason, /historical data/i);
});

test('chart page loads runtime handlers outside the external script tag', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '../src/web/public/index.html'), 'utf8');
  const script = html.match(/<script\s+src="\/chart-analysis\.js">([\s\S]*?)<\/script>/i);
  assert.ok(script);
  assert.equal(script[1].trim(), '');
  assert.match(html, /window\.selectInstrument\s*=|function\s+selectInstrument\s*\(/i);
});

test('Data shortage yields explanation', () => {
  const result = analysis.buildChartOverlays({ bars: [], config: {} });
  assert.equal(result.emptyReason, 'Insufficient historical data');
});
