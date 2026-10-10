const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'src/web/public/index.html'), 'utf8');
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
  assert.ok(document.querySelector('[data-chart-overlay="signals"]'));
  assert.ok(document.querySelector('[data-chart-overlay="patterns"]'));
  assert.ok(document.querySelector('[data-chart-overlay="boll"]'));
  assert.ok(document.querySelector('[data-chart-overlay="supportResistance"]'));
  assert.ok(document.querySelector('#stock-sr-status'));
  assert.ok(document.querySelector('[data-chart-strategy="maCross"]'));
  assert.ok(document.querySelector('[data-chart-strategy="rsiReversal"]'));
  assert.ok(document.querySelector('#stock-chart-signals'));
  assert.ok(document.querySelector('#stock-chart-pattern-list'));
  assert.ok(document.querySelector('#bn-chart-patterns'));
  assert.ok(document.querySelector('#bn-chart-pattern-list'));
  assert.ok(document.querySelector('[data-crypto-overlay="patterns"]'));
  assert.ok(document.querySelector('[data-crypto-overlay="supportResistance"]'));
  assert.ok(document.querySelector('#crypto-sr-status'));
  assert.ok(document.querySelector('#bn-chart-strategies'));
  assert.ok(document.querySelector('#bn-chart-signals'));
  assert.ok(document.querySelector('[data-chart-replay="next"]'));
});

test('crypto support/resistance rendering stays inside the crypto chart renderer', () => {
  const stockStateStart = html.indexOf('function setStockKlineViewState(');
  const stockStateEnd = html.indexOf('async function loadStockKline(', stockStateStart);
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

test('stock support/resistance is hidden outside the current live chart context', () => {
  const stockDrawStart = html.indexOf('function drawStockKline(canvas, klines)');
  const stockDrawEnd = html.indexOf('// --- DeFi Data ---', stockDrawStart);
  const stockStateStart = html.indexOf('function setStockKlineViewState(');
  const stockStateEnd = html.indexOf('async function loadStockKline(', stockStateStart);
  assert.ok(stockDrawStart >= 0 && stockDrawEnd > stockDrawStart);
  assert.ok(stockStateStart >= 0 && stockStateEnd > stockStateStart);
  const stockDraw = html.slice(stockDrawStart, stockDrawEnd);
  assert.match(stockDraw, /stockChartOverlayConfig\.supportResistance\s*&&\s*tradingActive/,
    'levels from current data must not be projected into historical, focused, or replay views');
  assert.match(stockDraw, /stockSupportResistanceState/);
  assert.match(stockDraw, /当前图表不是最新行情视图，支撑\/阻力暂隐藏/);
  assert.match(html, /function stockSupportResistanceViewAvailable\(\)[\s\S]*stockChartAsOf[\s\S]*stockChartIntradayDate[\s\S]*stockChartFocusEnabled[\s\S]*stockChartReplayIndex/,
    'date focus, time travel and replay must suppress levels computed with later bars');
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
