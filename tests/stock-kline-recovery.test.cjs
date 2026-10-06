const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { DataLakeCatalog } = require('../dist/storage/data-lake');

const html = fs.readFileSync('src/web/public/index.html', 'utf8');
function functionSource(name) {
  const start = html.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} exists in the real dashboard`);
  const end = html.indexOf('\n}', start) + 2;
  return html.slice(start, end);
}

function chartHarness(fetcher) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  const window = dom.window;
  const canvas = window.document.getElementById('stock-kline');
  canvas.getContext = () => ({ setTransform() {}, clearRect() {} });
  window.fetch = fetcher;
  for (const name of ['bindStockKlineSelection', 'updateStockKlineFocusControl', 'loadStockChartOverlayConfig', 'drawStockKline']) window[name] = () => {};
  for (const name of ['renderChartSignalList', 'renderChartPatternList', 'renderChartStructureList']) window[name] = (id, items, reason) => { window.document.getElementById(id).textContent = reason || ''; };
  window.renderChartPatternMarkers = id => { window.document.getElementById(id).textContent = ''; };
  window.renderMovingAverageValues = id => { window.document.getElementById(id).textContent = ''; };
  window.stockChartKlinesTime = () => '2026-10-05';
  window.formatChartTime = value => value;
  window.stockMoneyKLine = { update() {} };
  window.eval(`
    var currentStockSymbol='usAAPL', currentStockName='Apple', currentStockApiSymbol='AAPL.OQ';
    var currentStockKlinePeriod='1d', stockChartAsOf='2026-10-05T23:59:59.999Z', stockChartAsOfRevision=0;
    var stockKlineRequestRevision=0, stockKlineController=null, currentStockKlineReason='';
    var stockChartIntradayDate='', stockChartIntradaySession=null, stockChartDailyContext=null, stockChartCompanionKey='';
    var stockChartFocusIndex=null, stockChartFocusEnabled=false, stockChartRenderedStartIndex=0;
    var stockChartReplayIndex=1, stockChartKlines=[{close:1}], stockChartExchangeTimezone='America/New_York';
    var stockChartCompanionOpen=false, stockChartOverlayConfig={}, activeMarketScope='stocks';
  `);
  for (const name of ['stockKlineAsOfStorageKey', 'syncStockKlineAsOfControl', 'clearStockKlineAsOf', 'setStockKlineStatus', 'loadUnifiedStockData', 'setStockKlineViewState', 'loadStockKline']) {
    if (html.includes(`function ${name}(`)) window.eval(functionSource(name));
  }
  return { window, document: window.document, close: () => dom.window.close() };
}
const empty = { success: false, data: null, dataStatus: 'unavailable', source: 'local lake', reason: '没有在 asOf 时点之前发布的数据分区' };
const response = body => ({ ok: true, json: async () => body });

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
