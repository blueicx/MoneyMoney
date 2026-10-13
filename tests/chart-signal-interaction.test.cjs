const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const html = require('./helpers/dashboard-source.cjs').readDashboardSource();

function signalRuntimeSource() {
  const start = html.indexOf('function handleChartSignalSelection(');
  const end = html.indexOf('\nfunction renderChartPatternList(', start);
  assert.ok(start >= 0 && end > start, 'signal selection and renderer functions should exist');
  return html.slice(start, end);
}

test('chart strategy hit targets cluster dense points and let the user choose exact evidence', () => {
  const dom = new JSDOM('<div id="stock-chart-signal-markers" style="width:240px;height:180px"></div><div id="stock-chart-signals"></div><div id="stock-chart-evidence-status"></div><div id="stock-chart-evidence-detail"></div>', { runScripts: 'outside-only' });
  const window = dom.window;
  const selected = [];
  window.MoneyChartAnalysis = {
    clusterChartPointsByPixel(items, { radius }) {
      assert.equal(radius, 14);
      const groups = [];
      for (const item of items) {
        const group = groups.find(candidate => Math.hypot(candidate.x - item.x, candidate.y - item.y) <= radius);
        if (group) { group.items.push(item); group.x = group.items.reduce((sum, value) => sum + value.x, 0) / group.items.length; group.y = group.items.reduce((sum, value) => sum + value.y, 0) / group.items.length; }
        else groups.push({ x: item.x, y: item.y, items: [item] });
      }
      return groups;
    },
  };
  window.stockEscapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  window.formatStockKlineTime = value => new Date(value).toISOString();
  window.formatChartTime = window.formatStockKlineTime;
  window.stockChartKlines = [0, 1, 2].map(index => ({ time: index + 1, open: 10, high: 12, low: 9, close: 11, volume: 50 }));
  window.stockChartReplayIndex = 0;
  window.selectedSignals = selected;
  window.showStockChartEvidence = item => selected.push(item);
  window.drawStockKline = () => {};
  window.eval(signalRuntimeSource());

  const signals = [
    { label: '均线交叉买入', side: 'buy', time: 1, price: 11, open: 10, high: 12, low: 9, close: 11, sourceIndex: 0, index: 0, reason: '均线金叉', status: 'confirmed' },
    { label: '放量突破买入', side: 'buy', time: 2, price: 12, open: 10, high: 13, low: 9, close: 12, sourceIndex: 1, index: 1, reason: '量能放大', status: 'confirmed' },
    { label: 'RSI反转卖出', side: 'sell', time: 3, price: 9, open: 11, high: 12, low: 8, close: 9, sourceIndex: 2, index: 2, reason: 'RSI超买', status: 'forming' },
  ];
  window.renderChartSignalList('stock-chart-signals', signals, '无信号');
  assert.equal(window.document.querySelectorAll('#stock-chart-signals .chart-signal-item').length, 3);
  window.renderChartSignalMarkers('stock-chart-signal-markers', signals, signal => ({ x: signal.index < 2 ? 40 + signal.index * 4 : 160, y: signal.index < 2 ? 70 : 130, minX: 20, maxX: 220, minY: 20, maxY: 160 }));
  const markers = window.document.querySelectorAll('#stock-chart-signal-markers [data-chart-signal-cluster]');
  assert.equal(markers.length, 2, 'two nearby points should collapse into one selectable chart marker');
  assert.match(markers[0].getAttribute('aria-label'), /2个策略点位/);
  markers[0].click();
  const choices = window.document.querySelectorAll('#stock-chart-signal-markers [data-chart-signal-choice]');
  assert.equal(choices.length, 2, 'a cluster should expose an individual choice for every signal');
  choices[1].click();
  assert.equal(selected.at(-1).title, '买入 · 放量突破买入');
  assert.equal(window.stockChartReplayIndex, 1, 'selecting a cluster member should navigate to the exact source candle');
  assert.match(window.document.querySelector('#stock-chart-signals').textContent, /均线交叉买入/);
  dom.window.close();
});

test('crypto and stock chart signal lists include every visible point and use the shared selection handler', () => {
  const dom = new JSDOM('<div id="bn-chart-signals"></div><div id="stock-chart-signals"></div><div id="bn-chart-signal-detail"></div>', { runScripts: 'outside-only' });
  const window = dom.window;
  window.stockEscapeHtml = value => String(value ?? '').replace(/[&<>"']/g, '');
  window.formatStockKlineTime = value => String(value);
  window.formatChartTime = value => String(value);
  window.eval(signalRuntimeSource());
  const signals = Array.from({ length: 12 }, (_, index) => ({ label: `信号${index + 1}`, side: 'buy', time: index + 1, price: 10 + index, open: 10, high: 12, low: 9, close: 11, sourceIndex: index, status: 'confirmed' }));
  window.renderChartSignalList('bn-chart-signals', signals, '无信号');
  window.renderChartSignalList('stock-chart-signals', signals, '无信号');
  assert.equal(window.document.querySelectorAll('#bn-chart-signals .chart-signal-item').length, 12);
  assert.equal(window.document.querySelectorAll('#stock-chart-signals .chart-signal-item').length, 12);
  window.document.querySelector('#bn-chart-signals .chart-signal-item').click();
  assert.match(window.document.getElementById('bn-chart-signal-detail').textContent, /信号12/,'latest crypto signal should populate the same point evidence details');
  assert.match(window.document.getElementById('bn-chart-signal-detail').textContent, /触发价 21/);
  assert.match(window.document.getElementById('bn-chart-signal-detail').textContent, /OHLC 10 \/ 12 \/ 9 \/ 11/);
  dom.window.close();
});
