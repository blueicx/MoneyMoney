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

test('chart data status never calls a successful historical fetch real-time', () => {
  assert.equal(analysis.chartDataStatusLabel({ dataStatus: 'live' }), '最新可用行情（实时性未声明）');
  assert.equal(analysis.chartDataStatusLabel({ dataStatus: 'delayed' }), '延迟行情');
  assert.equal(analysis.chartDataStatusLabel({ dataStatus: 'cached' }), '缓存数据');
  assert.equal(analysis.chartDataStatusLabel({ dataStatus: 'historical', asOf: '2026-09-01T00:00:00.000Z' }), '历史时点数据');
  assert.equal(analysis.chartDataStatusLabel({ dataStatus: 'empty' }), '暂无数据');
});

test('candlestick patterns carry the triggering candle price snapshot', () => {
  const found = analysis.detectCandlestickPatterns(bars());
  assert.ok(found.length > 0);
  assert.ok(found.every(item => item.open === bars()[item.index].open));
  assert.ok(found.every(item => item.high === bars()[item.index].high));
  assert.ok(found.every(item => item.low === bars()[item.index].low));
  assert.ok(found.every(item => item.close === bars()[item.index].close));
  assert.ok(found.every(item => item.volume === bars()[item.index].volume));
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

test('chart marker labels stay inside the plot and avoid overlapping when signals cluster', () => {
  const bounds = { left: 10, right: 110, top: 20, bottom: 80 };
  const laidOut = analysis.layoutMarkerLabels([
    { id: 'a', x: 60, y: 50, width: 42, label: '买入' },
    { id: 'b', x: 60, y: 50, width: 42, label: '突破' },
    { id: 'c', x: 60, y: 50, width: 42, label: '回撤' },
  ], bounds, { height: 12, gap: 2 });

  assert.equal(laidOut.length, 3);
  assert.ok(laidOut.every(item => item.labelVisible));
  for (const item of laidOut) {
    assert.ok(item.x - item.width / 2 >= bounds.left);
    assert.ok(item.x + item.width / 2 <= bounds.right);
    assert.ok(item.y - item.height / 2 >= bounds.top);
    assert.ok(item.y + item.height / 2 <= bounds.bottom);
  }
  for (let i = 0; i < laidOut.length; i++) {
    for (let j = i + 1; j < laidOut.length; j++) {
      const a = laidOut[i], b = laidOut[j];
      const overlaps = Math.abs(a.x - b.x) < (a.width + b.width) / 2
        && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 2;
      assert.equal(overlaps, false, `${a.id} and ${b.id} labels must not overlap`);
    }
  }
});

test('chart marker label layout hides excess labels instead of moving them outside the plot', () => {
  const bounds = { left: 0, right: 80, top: 0, bottom: 26 };
  const laidOut = analysis.layoutMarkerLabels(Array.from({ length: 8 }, (_, index) => ({
    id: String(index), x: 40, y: 13, width: 70, label: `信号${index}`,
  })), bounds, { height: 12, gap: 2, maxLanes: 3 });

  assert.ok(laidOut.some(item => !item.labelVisible), 'dense labels should yield to the chart instead of escaping its bounds');
  assert.ok(laidOut.every(item => !item.labelVisible || (
    item.x - item.width / 2 >= bounds.left && item.x + item.width / 2 <= bounds.right
      && item.y - item.height / 2 >= bounds.top && item.y + item.height / 2 <= bounds.bottom
  )));
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

test('keeps long-lookback strategy signals when zooming into a viewport shorter than the lookback', () => {
  const series = Array.from({ length: 30 }, (_, index) => ({
    time: index + 1, open: 100, high: index === 25 ? 102 : 101, low: 99,
    close: index === 25 ? 101 : 100, volume: index === 25 ? 200 : 100,
  }));
  const enabled = { maCross: false, volumeBreakout: true };
  const fullSignals = analysis.detectStrategySignals(series, enabled);
  const viewportStart = 15;
  const viewportLength = 15;
  const fullPoints = analysis.buildStrategyChartPoints({
    bars: series, signals: fullSignals, market: 'stocks', instrument: 'stock:us:SNDK', timeframe: '5m',
    source: 'Isolated chart fixture', sourceTime: series.at(-1).time, live: false,
  });
  const visibleSignals = analysis.mapIndexedItemsToViewport(fullPoints, viewportStart, viewportLength);

  assert.deepEqual(analysis.detectStrategySignals(series.slice(viewportStart), enabled), [], 'the zoom window alone has no 20-bar warmup');
  assert.equal(visibleSignals.length, 1);
  assert.equal(visibleSignals[0].label, '放量突破买入');
  assert.equal(visibleSignals[0].index, 10, 'the signal index must be remapped to its visible candle');
  assert.equal(visibleSignals[0].sourceIndex, 25, 'the original full-history index must remain available to click navigation');
  assert.equal(visibleSignals[0].time, series[25].time);
  assert.deepEqual(
    [visibleSignals[0].open, visibleSignals[0].high, visibleSignals[0].low, visibleSignals[0].close, visibleSignals[0].volume],
    [series[25].open, series[25].high, series[25].low, series[25].close, series[25].volume],
    'a zoomed signal must keep the triggering candle values for its explanation',
  );
});

test('strategy chart points retain scoped evidence and distinguish forming from confirmed candles', () => {
  const input = [
    { time: 100, open: 10, high: 11, low: 9, close: 10.5, volume: 10 },
    { time: 200, open: 10.5, high: 12, low: 10, close: 11.5, volume: 20 },
  ];
  const signals = [
    { index: 0, side: 'buy', strategy: 'maCross', label: '均线金叉', reason: 'MA5 上穿 MA20', price: 10.5, time: 100 },
    { index: 1, side: 'sell', strategy: 'rsiReversal', label: 'RSI反转卖出', reason: '跌破70', price: 11.5, time: 200 },
  ];
  const points = analysis.buildStrategyChartPoints({
    bars: input, signals, market: 'stocks', instrument: 'stock:us:AAPL', timeframe: '5m',
    strategyVersion: 'chart-strategy-v1', source: 'NASDAQ snapshot', sourceTime: '2026-10-11T01:00:00.000Z',
    live: true, sourceFresh: true, currentBarClosed: false,
  });
  assert.equal(points.length, 2);
  assert.equal(points[0].status, 'confirmed');
  assert.equal(points[1].status, 'forming');
  assert.equal(points[1].triggerPrice, 11.5);
  assert.equal(points[1].time, 200);
  assert.equal(points[1].market, 'stocks');
  assert.equal(points[1].instrument, 'stock:us:AAPL');
  assert.equal(points[1].timeframe, '5m');
  assert.equal(points[1].source, 'NASDAQ snapshot');
  assert.equal(points[1].sourceTime, '2026-10-11T01:00:00.000Z');
  assert.equal(points[1].strategyVersion, 'chart-strategy-v1');
});

test('live strategy preview is suppressed on stale source and becomes confirmed only after close evidence', () => {
  const input = [{ time: 10, open: 10, high: 12, low: 9, close: 11, volume: 1 }];
  const signals = [{ index: 0, side: 'buy', strategy: 'maCross', label: '金叉', reason: 'cross', price: 11, time: 10 }];
  const context = { bars: input, signals, market: 'crypto', instrument: 'crypto:binance:BTCUSDT', timeframe: '1m', live: true, sourceFresh: false };
  assert.deepEqual(analysis.buildStrategyChartPoints(context), []);
  const closed = analysis.buildStrategyChartPoints({ ...context, sourceFresh: true, currentBarClosed: true });
  assert.equal(closed.length, 1);
  assert.equal(closed[0].status, 'confirmed');
  const historical = analysis.buildStrategyChartPoints({ ...context, live: false, sourceFresh: false });
  assert.equal(historical[0].status, 'confirmed');
});

test('stock forming signals require provider source time rather than a recent browser fetch', () => {
  const html = require('./helpers/dashboard-source.cjs').readDashboardSource();
  const start = html.indexOf('function buildStockStrategySignals');
  const block = html.slice(start, start + 1800);
  assert.match(block, /const sourceTime = Number\(metadata\.sourceTime\)/);
  assert.match(block, /sourceFresh = Number\.isFinite\(sourceTime\)/);
  assert.doesNotMatch(block, /const fetchedAt = Number\(metadata\.retrievedAt\)/);
});

test('strategy points reject invalid market, identity, timeframe, and future indices', () => {
  const point = { index: 1, side: 'buy', strategy: 'maCross', label: '金叉', reason: 'cross', price: 11, time: 20 };
  const bars = [{ time: 10, open: 10, high: 10, low: 9, close: 10, volume: 1 }, { time: 20, open: 10, high: 12, low: 10, close: 11, volume: 1 }];
  assert.deepEqual(analysis.buildStrategyChartPoints({ bars, signals: [point], market: 'options', instrument: 'stock:us:AAPL', timeframe: '1d' }), []);
  assert.deepEqual(analysis.buildStrategyChartPoints({ bars, signals: [{ ...point, index: 2 }], market: 'stocks', instrument: 'stock:us:AAPL', timeframe: '1d' }), []);
  assert.deepEqual(analysis.buildStrategyChartPoints({ bars, signals: [point], market: 'stocks', instrument: '', timeframe: '1d' }), []);
});

test('chart signal clustering groups only nearby screen points and retains each original signal', () => {
  assert.equal(typeof analysis.clusterChartPointsByPixel, 'function');
  const first = { signal: { id: 'a', label: '均线交叉' }, x: 20, y: 30 };
  const second = { signal: { id: 'b', label: '放量突破' }, x: 25, y: 34 };
  const distant = { signal: { id: 'c', label: 'RSI反转' }, x: 80, y: 70 };
  const groups = analysis.clusterChartPointsByPixel([first, second, distant], { radius: 12 });
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].items.map(item => item.signal.id), ['a', 'b']);
  assert.deepEqual(groups[1].items.map(item => item.signal.id), ['c']);
  assert.equal(groups[0].x, 22.5);
  assert.equal(groups[0].y, 32);
});

test('pixel clustering compares only nearby grid cells for sparse large signal histories', () => {
  const points = Array.from({ length: 1200 }, (_, index) => ({ x: index * 30, y: index % 2 ? 0 : 1, id: index }));
  const originalHypot = Math.hypot;
  let distanceChecks = 0;
  Math.hypot = (...values) => { distanceChecks += 1; return originalHypot(...values); };
  try {
    const clusters = analysis.clusterChartPointsByPixel(points, { radius: 14 });
    assert.equal(clusters.length, points.length);
    assert.ok(distanceChecks < points.length * 10, `expected grid-local checks, observed ${distanceChecks}`);
  } finally { Math.hypot = originalHypot; }
});

test('keeps strategy defaults when loading an older overlay preference', () => {
  const config = analysis.normalizeOverlayConfig({ signals: true, indicators: { ma: true } });
  assert.equal(config.strategies.maCross, true);
  assert.equal(config.strategies.rsiReversal, false);
  assert.equal(config.strategies.bollinger, false);
  assert.equal(config.strategies.volumeBreakout, false);
});

test('keeps candlestick patterns independently selectable', () => {
  const config = analysis.normalizeOverlayConfig({ patterns: true, patternTypes: { doji: false } });
  assert.equal(config.patternTypes.doji, false);
  assert.equal(config.patternTypes.hammer, true);
  const output = analysis.buildChartOverlays({ bars: bars(), config });
  assert.equal(output.patterns.some(item => item.type === 'doji'), false);
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

test('structure markers expose an explanation for the UI', () => {
  const output = analysis.buildChartOverlays({ bars: bars(), config: { structures: true } });
  assert.ok(output.structures.length > 0);
  assert.ok(output.structures.every(item => item.label && item.condition && item.meaning && item.disclaimer));
  assert.ok(output.explanations.some(item => item.kind === 'structure'));
});

test('structure and Chan markers expose exact price and confirmation status', () => {
  const output = analysis.buildChartOverlays({ bars: bars().concat(bars().map((bar, index) => ({ ...bar, time: bar.time + 5, close: bar.close + index * 0.2 }))), config: { structures: true, indicators: { ma: true } } });
  assert.ok(output.structures.length > 0);
  assert.ok(output.structures.every(item => Number.isFinite(item.price) && ['confirmed', 'preparing', 'invalidated'].includes(item.status)));
  assert.ok(output.chan.fractals.every(item => Number.isFinite(item.price) && item.status));
  assert.ok(output.chan.strokes.every(item => Number.isFinite(item.price) && item.status));
  assert.ok(output.chan.tradePoints.every(item => Number.isFinite(item.price) && item.status && item.meaning));
});

test('indicator lines expose the latest usable value for display', () => {
  const output = analysis.buildChartOverlays({ bars: Array.from({ length: 25 }, (_, index) => ({ time: index + 1, open: 10 + index, high: 11 + index, low: 9 + index, close: 10 + index, volume: 100 })), config: { indicators: { ma: true } } });
  const ma20 = output.lines.find(item => item.type === 'ma' && item.period === 20);
  assert.ok(ma20);
  assert.equal(ma20.latestValue, 24.5);
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
