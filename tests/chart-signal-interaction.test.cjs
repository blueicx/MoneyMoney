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
function chartFilterContext(window) {
  window.stockChartEventInstrumentId=()=> 'stock:us:AAPL';window.currentStockKlinePeriod='5m';window.stockChartOverlayConfig={strategies:{maCross:true,volumeBreakout:true}};
  window.bnCurrentSymbol='BTCUSDT';window.bnCurrentInterval='5m';window.cryptoChartStrategyConfig={maCross:true};window.bnKlineData=[];window.redrawStockKlineSelection=()=>{};
}

test('selected stable point remains highlighted through redraw and clustering without reopening or moving the replay cursor',()=>{
 const dom=new JSDOM('<div id="bn-chart-signal-markers"></div><div id="bn-chart-signal-detail"></div>',{runScripts:'outside-only'}),w=dom.window;
 try{chartFilterContext(w);w.formatChartTime=String;w.MoneyChartAnalysis=require('../src/web/public/chart-analysis');w.eval(signalRuntimeSource());
 const point={id:'stable-one',market:'crypto',instrument:'crypto:binance:BTCUSDT',timeframe:'5m',strategy:'volumeBreakout',label:'放量突破',side:'buy',time:1,price:10,status:'confirmed'};
 const position=()=>({x:100,y:80,minX:0,maxX:300,minY:0,maxY:200});w.renderChartSignalMarkers('bn-chart-signal-markers',[point],position);w.document.querySelector('[data-chart-signal-cluster]').click();assert.equal(w.document.querySelector('[data-chart-signal-cluster]').getAttribute('aria-pressed'),'true');
 w.renderChartSignalMarkers('bn-chart-signal-markers',[{...point,price:11}],position);assert.equal(w.document.querySelector('[data-chart-signal-cluster]').getAttribute('aria-pressed'),'true');
 w.renderChartSignalMarkers('bn-chart-signal-markers',[{...point,id:'another',instrument:'crypto:binance:ETHUSDT'}],position);assert.equal(w.document.querySelector('[data-chart-signal-cluster]').getAttribute('aria-pressed'),'false');
 w.renderChartSignalMarkers('bn-chart-signal-markers',[point,{...point,id:'nearby',strategy:'maCross'}],position);assert.equal(w.document.querySelector('[data-chart-signal-cluster]').getAttribute('aria-pressed'),'true');w.document.querySelector('[data-chart-signal-cluster]').click();assert.equal(w.document.querySelectorAll('[data-chart-signal-choice]').length,2);
 }finally{w.close();}
});

test('chart strategy hit targets cluster dense points and let the user choose exact evidence', () => {
  const dom = new JSDOM('<div id="stock-chart-signal-markers" style="width:240px;height:180px"></div><div id="stock-chart-signals"></div><div id="stock-chart-evidence-status"></div><div id="stock-chart-evidence-detail"></div>', { runScripts: 'outside-only' });
  const window = dom.window;
  chartFilterContext(window);
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
  chartFilterContext(window);
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

test('lifecycle selection persists by instrument and timeframe without touching another market',()=>{
  const dom=new JSDOM('<div id="stock-chart-signals"></div>',{runScripts:'outside-only',url:'http://localhost/'}),window=dom.window;chartFilterContext(window);window.stockEscapeHtml=value=>String(value??'');window.eval(signalRuntimeSource());
  try{window.renderChartSignalList('stock-chart-signals',[],'无匹配信号');const field=window.document.querySelector('[data-signal-filter="status"]');field.value='confirmed';field.dispatchEvent(new window.Event('change',{bubbles:true}));assert.equal(window.chartSignalLifecyclePreferences('stock:us:AAPL','5m').filters.status,'confirmed');assert.equal(window.chartSignalLifecyclePreferences('crypto:binance:BTCUSDT','5m').filters.status,'');window.renderChartSignalList('stock-chart-signals',[],'无匹配信号');assert.equal(window.document.querySelector('[data-signal-filter="status"]').value,'confirmed');}finally{window.close();}
});

test('unchanged signal redraws preserve focus while clicks use the latest evidence object', () => {
  const dom = new JSDOM('<div id="bn-chart-signals"></div><div id="bn-chart-signal-detail"></div>', { runScripts:'outside-only', pretendToBeVisual:true });
  const w = dom.window;
  chartFilterContext(w);
  w.stockEscapeHtml = value => String(value ?? '');
  w.formatChartTime = value => String(value);
  let events = [{ at:1, state:'confirmed', strategy:'volumeBreakout', price:12, reason:'收线确认' }];
  w.mmChartPointTracker = { history:() => events };
  w.eval(signalRuntimeSource());
  try {
    const signal = { label:'放量突破', side:'buy', time:1, price:12, open:10, high:13, low:9, close:12, status:'confirmed' };
    w.renderChartSignalList('bn-chart-signals', [signal], '无信号');
    const button = w.document.querySelector('.chart-signal-item');
    button.focus();
    w.renderChartSignalList('bn-chart-signals', [{ ...signal, open:11 }], '无信号');
    assert.equal(w.document.querySelector('.chart-signal-item'), button, 'unchanged labels must not rebuild hit targets on every quote or pan');
    assert.equal(w.document.activeElement, button);
    assert.equal(w.document.querySelectorAll('[data-chart-signal-filters]').length, 1, 'retaining buttons must not duplicate lifecycle controls');
    for (let i = 0; i < 3; i++) w.renderChartSignalList('bn-chart-signals', [{ ...signal, open:11 }], '无信号');
    assert.equal(w.document.querySelectorAll('[data-chart-signal-filters]').length, 1);
    assert.equal(w.document.querySelectorAll('[data-chart-signal-history]').length, 1, 'redraw must replace, not accumulate, the observed lifecycle history');
    button.click();
    assert.match(w.document.getElementById('bn-chart-signal-detail').textContent, /OHLC 11 \/ 13 \/ 9 \/ 12/, 'preserved buttons must select current evidence, not stale closures');
    w.renderChartSignalList('bn-chart-signals', [{ ...signal, status:'forming' }], '无信号');
    assert.match(w.document.querySelector('.chart-signal-item').textContent, /形成中/);
    events = [];
    w.renderChartSignalList('bn-chart-signals', [{ ...signal, status:'forming' }], '无信号');
    assert.equal(w.document.querySelectorAll('[data-chart-signal-history]').length, 0, 'obsolete history must not survive a context with no observed events');
    w.renderChartSignalList('bn-chart-signals', [], '来源过期');
    assert.equal(w.document.querySelector('.chart-signal-item'), null);
    assert.match(w.document.getElementById('bn-chart-signals').textContent, /来源过期/);
    w.renderChartSignalList('bn-chart-signals', [signal], '无信号');
    w.document.querySelector('.chart-signal-item').click();
    assert.match(w.document.getElementById('bn-chart-signal-detail').textContent, /OHLC 10 \/ 13 \/ 9 \/ 12/);
    w.document.querySelector('.chart-signal-item').remove();
    w.renderChartSignalList('bn-chart-signals', [signal], '无信号');
    assert.ok(w.document.querySelector('.chart-signal-item'), 'a cleared workspace must rebuild missing targets even when its data matches');
  } finally { w.close(); }
});
