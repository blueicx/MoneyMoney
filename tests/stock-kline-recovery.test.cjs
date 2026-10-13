const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { DataLakeCatalog } = require('../dist/storage/data-lake');

const html = require('./helpers/dashboard-source.cjs').readDashboardSource();
function functionSource(name) {
  const start = html.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} exists in the real dashboard`);
  const end = html.indexOf('\n}', start) + 2;
  return html.slice(start, end);
}

function chartHarness(fetcher, url = 'http://localhost/') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const window = dom.window;
  const canvas = window.document.getElementById('stock-kline');
  canvas.getContext = () => ({ setTransform() {}, clearRect() {} });
  window.fetch = fetcher;
  window.loadStockChartEventRail = () => {};
  for (const name of ['bindStockKlineSelection', 'updateStockKlineFocusControl', 'loadStockChartOverlayConfig', 'drawStockKline']) window[name] = () => {};
  for (const name of ['renderChartSignalList', 'renderChartPatternList', 'renderChartStructureList']) window[name] = (id, items, reason) => { window.document.getElementById(id).textContent = reason || ''; };
  window.renderChartSignalMarkers = id => { window.document.getElementById(id).replaceChildren(); };
  window.renderChartPatternMarkers = id => { window.document.getElementById(id).textContent = ''; };
  window.renderMovingAverageValues = id => { window.document.getElementById(id).textContent = ''; };
  window.stockChartKlinesTime = () => '2026-10-05';
  window.formatChartTime = value => value;
  window.stockMoneyKLine = { update() {} };
  window.eval(`
    var currentStockSymbol='usAAPL', currentStockName='Apple', currentStockApiSymbol='AAPL.OQ';
    var currentStockKlinePeriod='1d', stockChartAsOf='2026-10-05T23:59:59.999Z', stockChartAsOfRevision=0;
    var stockKlineRequestRevision=0, stockKlineContextRevision=0, stockKlineController=null, currentStockKlineReason='', stockKlineInFlightRequests=new Map();
    var stockSupportResistanceState={ key:null, status:'idle', data:null, controller:null, retryAt:0, loadedAt:0 };
    var stockChartIntradayDate='', stockChartIntradayPeriod='5m', stockChartIntradaySession=null, stockChartDailyContext=null, stockChartCompanionKey='';
    var stockChartFocusIndex=null, stockChartFocusEnabled=false, stockChartRenderedStartIndex=0;
    var stockChartReplayIndex=1, stockChartKlines=[{close:1}], stockChartExchangeTimezone='America/New_York';
    var stockChartCompanionOpen=false, stockChartOverlayConfig={}, activeMarketScope='stocks', stockChartAdjustment='source';
  `);
  if (html.includes('function markMmPerformanceStage(')) window.eval(functionSource('markMmPerformanceStage'));
  for (const name of ['stockKlineAsOfStorageKey', 'syncStockKlineAsOfControl', 'clearStockKlineAsOf', 'setStockKlineStatus', 'loadUnifiedStockData', 'setStockKlineViewState', 'stockKlineRequestKey', 'stockKlineUrl', 'bindStockKlineWorkspaceLifecycle', 'runStockKlineSingleFlight', 'performStockKlineLoad', 'loadStockKline']) {
    if (html.includes(`function ${name}(`)) window.eval(functionSource(name));
  }
  window.bindStockKlineWorkspaceLifecycle?.();
  return { window, document: window.document, close: () => dom.window.close() };
}
const empty = { success: false, data: null, dataStatus: 'unavailable', source: 'local lake', reason: '没有在 asOf 时点之前发布的数据分区' };
const response = body => ({ ok: true, json: async () => body });

test('stock chart request, response, and visible render stages are measured in order', async () => {
  assert.ok(html.includes('function markMmPerformanceStage('), 'dashboard should expose a gated performance stage helper');
  const h = chartHarness(async () => response({ success: true, data: [{ time: 1, open: 10, high: 12, low: 9, close: 11, volume: 1 }], dataStatus: 'live', source: 'fixture' }));
  const marks = [];
  try {
    h.window.__MM_PERFORMANCE_TRACE__ = true;
    Object.defineProperty(h.window.performance, 'mark', { configurable: true, value: name => marks.push(name) });
    await h.window.loadStockKline();
    const request = marks.indexOf('moneymoney:stock-kline-request-start');
    const responseParsed = marks.indexOf('moneymoney:stock-kline-response-parsed');
    const rendered = marks.indexOf('moneymoney:stock-kline-first-render');
    assert.ok(request >= 0 && responseParsed > request && rendered > responseParsed, `unexpected chart stages: ${marks.join(', ')}`);
  } finally { h.close(); }
});

test('stock K-line URL builder keeps live, historical, intraday and adjusted contexts distinct', () => {
  const h = chartHarness(async () => response(empty));
  try {
    const ordinary = h.window.stockKlineUrl('usAAPL', '1d', '', { adjustment: 'source' });
    assert.equal(ordinary, '/api/stock/kline?symbol=usAAPL&period=1d&interval=1d&adjustment=source&chartWindow=1');
    const historical = new URL(h.window.stockKlineUrl('usAAPL', '1d', '', {
      asOf: '2026-10-05T23:59:59.999Z', adjustment: 'forward',
    }), 'http://localhost');
    assert.equal(historical.searchParams.get('adjustment'), 'source');
    assert.equal(historical.searchParams.get('asOf'), '2026-10-05T23:59:59.999Z');
    assert.equal(historical.searchParams.has('chartWindow'), false);
    const intraday = new URL(h.window.stockKlineUrl('usAAPL', '5m', 'AAPL.OQ', {
      intradayDate: '2026-10-05', intradayPeriod: '5m', adjustment: 'forward',
    }), 'http://localhost');
    assert.equal(intraday.searchParams.get('adjustment'), 'source');
    assert.equal(intraday.searchParams.get('date'), '2026-10-05');
    assert.equal(intraday.searchParams.get('intradayPeriod'), '5m');
    assert.equal(intraday.searchParams.get('api'), 'AAPL.OQ');
    assert.equal(intraday.searchParams.has('chartWindow'), false);
    const adjusted = new URL(h.window.stockKlineUrl('usAAPL', '1d', '', { adjustment: 'forward' }), 'http://localhost');
    assert.equal(adjusted.searchParams.get('adjustment'), 'forward');
    assert.equal(adjusted.searchParams.has('chartWindow'), false);
  } finally { h.close(); }
});

test('stock chart consumes one matching prefetched response instead of issuing a duplicate request', async () => {
  let fetchCalls = 0;
  let takeCalls = 0;
  let takenUrl = '';
  const h = chartHarness(async () => { fetchCalls++; return response(empty); });
  try {
    h.window.stockChartAsOf = '';
    h.window.currentStockSymbol = 'usAAPL';
    h.window.currentStockKlinePeriod = '1d';
    h.window.stockChartAdjustment = 'source';
    h.window.MoneyStockKlinePrefetch = {
      take(url) {
        takeCalls++;
        takenUrl = url;
        return {
          promise: Promise.resolve({ ok: true, status: 200, body: {
            success: true, market: 'stocks', instrument: 'usAAPL', timeframe: '1d',
            data: [{ time: 1, open: 10, high: 12, low: 9, close: 11, volume: 1 }],
            dataStatus: 'live', source: 'prefetch fixture', updatedAt: '2026-10-11T00:00:00Z',
          } }),
          abort() {},
        };
      },
      invalidate() {},
    };
    await h.window.loadStockKline();
    assert.equal(fetchCalls, 0);
    assert.equal(takeCalls, 1);
    assert.equal(new URL(takenUrl, 'http://localhost').searchParams.get('symbol'), 'usAAPL');
    assert.equal(new URL(takenUrl, 'http://localhost').searchParams.get('period'), '1d');
    assert.equal(h.window.stockChartKlines[0].close, 11);
    assert.match(h.document.querySelector('[data-kline-status]').textContent, /prefetch fixture/);
  } finally { h.close(); }
});

test('stock chart does not consume a prefetched payload for another instrument', async () => {
  const fetchedUrls = [];
  let takeCalls = 0;
  const h = chartHarness(async url => {
    fetchedUrls.push(url);
    return response({ success: true, market: 'stocks', instrument: 'usSNDK', timeframe: '1d',
      data: [{ time: 2, open: 20, high: 22, low: 19, close: 21, volume: 2 }], dataStatus: 'live', source: 'SNDK fixture' });
  });
  try {
    h.window.stockChartAsOf = '';
    h.window.currentStockSymbol = 'usSNDK';
    h.window.currentStockKlinePeriod = '1d';
    h.window.stockChartAdjustment = 'source';
    h.window.MoneyStockKlinePrefetch = { take() { takeCalls++; return null; }, invalidate() {} };
    await h.window.loadStockKline();
    assert.equal(takeCalls, 1);
    assert.equal(new URL(fetchedUrls[0], 'http://localhost').searchParams.get('symbol'), 'usSNDK');
    assert.equal(h.window.stockChartKlines[0].close, 21);
  } finally { h.close(); }
});

test('stock chart rejects a successful prefetched response with mismatched identity', async () => {
  let ordinaryFetchCalls = 0;
  const h = chartHarness(async () => { ordinaryFetchCalls++; return response(empty); });
  try {
    h.window.stockChartAsOf = '';
    h.window.currentStockSymbol = 'usAAPL';
    h.window.currentStockKlinePeriod = '1d';
    h.window.stockChartAdjustment = 'source';
    h.window.MoneyStockKlinePrefetch = {
      take() {
        return { promise: Promise.resolve({ ok: true, status: 200, body: {
          success: true, market: 'stocks', instrument: 'usSNDK', timeframe: '1d',
          data: [{ time: 1, open: 10, high: 12, low: 9, close: 11, volume: 1 }],
        } }), abort() {} };
      },
      invalidate() {},
    };
    await h.window.loadStockKline();
    assert.equal(ordinaryFetchCalls, 0, 'a bad prefetched identity must fail closed, not cause an immediate second request');
    assert.equal(h.window.stockChartKlines.length, 0);
    assert.equal(h.document.getElementById('stock-chart-card').dataset.klineState, 'failed');
    assert.match(h.document.querySelector('[data-kline-status]').textContent, /标的或周期不匹配/);
  } finally { h.close(); }
});

test('stock chart preserves structured empty reasons from prefetched HTTP errors without retrying', async () => {
  let ordinaryFetchCalls = 0;
  const h = chartHarness(async () => { ordinaryFetchCalls++; return response(empty); });
  try {
    h.window.stockChartAsOf = '';
    h.window.currentStockSymbol = 'usAAPL';
    h.window.currentStockKlinePeriod = '1d';
    h.window.stockChartAdjustment = 'source';
    h.window.MoneyStockKlinePrefetch = {
      take() { return { promise: Promise.resolve({ ok: false, status: 422, body: {
        success: false, data: null, dataStatus: 'empty', reason: '该时点之前没有已发布分区',
      } }), abort() {} }; },
      invalidate() {},
    };
    await h.window.loadStockKline();
    assert.equal(ordinaryFetchCalls, 0);
    assert.equal(h.document.getElementById('stock-chart-card').dataset.klineState, 'empty');
    assert.equal(h.document.querySelector('[data-kline-status]').textContent, '该时点之前没有已发布分区');
  } finally { h.close(); }
});

test('stock chart aborts a consumed prefetch when leaving the stock quotes workspace', async () => {
  let resolvePrefetch;
  let abortCalls = 0;
  const h = chartHarness(async () => response(empty));
  try {
    h.window.stockChartAsOf = '';
    h.window.currentStockSymbol = 'usAAPL';
    h.window.currentStockKlinePeriod = '1d';
    h.window.stockChartAdjustment = 'source';
    h.window.MoneyStockKlinePrefetch = {
      take() {
        return {
          promise: new Promise(resolve => { resolvePrefetch = resolve; }),
          abort() { abortCalls++; resolvePrefetch({ ok: false, status: 0, body: null, error: new Error('aborted') }); },
        };
      },
      invalidate() {},
    };
    const loading = h.window.loadStockKline();
    await new Promise(resolve => setImmediate(resolve));
    h.window.dispatchEvent(new h.window.CustomEvent('mm-workspace-context', {
      detail: { market: 'stocks', workspace: 'events', instrument: 'stock:us:AAPL' },
    }));
    await loading;
    assert.equal(abortCalls, 1);
    assert.equal(h.window.stockChartKlines.length, 0, 'aborted chart data must not be rendered');
  } finally { h.close(); }
});

test('stock chart restores only supported timeframe values from its deep link', () => {
  for (const [timeframe, expected] of [['1d', '1d'], ['5m', '5m'], ['invalid', '5m']]) {
    const h = chartHarness(async () => response(empty), `http://localhost/?market=stocks&workspace=stock-quotes&instrument=stock%3Aus%3AAAPL&timeframe=${timeframe}`);
    try {
      h.window.currentStockKlinePeriod = '5m';
      h.window.workspaceNavigationState = new Map([['stocks', { groups: [{ items: [{ id: 'stock-quotes' }] }] }]]);
      h.window.workspaceFallbackNavigation = () => [];
      h.window.defaultWorkspaceForMarketScope = () => 'stock-quotes';
      h.window.stockInstrumentId = symbol => `stock:us:${symbol}`;
      h.window.workspaceContext = { scope: 'overview', workspace: 'overview', instrument: null };
      h.window.eval(functionSource('restoreWorkspaceContextFromUrl'));
      h.window.restoreWorkspaceContextFromUrl();
      assert.equal(h.window.currentStockKlinePeriod, expected);
    } finally { h.close(); }
  }
});

test('changing stock clears an unsaved cutoff and the previous provider code', async () => {
  let url;
  const h = chartHarness(async value => { url = value; return response(empty); });
  try {
    await h.window.loadStockKline('usSNDK', 'SanDisk');
    assert.equal(h.window.stockChartAsOf, '');
    assert.equal(h.window.currentStockApiSymbol, '');
    assert.equal(new URL(url, 'http://localhost/').searchParams.has('asOf'), false);
    assert.equal(new URL(url, 'http://localhost/').searchParams.has('api'), false);
  } finally { h.close(); }
});

test('a stock restores its own cutoff and clearing it returns to ordinary candles', async () => {
  const urls = [];
  const h = chartHarness(async url => { urls.push(url); return response(empty); });
  try {
    h.window.localStorage.setItem('moneymoney:kline-as-of:usSNDK', '2026-09-28T23:59:59.999Z');
    await h.window.loadStockKline('usSNDK', 'SanDisk');
    assert.equal(h.window.stockChartAsOf, '2026-09-28T23:59:59.999Z');
    h.window.clearStockKlineAsOf();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(new URL(urls.at(-1), 'http://localhost/').searchParams.has('asOf'), false);
  } finally { h.close(); }
});

test('ordinary source chart opts into the bounded bootstrap while asOf and selected intraday requests do not', async () => {
  const urls=[];
  const h=chartHarness(async url=>{urls.push(url);return response({success:true,data:[{time:1,open:10,high:12,low:9,close:11,volume:1}],dataStatus:'live',source:'fixture'});});
  try {
    h.window.stockChartAsOf='';h.window.stockChartIntradayDate='';h.window.stockChartAdjustment='source';
    await h.window.loadStockKline();
    assert.equal(new URL(urls.at(-1),'http://localhost/').searchParams.get('chartWindow'),'1');
    h.window.stockChartAsOf='2026-10-05T23:59:59.999Z';
    await h.window.loadStockKline();
    assert.equal(new URL(urls.at(-1),'http://localhost/').searchParams.has('chartWindow'),false);
    h.window.stockChartAsOf='';h.window.stockChartIntradayDate='2026-10-05';
    await h.window.loadStockKline();
    assert.equal(new URL(urls.at(-1),'http://localhost/').searchParams.has('chartWindow'),false);
    h.window.stockChartIntradayDate='';h.window.stockChartAdjustment='forward';
    await h.window.loadStockKline();
    assert.equal(new URL(urls.at(-1),'http://localhost/').searchParams.has('chartWindow'),false);
    h.window.stockChartAdjustment='source';h.window.currentStockKlinePeriod='3d';
    await h.window.loadStockKline();
    assert.equal(new URL(urls.at(-1),'http://localhost/').searchParams.has('chartWindow'),false);
  } finally { h.close(); }
});

test('missing snapshot has a compact actionable empty state, not a no-signal result', async () => {
  const h = chartHarness(async () => response(empty));
  try {
    await h.window.loadStockKline();
    const canvas = h.document.getElementById('stock-kline');
    assert.equal(canvas.hidden || canvas.style.display === 'none', true);
    assert.doesNotMatch(h.document.getElementById('stock-chart-signals').textContent, /未触发/);
    assert.match(h.document.getElementById('stock-chart-empty')?.textContent || '', /数据分区/);
    assert.ok(h.document.querySelector('#stock-chart-empty [data-kline-retry]'));
    assert.ok(h.document.querySelector('#stock-chart-empty [data-kline-exit-asof]'));
    assert.equal([...h.document.querySelectorAll('[data-chart-replay]')].every(button => button.disabled), true);
    assert.equal(h.window.stockChartKlines.length, 0);
  } finally { h.close(); }
});

test('late failure of an old request cannot replace a successful new stock chart', async () => {
  let rejectOld;
  let calls = 0;
  const h = chartHarness(() => ++calls === 1 ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve(response({ success: true, data: [{ time: 1, open: 10, high: 12, low: 9, close: 11, volume: 1 }], dataStatus: 'live', source: 'fixture provider' })));
  try {
    const old = h.window.loadStockKline();
    await h.window.loadStockKline('usSNDK', 'SanDisk');
    const status = h.document.querySelector('[data-kline-status]').textContent;
    rejectOld(new Error('old provider failed'));
    await old;
    assert.equal(h.document.querySelector('[data-kline-status]').textContent, status);
    assert.equal(h.window.stockChartKlines[0].close, 11);
  } finally { h.close(); }
});

test('known stock chart aliases read the same published partition hash without future revisions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-kline-identity-'));
  const catalog = new DataLakeCatalog({ lakeRoot: path.join(root, 'lake'), databasePath: path.join(root, 'catalog.sqlite') });
  try {
    catalog.registerInstrument({ type: 'stock', venue: 'us', symbol: 'AAPL', aliases: ['usAAPL', 'AAPL.OQ'] });
    const rows = [{ timestamp: '2026-09-01T00:00:00Z', open: 100, high: 105, low: 99, close: 104, volume: 1 }];
    await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'fixture', publishedAt: '2026-09-02T00:00:00Z', rows });
    await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'fixture', publishedAt: '2026-10-07T00:00:00Z', rows: rows.map(row => ({ ...row, close: 105 })) });
    const cutoff = '2026-10-05T23:59:59.999Z';
    const canonical = await catalog.queryBarsAsOf({ market: 'stocks', instrument: 'AAPL', timeframe: '1d', asOf: cutoff });
    for (const instrument of ['usAAPL', 'AAPL.OQ', 'stock:us:AAPL']) {
      const result = await catalog.queryBarsAsOf({ market: 'stocks', instrument, timeframe: '1d', asOf: cutoff });
      assert.equal(result.rows.length, 1, `${instrument} resolves to the saved AAPL identity`);
      assert.equal(result.rows[0].close, 104);
      assert.equal(result.snapshot.contentHash, canonical.snapshot.contentHash);
      assert.equal(result.snapshot.instrument, 'AAPL');
    }
    await assert.rejects(() => catalog.queryBarsAsOf({ market: 'stocks', instrument: 'crypto:binance:BTCUSDT', timeframe: '1d', asOf: cutoff }), /instrument|market/i);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
