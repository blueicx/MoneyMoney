const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = require('./helpers/dashboard-source.cjs').readDashboardSource();
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
  for (const name of ['initTheme', 'restoreWorkspaceContextFromUrl', 'syncWorkspaceContextUrl', 'renderNavigationState', 'initializeDashboardCollapses', 'restoreLastDashboardTab', 'renderChartPatternControls']) w[name] = () => {};
  for (const name of ['loadActiveWorkspaceInstrument', 'loadAll', 'loadCommandCenter', 'loadNewsTicker', 'loadMarketTimeline', 'loadMarketOverview', 'loadResearchBriefing']) w[name] = () => loads.push(name);
  w.eval(sourceFunction('startDashboard'));
  try {
    await w.startDashboard();
    for (const name of ['loadAll', 'loadCommandCenter', 'loadMarketTimeline', 'loadMarketOverview', 'loadResearchBriefing']) assert.equal(loads.includes(name), false, `${name} is not part of stock chart startup`);
  } finally { dom.window.close(); }
});

test('changing markets does not eagerly load the event timeline workspace', () => {
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  const loads = [];
  w.eval("var activeMarketScope='overview',activeWorkspaceId='overview',currentInstrumentId=null,marketScopeRequestEpoch=0,lastBacktestResult=null,loadedStockSections=new Set(),eventCalendarState={cache:null,cacheAt:0};");
  w.isMarketScope = value => ['overview', 'stocks', 'options', 'crypto', 'prediction'].includes(value);
  w.defaultWorkspaceForMarketScope = scope => scope === 'stocks' ? 'stock-quotes' : 'overview';
  w.stockNameForSymbol = value => value;
  w.abortMarketScopedRequests = () => {};
  for (const name of ['syncWorkspaceContextUrl', 'renderNavigationState', 'updateBacktestScopeNote', 'renderBacktestCandidates', 'loadNewsTicker', 'loadMarketOverview', 'showTab']) w[name] = () => {};
  w.loadMarketTimeline = () => loads.push('events');
  w.eval(sourceFunction('setMarketScope'));
  try {
    w.setMarketScope('stocks', { openTab: false });
    assert.deepEqual(loads, [], 'market switch should not fetch data for an inactive event workspace');
    w.eval("activeWorkspaceId='events';currentInstrumentId='AAPL';");
    assert.equal(w.activeMarketScope, 'stocks');
    assert.equal(w.activeWorkspaceId, 'events');
    assert.equal(w.currentInstrumentId, 'AAPL');
    w.eval(sourceFunction('loadEventTimelineWorkspace'));
    w.eval(sourceFunction('loadActiveWorkspaceInstrument'));
    w.loadActiveWorkspaceInstrument();
    assert.deepEqual(loads, ['events'], 'opening the event workspace should still load its timeline');
  } finally { dom.window.close(); }
});

test('opening an event deep link loads its timeline even without a selected instrument', async () => {
  const dom = new JSDOM(source, { url: 'http://localhost/?market=stocks&workspace=events', runScripts: 'outside-only' });
  const w = dom.window;
  const loads = [];
  w.eval("var activeMarketScope='stocks',activeWorkspaceId='events',currentInstrumentId=null;");
  w.readInitialMarketScope = () => 'stocks';
  w.waitForDashboardAuthState = async () => ({ authenticated: true });
  w.restoreSharedWorkspaceFromUrl = async () => {};
  for (const name of ['initTheme', 'restoreWorkspaceContextFromUrl', 'syncWorkspaceContextUrl', 'renderNavigationState', 'initializeDashboardCollapses', 'restoreLastDashboardTab', 'renderChartPatternControls']) w[name] = () => {};
  w.loadMarketTimeline = () => loads.push('events');
  w.eval(sourceFunction('loadEventTimelineWorkspace'));
  w.eval(sourceFunction('startDashboard'));
  try {
    await w.startDashboard();
    assert.deepEqual(loads, ['events'], 'deep-linked event workspace should load its timeline without requiring an instrument');
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

test('a fresh history fetch is not labeled as a real-time K-line quote', async () => {
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval("var activeMarketScope='stocks',currentStockKlinePeriod='5m',stockChartAsOf='';");
  w.stockEscapeHtml = value => String(value);
  w.eval(sourceFunction('loadUnifiedStockData'));
  try {
    await w.loadUnifiedStockData('AAPL', {
      data: [{ time: Date.parse('2026-10-08T20:00:00.000Z'), open: 100, high: 101, low: 99, close: 100, volume: 1 }],
      dataStatus: 'live', source: 'yahoo-finance-history', updatedAt: '2026-10-08T23:35:51.120Z',
    });
    const coverage = w.document.querySelector('[data-stock-coverage]').textContent;
    assert.match(coverage, /K线：最新可用/);
    assert.match(coverage, /实时性未声明/);
    assert.doesNotMatch(coverage, /K线：实时(?:\s|$)/);
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

test('overview HTML does not eagerly request chart, research, comparison, or contract workspaces', () => {
  const root = path.join('dist', 'web', 'public');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'asset-manifest.json'), 'utf8'));
  const initialScripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)].map(match => match[1]);
  const initialStyles = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css)(?:\?[^"]*)?"[^>]*>/gi)].map(match => match[1]);

  for (const feature of ['chart-analysis', 'live-kline', 'trading-chart', 'interactive-history', 'workflow-polish', 'professional-research', 'automatic-comparison', 'action-research-workspace', 'contracts-workspace']) {
    assert.equal(initialScripts.some(resource => resource.includes(feature)), false, `${feature} must not be an initial script request`);
  }
  assert.equal(initialStyles.some(resource => resource.includes('action-research-workspace.css')), false, 'research CSS must load with the research workspace');
  assert.equal(initialStyles.some(resource => resource.includes('contracts-workspace.css')), false, 'contract CSS must load with the contract workspace');
  for (const group of ['workspace-charts.', 'workspace-research.', 'workspace-comparison.', 'workspace-contracts.']) {
    assert.ok(Object.keys(manifest).some(resource => resource.includes(group)), `${group} must be emitted as a lazy resource`);
  }
  const dashboardScripts = Object.keys(manifest).filter(resource => /\/dashboard-.*\.js$/.test(resource))
    .map(resource => fs.readFileSync(path.join(root, resource), 'utf8')).join('\n');
  assert.doesNotMatch(dashboardScripts, /MoneyWorkspaceModules\.invoke\('research',\s*'loadResearchBriefing'/, 'the overview briefing must remain in the core bundle and must not pull the research workspace on cold start');
  const eventBundle = fs.readFileSync(path.join(root, Object.keys(manifest).find(name => name.includes('/workspace-events.'))), 'utf8');
  assert.match(eventBundle, /async function loadMarketTimeline\(/, 'market timeline data should load only with the event workspace');
});

test('dashboard core JavaScript stays below the cold-start budget and defers heavy feature loaders', () => {
  const root = path.join('dist', 'web', 'public');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'asset-manifest.json'), 'utf8'));
  const dashboardAssets = Object.keys(manifest).filter(resource => /\/dashboard-.*\.js$/.test(resource));
  const coreBytes = dashboardAssets.reduce((sum, resource) => sum + manifest[resource].bytes, 0);
  assert.ok(coreBytes < 420_000, `dashboard core is ${coreBytes} bytes; target is below 420,000 bytes to keep non-current renderers out of cold start`);

  const core = dashboardAssets.map(resource => fs.readFileSync(path.join(root, resource), 'utf8')).join('\n');
  assert.match(core, /MoneyWorkspaceModules\.invoke\('trading',\s*'loadTradeAssistant'/);
  assert.match(core, /MoneyWorkspaceModules\.invoke\('portfolio',\s*'loadPaperPortfolio'/);
  assert.doesNotMatch(core, /async function loadTradeAssistant\s*\(/);
  assert.doesNotMatch(core, /async function loadPaperPortfolio\s*\(/);

  for (const [group, expectedFunction] of [
    ['trading', 'async function loadTradeAssistant('],
    ['portfolio', 'async function loadPaperPortfolio('],
    ['crypto', 'async function loadFundingCarry('],
    ['options', 'async function loadOptions('],
    ['prediction', 'async function loadPredictionRadar('],
    ['stocks', 'async function loadInsiderRadar('],
    ['ops', 'async function loadOpsConsole('],
  ]) {
    const resource = Object.keys(manifest).find(name => name.includes(`/workspace-${group}.`));
    assert.ok(resource, `workspace-${group} must be emitted as a lazy resource`);
    assert.ok(fs.readFileSync(path.join(root, resource), 'utf8').includes(expectedFunction), `${group} loader must live in its deferred bundle`);
  }
  const chartBundle = fs.readFileSync(path.join(root, Object.keys(manifest).find(name => name.includes('/workspace-charts.'))), 'utf8');
  const stockBundle = fs.readFileSync(path.join(root, Object.keys(manifest).find(name => name.includes('/workspace-stocks.'))), 'utf8');
  assert.ok(chartBundle.includes('function drawStockKline('), 'the stock renderer must be deferred with the chart workspace');
  assert.ok(stockBundle.includes('function renderFundamentalQuality('), 'stock-only analysis renderers must be deferred with their workspace');
});

test('hashed dashboard scripts defer in document order to avoid serial network round trips', () => {
  const html = fs.readFileSync(path.join('dist', 'web', 'public', 'index.html'), 'utf8');
  const assetScripts = [...html.matchAll(/<script\b([^>]*)>/gi)].filter(match => /\bsrc\s*=\s*["']\/assets\/[^"']+\.js["']/i.test(match[1]));
  assert.ok(assetScripts.length >= 6, 'dashboard runtime should use separately cached hashed scripts');
  assert.ok(assetScripts.every(match => /\bdefer\b|\btype\s*=\s*["']module["']/i.test(match[1])), 'hashed scripts should download in parallel and execute after parsing');
});

test('controlled loading benchmark waits for an actual stock K-line result before recording chart readiness', () => {
  const benchmark = fs.readFileSync('scripts/web-loading-benchmark.cjs', 'utf8');
  assert.match(benchmark, /__benchmarkApiRequests\.includes\(['"]\/api\/stock\/kline['"]\)/);
  assert.match(benchmark, /dataset\.klineState/);
  assert.match(benchmark, /chartReadyMs/);
  assert.match(benchmark, /MONEYMONEY_BENCHMARK_ROOT/);
});
