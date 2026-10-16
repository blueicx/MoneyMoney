const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const ts = require('typescript');
function assetDeclaration(code, name) {
  const ast = ts.createSourceFile('asset.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `${name} must keep its public classic-script name`);
  return code.slice(node.getStart(ast), node.end);
}
function assertWorkspaceWrapper(code, name, group) {
  const context = vm.createContext({ window: { MoneyWorkspaceModules: { invoke: (...args) => args } } });
  vm.runInContext(assetDeclaration(code, name), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context[name]('fixture'))), [group, name, ['fixture']]);
}
const source = require('./helpers/dashboard-source.cjs').readDashboardSource();
function sourceFunction(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

test('a late index refresh cannot select a stock after the workspace or selection changed', async () => {
  for (const change of ["activeWorkspaceId='events';currentInstrumentId=null", "currentInstrumentId='SNDK'", ""]) {
    const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
    const w = dom.window, selections = [];
    let finish;
    w.eval("var activeMarketScope='stocks',activeWorkspaceId='stock-quotes',currentInstrumentId='AAPL',currentStockDashboardController=null;");
    w.loadStockIndices = () => new Promise(resolve => { finish = resolve; });
    w.stockNameForSymbol = symbol => symbol;
    w.selectStockSymbol = symbol => selections.push(symbol);
    w.eval(sourceFunction('loadStockQuotes'));
    try {
      const pending = w.loadStockQuotes();
      if (change) w.eval(change);
      finish();
      await pending;
      assert.deepEqual(selections, change ? [] : ['AAPL'], change || 'unchanged context still loads its chart');
    } finally { dom.window.close(); }
  }
});

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
  w.eval(sourceFunction('markMmPerformanceStage'));
  w.eval(sourceFunction('startDashboard'));
  try {
    await w.startDashboard();
    for (const name of ['loadAll', 'loadCommandCenter', 'loadMarketTimeline', 'loadMarketOverview', 'loadResearchBriefing']) assert.equal(loads.includes(name), false, `${name} is not part of stock chart startup`);
  } finally { dom.window.close(); }
});

test('dashboard startup marks auth and restored context before loading the selected instrument', async () => {
  assert.ok(source.includes('function markMmPerformanceStage('), 'the dashboard needs a gated stage marker helper');
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  const marks = [];
  w.__MM_PERFORMANCE_TRACE__ = true;
  Object.defineProperty(w.performance, 'mark', { configurable: true, value: name => marks.push({ name }) });
  Object.defineProperty(w.performance, 'getEntriesByType', { configurable: true, value: type => type === 'mark' ? marks : [] });
  w.eval(sourceFunction('markMmPerformanceStage'));
  w.eval("var activeMarketScope='stocks',activeWorkspaceId='stock-quotes',currentInstrumentId='AAPL';");
  w.readInitialMarketScope = () => 'stocks';
  w.waitForDashboardAuthState = async () => ({ authenticated: true });
  w.restoreSharedWorkspaceFromUrl = async () => {};
  const calls = [];
  for (const name of ['initTheme', 'restoreWorkspaceContextFromUrl', 'renderNavigationState', 'initializeDashboardCollapses', 'restoreLastDashboardTab', 'syncWorkspaceContextUrl', 'renderChartPatternControls']) w[name] = () => {};
  w.loadActiveWorkspaceInstrument = () => { calls.push('instrument'); return true; };
  try {
    w.eval(sourceFunction('startDashboard'));
    await w.startDashboard();
    const names = marks.map(entry => entry.name);
    const start = names.indexOf('moneymoney:dashboard-start');
    const auth = names.indexOf('moneymoney:dashboard-auth-ready');
    const context = names.indexOf('moneymoney:dashboard-context-ready');
    assert.ok(start >= 0 && auth > start && context > auth, `unexpected startup stages: ${names.join(', ')}`);
    assert.deepEqual(calls, ['instrument']);
  } finally { dom.window.close(); }
});

test('dashboard performance stage markers are silent by default', () => {
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const marks = [];
  try {
    Object.defineProperty(dom.window.performance, 'mark', { configurable: true, value: name => marks.push(name) });
    dom.window.eval(sourceFunction('markMmPerformanceStage'));
    dom.window.markMmPerformanceStage('not-enabled');
    assert.deepEqual(marks, [], 'normal page views should not create chart stage telemetry');
  } finally { dom.window.close(); }
});

test('stock quote section refreshes index cards without scheduling a late chart refresh', () => {
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  const calls = [];
  w.eval("var activeMarketScope='stocks',activeWorkspaceId='stock-quotes',currentInstrumentId='stock:us:AAPL';");
  w.loadStockQuotes = options => calls.push(options);
  w.eval(sourceFunction('scopedStockLoaders'));
  try {
    for (const load of w.scopedStockLoaders('stocks-market')) load();
    assert.deepEqual(calls.map(options => options?.refreshChart), [false], 'the quote section should refresh its indices but leave the already-loaded chart alone');
  } finally { dom.window.close(); }
});

test('index-only stock quote refresh still loads indices but does not reload the selected stock chart', async () => {
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  const calls = [];
  w.eval("var currentStockDashboardController=null,activeMarketScope='stocks',activeWorkspaceId='stock-quotes',currentInstrumentId='AAPL';window._stockSelectedSymbol='AAPL';");
  w.loadStockIndices = async () => calls.push('indices');
  w.stockNameForSymbol = symbol => symbol;
  w.selectStockSymbol = () => calls.push('chart');
  w.eval(sourceFunction('loadStockQuotes'));
  try {
    await w.loadStockQuotes({ refreshChart: false });
    assert.deepEqual(calls, ['indices'], 'an index response must not trigger selectStockSymbol and a duplicate K-line request');
  } finally { dom.window.close(); }
});

test('stock quote refresh still selects the default instrument when no chart context exists', async () => {
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  const calls = [];
  w.eval("var currentStockDashboardController=null,activeMarketScope='stocks',activeWorkspaceId='stock-quotes',currentInstrumentId=null;window._stockSelectedSymbol='';");
  w.loadStockIndices = async () => calls.push('indices');
  w.stockNameForSymbol = symbol => symbol;
  w.selectStockSymbol = symbol => calls.push(symbol);
  w.eval(sourceFunction('loadStockQuotes'));
  try {
    await w.loadStockQuotes();
    assert.deepEqual(calls, ['indices', 'AAPL'], 'a workspace without a selected instrument must still initialize its default chart');
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
  w.eval(sourceFunction('markMmPerformanceStage'));
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

test('concurrent stock sidebar renders share one private watchlist and paper-position read', async () => {
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  let authCalls = 0, fetchCalls = 0, resolveAuth;
  const authReady = new Promise(resolve => { resolveAuth = resolve; });
  w.eval('var stockLibraryPromise = null;');
  w.mm_isLoggedIn = true;
  w.mm_isGuest = false;
  w.waitForDashboardAuthState = () => { authCalls += 1; return authReady; };
  w.privateDashboardSessionReady = () => true;
  w.stockSymbolFromWatchlistId = () => '';
  w.stockNameForSymbol = value => value;
  w.fetch = async () => { fetchCalls += 1; return { json: async () => ({ success: true, data: [] }) }; };
  w.eval(sourceFunction('stockLibraryData'));
  try {
    const first = w.stockLibraryData();
    const second = w.stockLibraryData();
    assert.equal(authCalls, 1, 'the in-flight promise must be published before waiting for auth');
    resolveAuth({ authenticated: true });
    const [left, right] = await Promise.all([first, second]);
    assert.equal(fetchCalls, 2, 'one watchlist request and one paper-position request serve both renders');
    assert.equal(left, right);
  } finally { dom.window.close(); }
});

test('stock K-line requests expose a single-flight helper and use it for duplicate chart loads', async () => {
  assert.ok(/function runStockKlineSingleFlight\(/.test(source), 'same-context requests need a tested deduplication seam');
  assert.ok(/runStockKlineSingleFlight\(/.test(sourceFunction('loadStockKline')), 'normal chart loads must use the single-flight seam');
  const dom = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  w.stockKlineInFlightRequests = new Map();
  w.eval("var currentStockSymbol='usAAPL',currentStockApiSymbol='',currentStockKlinePeriod='1d',stockChartAsOf='',stockChartIntradayDate='',stockChartAdjustment='source';");
  w.eval(sourceFunction('stockKlineRequestKey'));
  w.eval(sourceFunction('runStockKlineSingleFlight'));
  let calls = 0, release;
  try {
    assert.equal(w.stockKlineRequestKey('usAAPL'), w.stockKlineRequestKey('usAAPL'));
    assert.notEqual(w.stockKlineRequestKey('usAAPL'), w.stockKlineRequestKey('usSNDK'), 'different instruments must never share bars');
    const operation = () => { calls += 1; return new Promise(resolve => { release = resolve; }); };
    const first = w.runStockKlineSingleFlight('stocks:AAPL:1d', operation);
    const second = w.runStockKlineSingleFlight('stocks:AAPL:1d', operation);
    await Promise.resolve();
    assert.equal(calls, 1);
    release('bars');
    assert.deepEqual(await Promise.all([first, second]), ['bars', 'bars']);
    assert.equal(await w.runStockKlineSingleFlight('stocks:AAPL:1d', async () => { calls += 1; return 'fresh'; }), 'fresh');
    assert.equal(calls, 2, 'a later explicit refresh still starts a fresh request');
  } finally { dom.window.close(); }
});

test('an explicit workspace deep link waits for auth and core dashboard readiness before loading its bundle', async () => {
  const loader = fs.readFileSync(path.join('src', 'web', 'public', 'modules', 'workspace-loader.js'), 'utf8')
    .replace('__WORKSPACE_MANIFEST__', JSON.stringify({ modules: { charts: '/assets/workspace-charts.fixture.js', events: '/assets/workspace-events.fixture.js' }, styles: {}, workspaceContracts: require('../dist/features/market-workspace').workspaceAssetContracts() }));
  const loadGroups = async url => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, runScripts: 'outside-only' });
    const snapshot = () => ({
      preload: [...dom.window.document.querySelectorAll('link[data-workspace-preload]')].map(link => link.dataset.workspacePreload),
      scripts: [...dom.window.document.querySelectorAll('script[data-workspace-group]')].map(script => script.dataset.workspaceGroup),
    });
    let resolveAuth;
    dom.window.mm_authReady = new Promise(resolve => { resolveAuth = resolve; });
    dom.window.eval(loader);
    await new Promise(resolve => setTimeout(resolve, 0));
    const beforeAuth = snapshot();
    resolveAuth({ loggedIn: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    const afterAuth = snapshot();
    dom.window.dispatchEvent(new dom.window.Event('mm-dashboard-core-ready'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const afterCoreReady = snapshot();
    dom.window.close();
    return { beforeAuth, afterAuth, afterCoreReady };
  };
  assert.deepEqual(await loadGroups('http://localhost/?market=stocks&workspace=stock-quotes&instrument=AAPL'), {
    beforeAuth: { preload: [], scripts: [] },
    afterAuth: { preload: ['charts'], scripts: [] },
    afterCoreReady: { preload: ['charts'], scripts: ['charts'] },
  });
  assert.deepEqual(await loadGroups('http://localhost/?market=stocks&workspace=events'), {
    beforeAuth: { preload: [], scripts: [] }, afterAuth: { preload: [], scripts: [] }, afterCoreReady: { preload: [], scripts: ['events'] },
  });
  assert.deepEqual(await loadGroups('http://localhost/'), {
    beforeAuth: { preload: [], scripts: [] }, afterAuth: { preload: [], scripts: [] }, afterCoreReady: { preload: [], scripts: [] },
  }, 'default entry must not download a guessed workspace');
  assert.deepEqual(await loadGroups('http://localhost/?market=stocks&workspace=stock-quotes&sharedWorkspace=public-1'), {
    beforeAuth: { preload: [], scripts: [] }, afterAuth: { preload: [], scripts: [] }, afterCoreReady: { preload: [], scripts: [] },
  }, 'shared snapshots choose their own restored context');
});

test('authenticated stock chart deep links prefetch exactly their current symbol and timeframe before core readiness', async () => {
  const loader = fs.readFileSync(path.join('src', 'web', 'public', 'modules', 'workspace-loader.js'), 'utf8')
    .replace('__WORKSPACE_MANIFEST__', JSON.stringify({ modules: { charts: '/assets/workspace-charts.fixture.js' }, styles: {}, workspaceContracts: require('../dist/features/market-workspace').workspaceAssetContracts() }));
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost/?market=stocks&workspace=stock-quotes&instrument=stock%3Aus%3AAAPL&timeframe=1d',
    runScripts: 'outside-only',
  });
  let resolveAuth;
  let resolveKline;
  const requests = [];
  let activated = false;
  dom.window.fetch = (url, options) => {
    requests.push([String(url), options]);
    return new Promise(resolve => { resolveKline = resolve; });
  };
  dom.window.mm_authReady = new Promise(resolve => { resolveAuth = resolve; });
  try {
    dom.window.addEventListener('mm-workspace-modules-ready', () => { activated = true; });
    dom.window.eval(loader);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(requests.filter(([url]) => url.startsWith('/api/stock/kline')).length, 0,
      'K-line request must wait for auth');
    resolveAuth({ loggedIn: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    const klineRequests = requests.filter(([url]) => url.startsWith('/api/stock/kline'));
    assert.equal(klineRequests.length, 1, 'the current chart should start one request before core readiness');
    const [url, options] = klineRequests[0];
    const query = new URL(url, 'http://localhost').searchParams;
    assert.equal(query.get('symbol'), 'usAAPL');
    assert.equal(query.get('period'), '1d');
    assert.equal(query.get('interval'), '1d');
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    resolveKline({ ok: true, status: 200, json: async () => ({ success: false, reason: 'test response' }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    const handoff = dom.window.MoneyStockKlinePrefetch.take(url);
    assert.ok(handoff, 'the chart can take the already-started response');
    assert.equal((await handoff.promise).body.reason, 'test response');
    assert.equal(dom.window.MoneyStockKlinePrefetch.take(url), null, 'the response is consumable only once');
    assert.equal(dom.window.document.querySelector('script[data-workspace-group="charts"]'), null,
      'the chart module waits for core readiness while the prefetch may overlap startup');
    dom.window.dispatchEvent(new dom.window.Event('mm-dashboard-core-ready'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const chartScript = dom.window.document.querySelector('script[data-workspace-group="charts"]');
    assert.ok(chartScript);
    chartScript.onload();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(activated, true);
  } finally { dom.window.close(); }
});

test('stock K-line prefetch excludes ambiguous, shared, historical, and non-chart contexts', async () => {
  const loader = fs.readFileSync(path.join('src', 'web', 'public', 'modules', 'workspace-loader.js'), 'utf8')
    .replace('__WORKSPACE_MANIFEST__', JSON.stringify({ modules: { charts: '/assets/workspace-charts.fixture.js', events: '/assets/events.js' }, styles: {}, workspaceContracts: require('../dist/features/market-workspace').workspaceAssetContracts() }));
  const run = async (url, savedAsOf = '') => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, runScripts: 'outside-only' });
    let resolveAuth;
    const requests = [];
    dom.window.fetch = (value, options) => { requests.push([String(value), options]); return new Promise(() => {}); };
    if (savedAsOf) dom.window.localStorage.setItem('moneymoney:kline-as-of:usAAPL', savedAsOf);
    dom.window.mm_authReady = new Promise(resolve => { resolveAuth = resolve; });
    dom.window.eval(loader);
    resolveAuth({ loggedIn: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    const result = requests.filter(([value]) => value.startsWith('/api/stock/kline'));
    dom.window.close();
    return result;
  };
  const base = 'http://localhost/?market=stocks&workspace=stock-quotes&instrument=stock%3Aus%3AAAPL';
  for (const suffix of ['', '&timeframe=invalid']) {
    const result = await run(base + suffix);
    assert.equal(result.length, 1);
    assert.equal(new URL(result[0][0], 'http://localhost').searchParams.get('period'), '5m');
  }
  const excluded = [
    'http://localhost/?market=stocks&workspace=stock-quotes',
    base + '&sharedWorkspace=public-1',
    base + '&asOf=2026-10-01T00%3A00%3A00Z',
    base + '&focusDate=2026-10-01',
    base + '&date=2026-10-01',
    'http://localhost/?market=stocks&workspace=events&instrument=stock%3Aus%3AAAPL',
    'http://localhost/?market=crypto&workspace=stock-quotes&instrument=BTCUSDT',
    'http://localhost/?market=stocks&workspace=stock-quotes&instrument=bad%2Fsymbol',
  ];
  for (const url of excluded) assert.equal((await run(url)).length, 0, `must not prefetch ${url}`);
  assert.equal((await run(base, '2026-10-01T23:59:59.999Z')).length, 0,
    'a locally restored asOf context must not receive ordinary live bars');
});

test('the workspace loader waits through deferred auth-client execution when its promise is not assigned yet', async () => {
  const loader = fs.readFileSync(path.join('src', 'web', 'public', 'modules', 'workspace-loader.js'), 'utf8')
    .replace('__WORKSPACE_MANIFEST__', JSON.stringify({ modules: { charts: '/assets/workspace-charts.fixture.js' }, styles: {}, workspaceContracts: require('../dist/features/market-workspace').workspaceAssetContracts() }));
  const authClient = fs.readFileSync(path.join('src', 'web', 'public', 'modules', 'auth-client.js'), 'utf8');
  assert.match(authClient, /mm-auth-client-ready/, 'auth client signals when its promise has been assigned');
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost/?market=stocks&workspace=stock-quotes', runScripts: 'outside-only',
  });
  let resolveAuth;
  try {
    dom.window.eval(loader);
    assert.equal(dom.window.document.querySelector('script[data-workspace-group="charts"]'), null,
      'a classic deferred loader must not outrun the module auth client');
    dom.window.mm_authReady = new Promise(resolve => { resolveAuth = resolve; });
    dom.window.dispatchEvent(new dom.window.Event('mm-auth-client-ready'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(dom.window.document.querySelector('script[data-workspace-group="charts"]'), null,
      'the bundle must wait for the auth status request as well as DOM readiness');
    assert.equal(dom.window.document.querySelector('link[data-workspace-preload="charts"]'), null,
      'chart code must not be fetched before auth settles');
    resolveAuth({ loggedIn: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(dom.window.document.querySelector('script[data-workspace-group="charts"]'), null,
      'chart code must wait until core readiness');
    assert.ok(dom.window.document.querySelector('link[rel="preload"][as="script"][data-workspace-preload="charts"]'),
      'the public chart bundle should preload after auth while core startup continues');
    let activated = false;
    dom.window.addEventListener('mm-workspace-modules-ready', () => { activated = true; });
    dom.window.dispatchEvent(new dom.window.Event('mm-dashboard-core-ready'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const chartScript = dom.window.document.querySelector('script[data-workspace-group="charts"]');
    assert.ok(chartScript);
    chartScript.onload();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(activated, true);
  } finally { dom.window.close(); }
});

test('workspace startup stages are marked only when browser performance tracing is enabled', async () => {
  const loader = fs.readFileSync(path.join('src', 'web', 'public', 'modules', 'workspace-loader.js'), 'utf8')
    .replace('__WORKSPACE_MANIFEST__', JSON.stringify({ modules: { charts: '/assets/workspace-charts.fixture.js' }, styles: {}, workspaceContracts: require('../dist/features/market-workspace').workspaceAssetContracts() }));
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost/?market=stocks&workspace=stock-quotes&instrument=usAAPL', runScripts: 'outside-only',
  });
  let resolveAuth;
  const performanceMarks = [];
  try {
    dom.window.fetch = () => new Promise(() => {});
    dom.window.__MM_PERFORMANCE_TRACE__ = true;
    Object.defineProperty(dom.window.performance, 'mark', { configurable: true, value: name => performanceMarks.push({ name }) });
    Object.defineProperty(dom.window.performance, 'getEntriesByType', { configurable: true, value: type => type === 'mark' ? performanceMarks : [] });
    dom.window.mm_authReady = new Promise(resolve => { resolveAuth = resolve; });
    dom.window.eval(loader);
    resolveAuth({ loggedIn: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    const beforeCore = performanceMarks.map(entry => entry.name);
    assert.ok(beforeCore.includes('moneymoney:auth-ready'));
    assert.ok(beforeCore.includes('moneymoney:chart-preload-start'));
    assert.ok(beforeCore.includes('moneymoney:stock-kline-prefetch-start'));
    assert.ok(beforeCore.indexOf('moneymoney:auth-ready') < beforeCore.indexOf('moneymoney:chart-preload-start'));
    assert.equal(beforeCore.includes('moneymoney:dashboard-core-ready'), false,
      'the prefetch must already have started while core startup is still pending');
    assert.equal(dom.window.document.querySelector('script[data-workspace-group="charts"]'), null,
      'chart code waits for core while stock data prefetch overlaps startup');
    dom.window.dispatchEvent(new dom.window.Event('mm-dashboard-core-ready'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const chartScript = dom.window.document.querySelector('script[data-workspace-group="charts"]');
    assert.ok(chartScript);
    const afterCore = performanceMarks.map(entry => entry.name);
    assert.ok(afterCore.includes('moneymoney:dashboard-core-ready'));
    assert.ok(afterCore.includes('moneymoney:chart-module-start'));
    assert.ok(dom.window.document.querySelector('script[data-workspace-group="charts"]'));
    dom.window.document.querySelector('script[data-workspace-group="charts"]').onload();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(performanceMarks.some(entry => entry.name === 'moneymoney:chart-module-ready'));
  } finally { dom.window.close(); }
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

test('the large dashboard startup bundle executes only after the auth client settles', async () => {
  const root = path.join('dist', 'web', 'public');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'asset-manifest.json'), 'utf8'));
  const bootstrapRef = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)]
    .map(match => match[1]).find(reference => reference.includes('dashboard-startup-bootstrap.'));
  assert.ok(bootstrapRef, 'the HTML should start with a small deferred runtime bootstrap');
  assert.doesNotMatch(html, /src="\/assets\/dashboard-1\.[^"]+\.js"/,
    'the large runtime must not compete with the authentication module during initial parsing');
  const bootstrap = fs.readFileSync(path.join(root, bootstrapRef), 'utf8');
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {runScripts:'outside-only'});
  const w = dom.window, scripts = [], tick = () => new Promise(resolve => setTimeout(resolve, 0));
  let resolveAuth, resolveCore, idle, runtimeEvents = 0;
  w.mm_authReady = new Promise(resolve => { resolveAuth = resolve; });
  w.mm_dashboardReady = new Promise(resolve => { resolveCore = resolve; });
  w.requestIdleCallback = (fn, options) => { idle = fn; assert.equal(options.timeout, 1200); };
  const append = w.document.head.append.bind(w.document.head);
  w.document.head.append = node => { scripts.push(node); append(node); };
  w.addEventListener('mm-dashboard-runtime-loaded', () => runtimeEvents++);
  try {
    w.eval(bootstrap); await tick(); assert.equal(scripts.length, 0);
    resolveAuth(); await tick(); assert.equal(scripts.length, 1);
    scripts[0].onload(); await tick(); assert.equal(scripts.length, 1, 'compatibility waits for core init');
    resolveCore(); await tick();
    const immediate = scripts.slice(1);
    assert.equal(immediate.length, 2);
    assert.ok(immediate.every(script => script.async === false), 'compatibility executes in order');
    immediate.forEach(script => script.onload()); await tick();
    assert.equal(runtimeEvents, 1, 'core readiness dispatches exactly once');
    assert.equal(scripts.length, 3, 'optional experience scripts wait for idle');
    idle(); await tick(); assert.equal(scripts.length, 5);
    assert.ok(scripts.slice(3).every(script => /experience/.test(script.src) && script.async === false));
    scripts.slice(3).forEach(script => script.onload()); await tick(); assert.equal(runtimeEvents, 1);
  } finally { dom.window.close(); }
  const runtimeRef = Object.keys(manifest).find(reference => reference.includes('/dashboard-startup-runtime.'));
  assert.ok(runtimeRef, 'the main runtime should be emitted as a separately hashed resource');
  const runtime = fs.readFileSync(path.join(root, runtimeRef), 'utf8');
  assert.match(runtime, /async function startDashboard\(/);
  assert.match(runtime, /window\.mm_dashboardReady\s*=\s*startDashboard\(\);/);
  const startup = Object.keys(manifest).filter(reference => reference.includes('/dashboard-startup-'))
    .map(reference => fs.readFileSync(path.join(root, reference), 'utf8')).join('\n');
  assert.match(startup, /window\.MoneyMoneyChartBridge/,
    'legacy chart bridge code must remain in the ordered startup sequence');
});

test('options IV history and Telegram result diagnostics stay in their lazy workspace bundles', () => {
  const root = path.join('dist', 'web', 'public');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'asset-manifest.json'), 'utf8'));
  const asset = fragment => {
    const reference = Object.keys(manifest).find(item => item.includes(fragment));
    assert.ok(reference, `${fragment} bundle must be emitted`);
    return fs.readFileSync(path.join(root, reference), 'utf8');
  };
  const runtime = asset('/dashboard-startup-runtime.');
  const options = asset('/workspace-options.');
  const ops = asset('/workspace-ops.');
  const charts = asset('/workspace-charts.');

  assertWorkspaceWrapper(runtime, 'renderOptionIvTermStructure', 'options');
  assertWorkspaceWrapper(runtime, 'loadOptionIvSnapshotHistory', 'options');
  assetDeclaration(options, 'renderOptionIvTermStructure');
  assetDeclaration(options, 'loadOptionIvSnapshotHistory');

  assertWorkspaceWrapper(runtime, 'loadTelegramResultCoverage', 'ops');
  assetDeclaration(ops, 'loadTelegramResultCoverage');
  assertWorkspaceWrapper(runtime, 'globalSearchCommands', 'ops');
  assetDeclaration(ops, 'globalSearchCommands');

  assertWorkspaceWrapper(runtime, 'initCryptoChartHover', 'charts');
  assetDeclaration(charts, 'initCryptoChartHover');
  assert.match(assetDeclaration(charts, 'drawCandles'), /initCryptoChartHover\(\)/);
  for (const name of ['renderChartSignalMarkers', 'renderChartSignalList', 'renderChartSignalLifecycleControls']) {
    assert.match(assetDeclaration(runtime, name), /MoneyWorkspaceModules\.invoke/, `${name} must not ship its implementation in the shell`);
    assertWorkspaceWrapper(runtime, name, 'charts');
    assetDeclaration(charts, name);
  }

  const prediction = asset('/workspace-prediction.');
  assertWorkspaceWrapper(runtime, 'loadCategories', 'prediction');
  assertWorkspaceWrapper(runtime, 'categoryCardHtml', 'prediction');
  assetDeclaration(prediction, 'loadCategories');
  assetDeclaration(prediction, 'categoryCardHtml');
  assertWorkspaceWrapper(runtime, 'attachPredictionRelationshipCheck', 'prediction');
  assetDeclaration(prediction, 'attachPredictionRelationshipCheck');
});

test('non-current dashboard, stock research and preference renderers stay out of the startup implementation', () => {
  const root = path.join('dist', 'web', 'public');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'asset-manifest.json'), 'utf8'));
  const asset = group => fs.readFileSync(path.join(root, Object.keys(manifest).find(item => item.includes(`/${group}.`))), 'utf8');
  const core = asset('dashboard-startup-runtime');
  for (const [group, names] of [
    ['overview', ['renderWorkspaceDashboardCards', 'renderMarketChangeDigest']],
    ['stocks', ['stockResearchFreshnessMarkup', 'workspaceTrendSvg']],
    ['ops', ['renderUiPreferencesForm']],
    ['charts', ['loadEarlierCryptoKline']],
  ]) {
    const bundle = asset(`workspace-${group}`);
    for (const name of names) {
      assert.match(assetDeclaration(core, name), /MoneyWorkspaceModules\.invoke/, `${name} must load with ${group}`);
      assertWorkspaceWrapper(core, name, group);
      assetDeclaration(bundle, name);
    }
  }
});

test('dashboard and stock-index API share one cached single-flight upstream loader', () => {
  const server = fs.readFileSync(path.join('src', 'web', 'server.ts'), 'utf8');
  const loaderStart = server.indexOf('async function loadStockIndicesData()');
  const providerStart = server.indexOf('async function dashboardStockIndices()');
  const providerEnd = server.indexOf('\nfunction dashboardOptionsCoverage()', providerStart);
  const routeStart = server.indexOf("app.get('/api/stock/indices'");
  const routeEnd = server.indexOf('\nfunction fastStockSearch(', routeStart);
  assert.ok(loaderStart >= 0 && providerStart > loaderStart && providerEnd > providerStart && routeStart > providerEnd && routeEnd > routeStart,
    'the shared stock-index loader and both consumers should be present');
  const loader = server.slice(loaderStart, providerStart);
  const provider = server.slice(providerStart, providerEnd);
  const route = server.slice(routeStart, routeEnd);
  assert.match(loader, /getFreshExternal(?:<[^>]+>)?\('stockIndices',\s*CACHE_TTL,/,
    'the shared loader must use the existing cache and in-flight request coalescer');
  assert.match(provider, /await loadStockIndicesData\(\)/,
    'the dashboard provider must use the shared loader');
  assert.match(route, /await loadStockIndicesData\(\)/,
    'the HTTP route must use the same shared loader');
  assert.equal((server.match(/qt\.gtimg\.cn\/q=sh000001,sz399001,hkHSI,usDJI,usIXIC,usINX/g) || []).length, 1,
    'the upstream index URL must have a single implementation');
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
  for (const group of ['workspace-overview.', 'workspace-charts.', 'workspace-research.', 'workspace-comparison.', 'workspace-contracts.']) {
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
  assertWorkspaceWrapper(core, 'loadTradeAssistant', 'trading');
  assertWorkspaceWrapper(core, 'loadPaperPortfolio', 'portfolio');
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

test('overview-only loaders stay out of the chart bootstrap and load with the overview workspace', () => {
  const root = path.join('dist', 'web', 'public');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'asset-manifest.json'), 'utf8'));
  const dashboardAssets = Object.keys(manifest).filter(resource => /\/dashboard-.*\.js$/.test(resource));
  const core = dashboardAssets.map(resource => fs.readFileSync(path.join(root, resource), 'utf8')).join('\n');
  const overviewResource = Object.keys(manifest).find(resource => resource.includes('/workspace-overview.'));
  assert.ok(overviewResource, 'overview-only code must be emitted as an on-demand workspace bundle');
  const overview = fs.readFileSync(path.join(root, overviewResource), 'utf8');

  for (const name of ['loadMarketOverview', 'loadCrossAssetCorrelation', 'loadResearchBriefing', 'loadCommandCenter']) {
    assertWorkspaceWrapper(core, name, 'overview');
    assert.doesNotMatch(core, new RegExp(`async function ${name}\\s*\\(`), `${name} implementation must not be parsed on a stock-chart cold start`);
    assert.match(overview, new RegExp(`(?:async )?function ${name}\\s*\\(`), `${name} must load with the overview feature`);
  }
  assert.match(overview, /function fetchMarketOverviewJson\(/, 'the scoped overview fetch helper must share the deferred bundle');

  const opsResource = Object.keys(manifest).find(resource => resource.includes('/workspace-ops.'));
  const ops = fs.readFileSync(path.join(root, opsResource), 'utf8');
  assert.doesNotMatch(ops, /async function loadCrossAssetCorrelation\(/, 'overview correlation must not pull the full operations workspace');

  const stocksResource = Object.keys(manifest).find(resource => resource.includes('/workspace-stocks.'));
  const stocks = fs.readFileSync(path.join(root, stocksResource), 'utf8');
  assert.match(stocks, /async function loadGlobalMacroSpot\(/, 'the stock-only macro spot card must share the stock workspace bundle');
  assert.match(stocks, /function renderGlobalMacroSpot\(/, 'the stock-only macro spot renderer must share the stock workspace bundle');
});

test('hashed dashboard entry scripts defer and feature bundles stay behind the lazy loader', () => {
  const html = fs.readFileSync(path.join('dist', 'web', 'public', 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join('dist', 'web', 'public', 'asset-manifest.json'), 'utf8'));
  const assetScripts = [...html.matchAll(/<script\b([^>]*)>/gi)].filter(match => /\bsrc\s*=\s*["']\/assets\/[^"']+\.js["']/i.test(match[1]));
  assert.ok(assetScripts.length >= 3 && assetScripts.length <= 4,
    'initial HTML should load only auth, the workspace loader, and the small dashboard bootstrap');
  assert.ok(assetScripts.every(match => /\bdefer\b|\btype\s*=\s*["']module["']/i.test(match[1])), 'hashed scripts should download in parallel and execute after parsing');
  for (const group of ['workspace-charts.', 'workspace-research.', 'workspace-comparison.', 'workspace-contracts.']) {
    assert.ok(Object.keys(manifest).some(resource => resource.includes(group)), `${group} should exist as a separately cached on-demand bundle`);
    assert.doesNotMatch(html, new RegExp(`src=["']\\/assets\\/${group.replace('.', '\\.')}`),
      `${group} must not be fetched from the initial HTML`);
  }
});

test('loading benchmark uses an isolated real-data page and waits for a settled stock K-line state', () => {
  const benchmark = fs.readFileSync('scripts/web-loading-benchmark.cjs', 'utf8');
  assert.doesNotMatch(benchmark, /Fetch\.enable|Fetch\.requestPaused/,
    'the benchmark must not use CDP request interception or disable browser cache');
  assert.match(benchmark, /MONEYMONEY_BENCHMARK_GATE_AUX/,
    'a separate opt-in run should gate non-chart APIs while measuring the critical path');
  assert.match(benchmark, /if\s*\(gateAuxiliaryRequests\)[\s\S]*?page\.route\(/,
    'route interception must only run when the explicit diagnostic gate is enabled');
  assert.match(benchmark, /pendingAuxiliaryReleases[\s\S]*?finally[\s\S]*?release/,
    'every intercepted auxiliary response must be released during cleanup');
  assert.doesNotMatch(benchmark, /window\.fetch\s*=/,
    'the benchmark must not change dashboard fetch behavior');
  assert.doesNotMatch(benchmark, /PerformanceObserver/,
    'the timed page must not run observer instrumentation that can perturb its main thread');
  assert.doesNotMatch(benchmark, /Network\.setCacheDisabled/,
    'the browser default cache behavior should remain untouched during warm-load measurement');
  assert.match(benchmark, /apiRequests\.includes\(['"]\/api\/stock\/kline['"]\)/);
  assert.match(benchmark, /dataset\.klineState/);
  assert.match(benchmark, /\['ready', 'empty', 'failed'\]/,
    'the timing result should include a rendered chart or an explicit source result');
  assert.match(benchmark, /chartReadyMs/);
  assert.match(benchmark, /phaseMarks/);
  assert.match(benchmark, /klineResponseMetadata/);
  assert.match(benchmark, /auxiliaryPendingAtChart/);
  assert.match(benchmark, /\.catch\(error => reportWaitFailure\('workspace-ready', error\)\)/);
  assert.match(benchmark, /\.catch\(error => reportWaitFailure\('chart-settled', error\)\)/);
  const failureReporter = benchmark.slice(benchmark.indexOf('const reportWaitFailure ='), benchmark.indexOf("page.on('request'"));
  assert.doesNotMatch(failureReporter, /page\.evaluate/,
    'failure diagnostics must not wait for a renderer evaluation after the renderer has stalled');
  assert.match(benchmark, /timeout:\s*15_000/,
    'the browser harness should fail promptly instead of hanging on startup');
  assert.match(benchmark, /function waitForPageCondition\(/,
    'a Node-side watchdog must bound waits even when the browser main thread is blocked');
  assert.match(benchmark, /Promise\.race\(/,
    'the page predicate must be raced against the out-of-process watchdog');
  assert.match(benchmark, /Node watchdog/);
  assert.match(benchmark, /authStatusProbe/,
    'a stalled browser auth request must be compared with a direct isolated-server probe');
  assert.match(benchmark, /page\.on\('pageerror'/,
    'page runtime errors should be retained in timeout diagnostics');
  assert.match(benchmark, /MONEYMONEY_BENCHMARK_RUNS/);
  assert.match(benchmark, /MONEYMONEY_BENCHMARK_VIEWPORT/);
  assert.match(benchmark, /MONEYMONEY_BENCHMARK_CPU_RATE/,
    'the benchmark must allow a no-throttle diagnostic run without changing request behavior');
  assert.match(benchmark, /MONEYMONEY_BENCHMARK_NETWORK/,
    'the benchmark must separate natural-network diagnostics from the controlled weak-network run');
  assert.ok(benchmark.includes('apiRequestCounts[pathname], 1'), 'the benchmark fails if stock startup duplicates scoped data requests');
  assert.match(benchmark, /stock-kline-prefetch-start/,
    'the browser benchmark verifies the authenticated request starts before core readiness');
  assert.match(benchmark, /prefetchStart\.atMs < coreReady\.atMs/);
  assert.match(benchmark, /timeframe=1d/);
  assert.match(benchmark, /stock-indices-settled/,
    'the benchmark must wait for the slower index card before deciding whether a late callback restarted the chart');
  const liveKlineSmoke = fs.readFileSync('scripts/live-kline-smoke.cjs', 'utf8');
  assert.match(liveKlineSmoke, /setTimeout\(resolve, 700\)/);
  assert.match(liveKlineSmoke, /late index-card completion must not reload an already-open instrument K-line/);
  assert.match(benchmark, /for \(const sample of \[cold, warm\]\)/,
    'duplicate request checks must cover both cold and warm page navigations');
  assert.match(benchmark, /apiRequestDetails/,
    'duplicate request failures must report the exact request URL and method');
  assert.match(benchmark, /apiTimings/,
    'the benchmark must distinguish upstream API latency from browser startup and rendering');
  assert.match(benchmark, /requestfinished/,
    'API duration should include the response body transfer, not only response headers');
  assert.match(benchmark, /dashboardStartupCompatibility\s*:/,
    'the report must expose startup compatibility asset timing separately');
  assert.match(benchmark, /requestStartSpreadMs/,
    'the report must show whether compatibility asset downloads started together');
  assert.match(benchmark, /resourceCount\s*:/);
  assert.match(benchmark, /transferBytes\s*:/);
  assert.match(benchmark, /page\.evaluate\(\(\{\s*shellReadyMs\s*,\s*chartReadyMs\s*\}\)\s*=>/,
    'the benchmark should pass timing values as one Playwright evaluate argument');
  assert.match(benchmark, /\},\s*\{\s*shellReadyMs\s*,\s*chartReadyMs\s*\}\);/,
    'Playwright evaluate accepts one serialized argument object');
  assert.doesNotMatch(benchmark, /\},\s*shellReadyMs\s*,\s*chartReadyMs\s*\);/,
    'multiple positional evaluate arguments fail on the current Playwright API');
  assert.match(benchmark, /await stopBenchmarkChild\(child\)/,
    'the isolated server must exit before the benchmark removes its temporary database');
  assert.match(benchmark, /fs\.rmSync\(root,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/,
    'the benchmark must clean only the isolated root it created');
  assert.match(benchmark, /MONEYMONEY_BENCHMARK_ROOT/);
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(packageJson.scripts['smoke:chart-path'], 'node scripts/web-loading-benchmark.cjs');
});

test('loading benchmark failure diagnostics probe the protected navigation route with the benchmark session', () => {
  const benchmark = fs.readFileSync('scripts/web-loading-benchmark.cjs', 'utf8');
  assert.match(benchmark, /navigationStatusProbe/,
    'a missing browser response must be compared with the same protected route outside the renderer');
  assert.match(benchmark, /authContext\.request\.get\(base \+ '\/api\/workspace\/navigation\?scope=stocks'/,
    'the direct probe must use the authenticated Playwright request context');
  assert.match(benchmark, /workspace\/navigation/);
});

test('browser auth smoke waits for the lazy dashboard core before directly invoking a feature', () => {
  const smoke = fs.readFileSync(path.join('scripts', 'browser-auth-smoke.cjs'), 'utf8');
  assert.match(smoke, /page\.waitForFunction\([\s\S]*?mm_dashboardCoreReady[\s\S]*?loadAiRunners/,
    'the page must finish deferred startup before the smoke calls a feature function');
});

test('live K-line smoke waits for the deferred dashboard runtime before switching workspaces', () => {
  const smoke = fs.readFileSync(path.join('scripts', 'live-kline-smoke.cjs'), 'utf8');
  assert.match(smoke, /page\.waitForFunction\([\s\S]*?typeof window\.setMarketScope === 'function'[\s\S]*?setMarketScope\('stocks'\)/,
    'the chart smoke must not race dashboard bootstrap after authentication');
});

test('loading benchmark rejects browser runtime errors instead of reporting a fast broken page', () => {
  const benchmark=fs.readFileSync('scripts/web-loading-benchmark.cjs','utf8');
  assert.match(benchmark,/assert\.deepEqual\(pageErrors,\s*\[\]/);
});
