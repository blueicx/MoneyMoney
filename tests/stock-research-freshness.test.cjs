const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const modulePath = path.resolve('dist/features/stock-research-freshness.js');

test('stock research freshness separates source publication time from MoneyMoney retrieval time', () => {
  assert.ok(fs.existsSync(modulePath), 'stock research freshness contract should be implemented');
  const { buildStockResearchFreshnessEnvelope } = require(modulePath);
  const result = buildStockResearchFreshnessEnvelope({
    kind: 'fundamentals',
    symbol: 'SNDK',
    sourceUpdatedAt: '2026-08-01',
    retrievedAt: '2026-10-12T01:00:00.000Z',
  });

  assert.equal(result.market, 'stocks');
  assert.equal(result.instrument, 'stock:us:SNDK');
  assert.equal(result.dataStatus, 'historical');
  assert.equal(result.sourceUpdatedAt, '2026-08-01T00:00:00.000Z');
  assert.equal(result.updatedAt, '2026-08-01T00:00:00.000Z');
  assert.equal(result.retrievedAt, '2026-10-12T01:00:00.000Z');
  assert.notEqual(result.updatedAt, result.retrievedAt);
  assert.match(result.reason, /SEC|申报|历史/);
});

test('analyst and short-interest freshness uses their actual publication or settlement dates', () => {
  const { buildStockResearchFreshnessEnvelope } = require(modulePath);
  const analyst = buildStockResearchFreshnessEnvelope({
    kind: 'analyst', symbol: 'AAPL', sourceUpdatedAt: '2026-10-10', retrievedAt: '2026-10-12T01:00:00.000Z',
  });
  const shortInterest = buildStockResearchFreshnessEnvelope({
    kind: 'short-interest', symbol: 'MU', sourceUpdatedAt: '09/30/2026', retrievedAt: '2026-10-12T01:00:00.000Z',
  });

  assert.equal(analyst.dataStatus, 'delayed');
  assert.equal(analyst.sourceUpdatedAt, '2026-10-10T00:00:00.000Z');
  assert.equal(shortInterest.dataStatus, 'historical');
  assert.equal(shortInterest.sourceUpdatedAt, '2026-09-30T00:00:00.000Z');
  assert.match(shortInterest.reason, /结算|非实时/);
});

test('missing source timestamp is partial and never substituted with retrieval time', () => {
  const { buildStockResearchFreshnessEnvelope } = require(modulePath);
  const result = buildStockResearchFreshnessEnvelope({
    kind: 'fundamentals', symbol: 'AAPL', sourceUpdatedAt: null, retrievedAt: '2026-10-12T01:00:00.000Z',
  });

  assert.equal(result.dataStatus, 'partial');
  assert.equal(result.sourceUpdatedAt, null);
  assert.equal(result.updatedAt, null);
  assert.equal(result.retrievedAt, '2026-10-12T01:00:00.000Z');
  assert.match(result.reason, /未提供|未能核验/);
});

test('secondary price source does not inherit the analyst dataset timestamp', () => {
  const { buildStockResearchFreshnessEnvelope } = require(modulePath);
  const result = buildStockResearchFreshnessEnvelope({
    kind: 'analyst',
    symbol: 'AAPL',
    sourceUpdatedAt: '2026-10-10',
    retrievedAt: '2026-10-12T01:00:00.000Z',
    data: {},
    supplementalSources: [{
      field: '现价', source: 'Tencent Finance public quote', updatedAt: null,
      reason: '报价响应未返回可核验的来源时间。',
    }],
  });

  assert.deepEqual(result.supplementalSources, [{
    field: '现价', source: 'Tencent Finance public quote', updatedAt: null,
    reason: '报价响应未返回可核验的来源时间。',
  }]);
  assert.equal(result.sourceUpdatedAt, '2026-10-10T00:00:00.000Z');
});

test('stock analyst, fundamentals, and short-interest panels render the same freshness envelope', () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const server = fs.readFileSync('src/web/server.ts', 'utf8');

  assert.match(server, /buildStockResearchFreshnessEnvelope\(\{\s*kind: 'analyst'/);
  assert.match(server, /buildStockResearchFreshnessEnvelope\(\{\s*kind: 'fundamentals'/);
  assert.match(server, /buildStockResearchFreshnessEnvelope\(\{\s*kind: 'short-interest'/);
  assert.match(source, /function stockResearchFreshnessMarkup\(/);
  assert.match(source, /stockResearchFreshnessMarkup\(freshness,/);
  assert.match(source, /来源时点|数据源时点/);
  assert.match(source, /MoneyMoney 抓取|抓取时间/);
});

test('freshness UI renders independent source/retrieval times, explicit unknown times, and theme tokens', () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const start = source.indexOf('function formatStockResearchTimestamp(');
  const end = source.indexOf('function renderFundamentalQuality(', start);
  assert.ok(start >= 0 && end > start, 'freshness renderer should be present before the fundamentals card');
  const fragment = source.slice(start, end);
  const dom = new JSDOM('<!doctype html><body><div id="mount"></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.safeNewsText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  for (const theme of ['aurora', 'light', 'dark']) {
    w.document.body.dataset.theme = theme;
    const markup = w.eval(`${fragment}\nstockResearchFreshnessMarkup({dataStatus:'historical',source:'SEC EDGAR',sourceUpdatedAt:'2026-08-01T00:00:00.000Z',retrievedAt:'2026-10-12T01:00:00.000Z',reason:'Filed data'});`);
    w.document.getElementById('mount').innerHTML = markup;
    const panel = w.document.querySelector('[data-stock-research-freshness="historical"]');
    assert.ok(panel, `${theme} should render the historical state`);
    assert.match(panel.textContent, /来源时点：/);
    assert.match(panel.textContent, /MoneyMoney 抓取：/);
    assert.match(panel.getAttribute('style'), /var\(--bg-secondary\)/);
    assert.match(panel.textContent, /2026/);
  }

  const missing = w.eval(`${fragment}\nstockResearchFreshnessMarkup({dataStatus:'partial',source:'SEC EDGAR',sourceUpdatedAt:null,retrievedAt:'2026-10-12T01:00:00.000Z',reason:'来源未提供时点'});`);
  w.document.getElementById('mount').innerHTML = missing;
  assert.equal(w.document.querySelector('[data-stock-research-freshness="partial"] [data-status-state="partial"]').textContent, '部分成功');
  assert.match(w.document.querySelector('[data-stock-research-freshness="partial"]').textContent, /来源时点：来源未提供/);

  const separateQuote = w.eval(`${fragment}\nstockResearchFreshnessMarkup({dataStatus:'delayed',source:'StockAnalysis',sourceUpdatedAt:'2026-10-10T00:00:00.000Z',retrievedAt:'2026-10-12T01:00:00.000Z',supplementalSources:[{field:'现价',source:'Tencent Finance',updatedAt:null,reason:'源时间未知'}]});`);
  w.document.getElementById('mount').innerHTML = separateQuote;
  const quotePanel = w.document.querySelector('[data-stock-research-freshness="delayed"]');
  assert.match(quotePanel.textContent, /现价来源：Tencent Finance · 来源时点：来源未提供/);
  dom.window.close();
});
