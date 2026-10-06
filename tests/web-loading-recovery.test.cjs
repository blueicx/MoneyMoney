const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('src/web/public/index.html', 'utf8');
function sourceFunction(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

test('selecting a stock in its active workspace does not load unrelated research sources', () => {
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  const loads = [];
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.eval("var activeMarketScope='stocks',activeWorkspaceId='stock-quotes';");
  w.stockInstrumentId = value => `stock:us:${value}`;
  w.stockNameForSymbol = value => value;
  for (const name of ['setWorkspaceInstrument', 'setStockSelectorActive', 'updateStockLibraryCurrent']) w[name] = () => {};
  w.loadActiveWorkspaceInstrument = () => { loads.push('stock-quotes'); return true; };
  for (const name of ['loadUnifiedStockData', 'loadStockKline', 'loadInsiderRadar', 'loadFundamentalQuality', 'loadShortInterest', 'loadInstitutionalOwnership', 'loadAnalystConsensus']) w[name] = () => loads.push(name);
  w.eval(sourceFunction('selectStockSymbol'));
  try { w.selectStockSymbol('SNDK', 'SanDisk'); assert.deepEqual(loads, ['stock-quotes']); } finally { dom.window.close(); }
});

test('stock workspace bootstrap avoids command, macro, event and research fetches', async () => {
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  const loads = [];
  w.eval("var activeMarketScope='stocks',activeWorkspaceId='stock-quotes',currentInstrumentId='AAPL';");
  w.readInitialMarketScope = () => 'stocks';
  w.waitForDashboardAuthState = async () => ({ authenticated: true });
  w.restoreSharedWorkspaceFromUrl = async () => {};
  for (const name of ['initTheme', 'restoreWorkspaceContextFromUrl', 'renderNavigationState', 'initializeDashboardCollapses', 'restoreLastDashboardTab', 'renderChartPatternControls']) w[name] = () => {};
  for (const name of ['loadActiveWorkspaceInstrument', 'loadAll', 'loadCommandCenter', 'loadNewsTicker', 'loadMarketTimeline', 'loadMarketOverview', 'loadResearchBriefing']) w[name] = () => loads.push(name);
  w.eval(sourceFunction('startDashboard'));
  try {
    await w.startDashboard();
    for (const name of ['loadAll', 'loadCommandCenter', 'loadMarketTimeline', 'loadMarketOverview', 'loadResearchBriefing']) assert.equal(loads.includes(name), false, `${name} is not part of stock chart startup`);
  } finally { dom.window.close(); }
});

test('chart coverage comes from its current request, not unrelated ordinary-market endpoints', async () => {
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval("var activeMarketScope='stocks',currentStockKlinePeriod='1d',stockChartAsOf='2026-10-05';");
  w.stockEscapeHtml = value => String(value);
  let fetched = false;
  w.fetch = async () => { fetched = true; return { json: async () => ({ success: false }) }; };
  w.eval(sourceFunction('loadUnifiedStockData'));
  try {
    await w.loadUnifiedStockData('AAPL');
    assert.equal(fetched, false);
    assert.match(w.document.querySelector('[data-stock-coverage]').textContent, /历史时点/);
    await w.loadUnifiedStockData('AAPL', { data: [], dataStatus: 'empty', reason: '时点无分区', source: 'local-data-lake' });
    assert.match(w.document.querySelector('[data-stock-coverage]').textContent, /时点无分区/);
    assert.doesNotMatch(w.document.querySelector('[data-stock-coverage]').textContent, /K线：有数据/);
  } finally { w.close(); }
});

test('hidden dashboard does not fetch private changes or market aggregates', () => {
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval("var activeWorkspaceId='guru-holdings';");
  w.fetch = () => { throw new Error('hidden workspace fetch'); };
  w.loadMarketChangeDigest = () => { throw new Error('hidden digest'); };
  w.eval(sourceFunction('loadWorkspaceDashboardCards'));
  try { w.loadWorkspaceDashboardCards(); } finally { w.close(); }
});

test('production dashboard contains no large inline script and has verifiable compressed hashed resources', () => {
  const root = 'dist/web/public';
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => Buffer.byteLength(match[1]));
  assert.ok(Math.max(...inline) < 16000, 'large scripts must be independently cached, not downloaded inside every dashboard navigation');
  const resources = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map(match => match[1]);
  assert.ok(resources.length >= 4, 'hashed script and stylesheet references are emitted');
  for (const reference of resources) {
    const file = path.join(root, reference);
    const content = fs.readFileSync(file);
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    assert.ok(reference.includes(hash), `${reference} matches its content hash`);
    assert.deepEqual(zlib.gunzipSync(fs.readFileSync(file + '.gz')), content);
    assert.deepEqual(zlib.brotliDecompressSync(fs.readFileSync(file + '.br')), content);
    if (reference.endsWith('.js')) new vm.Script(content.toString(), { filename: file });
  }
});
