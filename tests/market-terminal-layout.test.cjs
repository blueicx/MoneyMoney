const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = require('./helpers/dashboard-source.cjs').readDashboardSource();
const server = fs.readFileSync(path.join(__dirname, '..', 'src/web/server.ts'), 'utf8');
const dom = new JSDOM(html, { 
  runScripts: "dangerously", 
  url: "http://localhost",
  beforeParse(window) {
    window.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
    window.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});
const window = dom.window;
window.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
window.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const document = window.document;

test('market breadth renders without an option-chain workspace', async () => {
  const previousFetch = window.fetch;
  window.fetch = async url => {
    assert.equal(url, '/api/stock/market-breadth');
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          generatedAt: '2026-10-28T16:00:00.000Z',
          source: 'Nasdaq Public Screener',
          advancersPct: 56.1,
          declinersPct: 36.8,
          advanceDeclineRatio: 1.52,
          medianChangePct: 0.21,
          strongAdvancersPct: 8.2,
          strongDeclinersPct: 3.1,
          totalVolume: 123456789,
          totalCount: 7010,
          capGroups: [],
          leadingSectors: [],
          laggingSectors: [],
          gainers: [],
          losers: [],
          signal: 'constructive',
          signalZh: '广度温和转强',
          adviceZh: '测试快照',
          regimeBoost: 0.5,
          confidence: 80,
        },
      }),
    };
  };
  try {
    await window.loadMarketBreadth();
    const radar = document.querySelector('#market-breadth-radar');
    assert.match(radar.textContent, /上涨占比/);
    assert.doesNotMatch(radar.textContent, /暂时不可用/);
  } finally {
    window.fetch = previousFetch;
  }
});

test('market terminal has distinct left features, center workspace and right instrument library', () => {
  assert.ok(document.querySelector('#market-workspace-shell'));
  assert.ok(document.querySelector('#market-workspace-sidebar[data-region="market-features"]'));
  assert.ok(document.querySelector('#center-workspace'));
  assert.ok(document.querySelector('#right-instrument-library[data-region="instrument-library"]'));
  assert.equal(document.querySelector('#left-market-features'), null);
});

test('stock chart exposes user-selectable analysis overlays and replay controls', () => {
  assert.ok(document.querySelector('script[src="/chart-analysis.js"]'));
  assert.ok(document.querySelector('#stock-chart-overlays'));
  for (const layer of ['signals', 'patterns', 'structures', 'ma', 'boll', 'supportResistance', 'volume']) {
    assert.equal(document.querySelector(`[data-chart-overlay="${layer}"]`).checked, true, `${layer} should default on`);
  }
  assert.ok(document.querySelector('#stock-sr-status'));
  assert.ok(document.querySelector('[data-chart-strategy="maCross"]'));
  assert.ok(document.querySelector('[data-chart-strategy="rsiReversal"]'));
  assert.ok(document.querySelector('#stock-chart-signals'));
  assert.ok(document.querySelector('#stock-chart-pattern-list'));
  assert.ok(document.querySelector('#bn-chart-patterns'));
  assert.ok(document.querySelector('#bn-chart-pattern-list'));
  assert.equal(document.querySelector('[data-crypto-overlay="patterns"]').checked, true);
  assert.equal(document.querySelector('[data-crypto-overlay="supportResistance"]').checked, true);
  assert.ok(document.querySelector('#crypto-sr-status'));
  assert.ok(document.querySelector('#bn-chart-strategies'));
  assert.ok(document.querySelector('#bn-chart-signals'));
  assert.ok(document.querySelector('[data-chart-replay="next"]'));
});

test('crypto support/resistance rendering stays inside the crypto chart renderer', () => {
  const stockStateStart = html.indexOf('function setStockKlineViewState(');
  const stockStateEnd = html.indexOf('async function performStockKlineLoad(', stockStateStart);
  const cryptoDrawStart = html.indexOf('function drawCandles(canvas, klines)');
  const cryptoDrawEnd = html.indexOf('\nlet bnKlineController', cryptoDrawStart);
  assert.ok(stockStateStart >= 0 && stockStateEnd > stockStateStart);
  assert.ok(cryptoDrawStart >= 0 && cryptoDrawEnd > cryptoDrawStart);
  assert.doesNotMatch(html.slice(stockStateStart, stockStateEnd), /cryptoSupportResistanceState|drawSupportResistance/,
    'stock status changes must not access crypto overlay state or renderer-local canvas variables');
  assert.match(html.slice(cryptoDrawStart, cryptoDrawEnd), /drawSupportResistance\(ctx,\s*lines,\s*geometry\)/,
    'provider levels must be drawn by the crypto chart with its own price geometry');
  assert.doesNotMatch(html.slice(cryptoDrawStart, cryptoDrawEnd), /Support\/Resistance auto-detection/,
    'crypto levels must use the selected Binance-backed source layer, not an implicit second renderer');
  const endpointStart = server.indexOf("app.get('/api/support-resistance'");
  const endpointEnd = server.indexOf("app.get('/api/confluence'", endpointStart);
  const endpoint = server.slice(endpointStart, endpointEnd);
  assert.match(endpoint, /market === 'stocks'[\s\S]*?analyzeSupportResistance\(instrument, interval, bars\)/);
  assert.match(endpoint, /market !== 'crypto'[\s\S]*?不会跨市场回退/);
});

test('stock and crypto Pivot overlays derive from chart-scoped bars in history and replay without an extra source request', () => {
  const stockDrawStart = html.indexOf('function drawStockKline(canvas, klines)');
  const stockDrawEnd = html.indexOf('// --- DeFi Data ---', stockDrawStart);
  const stockStateStart = html.indexOf('function setStockKlineViewState(');
  const stockStateEnd = html.indexOf('async function performStockKlineLoad(', stockStateStart);
  const cryptoDrawStart = html.indexOf('function drawCandles(canvas, klines)');
  const cryptoDrawEnd = html.indexOf('\nlet bnKlineController', cryptoDrawStart);
  assert.ok(stockDrawStart >= 0 && stockDrawEnd > stockDrawStart);
  assert.ok(stockStateStart >= 0 && stockStateEnd > stockStateStart);
  assert.ok(cryptoDrawStart >= 0 && cryptoDrawEnd > cryptoDrawStart);
  const stockDraw = html.slice(stockDrawStart, stockDrawEnd);
  assert.match(stockDraw, /updateStockPivotStatus\(replayKlines\)/,
    'asOf and replay must calculate levels only from the already bounded chart history');
  assert.match(stockDraw, /stockChartOverlayConfig\.supportResistance\s*&&\s*pivotData/);
  assert.match(html, /function updateStockPivotStatus\(bars\)[\s\S]*?pivotLevels\(bars,\s*\{\s*lookback:\s*3\s*\}\)/);
  assert.match(html.slice(cryptoDrawStart, cryptoDrawEnd), /pivotLevels\(tradingFull,\s*\{\s*lookback:\s*3\s*\}\)/,
    'crypto levels must share the selected market feed and remain stable when the visible viewport is zoomed');
  assert.match(html, /id="crypto-sr-status" aria-live="polite"/);
  assert.match(html, /function pivotLevelSummary\(result\)[\s\S]*?支撑 \$\{supports\.join\('、'\) \|\| '暂无'\} \/ 阻力 \$\{resistances\.join\('、'\) \|\| '暂无'\}/,
    'the explanation must list the exact levels rendered by the shared Pivot result');
  assert.doesNotMatch(stockDraw + html.slice(cryptoDrawStart, cryptoDrawEnd), /fetch\('\/api\/support-resistance\?/,
    'chart overlays must not fetch a second, potentially future-leaking history source');
  assert.doesNotMatch(html.slice(stockStateStart, stockStateEnd), /cryptoSupportResistanceState|\bW, H, padL, padR, padT\b/);
});

test('right library has market-specific entry point instead of generic event fallback', () => {
  const library = document.querySelector('#market-instrument-library');
  assert.ok(library);
  assert.equal(library.parentElement?.id, 'sidebar-content');
  assert.ok(document.querySelector('#stock-instrument-library[data-market-library="stocks"]'));
  assert.ok(library.querySelector('[data-market-library="options"]'));
  assert.ok(library.querySelector('[data-market-library="crypto"]'));
  assert.ok(library.querySelector('[data-market-library="prediction"]'));
});

test('scoped library quick data and rendering exists for each market and ensures isolation', () => {
  // Test stocks quick data
  window.eval("activeMarketScope = 'stocks'; applySidebarScope();");
  const stockContainer = document.getElementById('stock-library-quick');
  assert.match(stockContainer.innerHTML, /AAPL/, 'Stocks keeps standard list');
  
  // Test crypto quick data
  window.eval("activeMarketScope = 'crypto'; applySidebarScope();");
  const cryptoContainer = document.getElementById('crypto-library-quick');
  assert.match(cryptoContainer.innerHTML, /BTCUSDT/, 'Crypto includes BTC');
  assert.match(cryptoContainer.innerHTML, /ETHUSDT/, 'Crypto includes ETH');

  // Verify market-specific entries and truthful loading state
  window.eval("activeMarketScope = 'options'; applySidebarScope();");
  const optionsContainer = document.getElementById('options-library-quick');
  assert.match(optionsContainer.textContent, /SPY/);
  assert.match(optionsContainer.textContent, /非合约报价/);

  window.eval("activeMarketScope = 'prediction'; applySidebarScope();");
  const predictionContainer = document.getElementById('prediction-library-quick');
  assert.match(predictionContainer.textContent, /正在读取真实预测事件|来源不可用|暂无可用预测事件/);

  // Validate no cross-market overlap
  assert.doesNotMatch(cryptoContainer.innerHTML, /AAPL/);
  assert.doesNotMatch(optionsContainer.innerHTML, /BTCUSDT/);
});

test('clicking crypto library asset syncs URL, center title, and current card while keeping crypto scope', () => {
  window.eval("setInterval = () => {}; setTimeout = (cb) => { cb(); return 1; }; loadBinanceDashboard = () => {}; setMarketScope('crypto');");
  const ethBtn = document.querySelector('#crypto-library-quick button:nth-child(2)'); // Should be ETHUSDT
  
  if (ethBtn) {
    ethBtn.click();
    
    // Check URL update (instrument=ETHUSDT)
    const url = new URL(window.location.href);
    assert.equal(url.searchParams.get('instrument'), 'ETHUSDT');
    
    // Check center title
    const bnSymbolSelect = document.getElementById('bn-symbol');
    if (bnSymbolSelect) assert.equal(bnSymbolSelect.value, 'ETHUSDT');
    
    // Check current card update
    const currentContainer = document.getElementById('crypto-library-current-symbol');
    if (currentContainer) assert.equal(currentContainer.textContent, 'ETHUSDT');
    
    // Check active class on button
    assert.ok(ethBtn.classList.contains('active'));
    
    // Check scope remains crypto
    assert.equal(window.eval('activeMarketScope'), 'crypto');
  }

  // Cross scope test: go to options, URL instrument should NOT be ETHUSDT
  window.eval("setMarketScope('options');");
  const urlAfter = new URL(window.location.href);
  assert.notEqual(urlAfter.searchParams.get('instrument'), 'ETHUSDT');
  
  // Go to stocks, URL instrument should NOT be ETHUSDT
  window.eval("setMarketScope('stocks');");
  const urlStocks = new URL(window.location.href);
  assert.notEqual(urlStocks.searchParams.get('instrument'), 'ETHUSDT');
});

test('workspace visibility overrides inline display styles', () => {
  assert.match(html, /\.workspace-hidden[^}]*display:\s*none\s*!important/);
  assert.match(html, /classList\.toggle\(['"]workspace-hidden['"],\s*!visible\)/);
});

test.after(() => dom.window.close());
