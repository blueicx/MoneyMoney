const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const ts = require('typescript');
const html = fs.readFileSync('src/web/public/index.html', 'utf8');
const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');

test('initial HTML does not render the overview before restoring the requested workspace', () => {
  const dom = new JSDOM(html);
  try {
    assert.equal(dom.window.document.querySelectorAll('.tab-content.active').length, 0,
      'the requested context must select the first visible workspace, not flash the unrelated overview');
    assert.ok(dom.window.document.getElementById('command-tab'));
    assert.ok(dom.window.document.getElementById('market-workspace-shell'));
  } finally { dom.window.close(); }
});

function hydrateFunction(name = 'mountStockChartWorkspace') {
  const ast = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const node = ast.statements.find(row => ts.isFunctionDeclaration(row) && row.name?.text === name);
  assert.ok(node, 'stock chart workspace needs an explicit mount boundary');
  return source.slice(node.getStart(ast), node.end);
}

test('stock chart mount waits for its real runtime, reports download failure and permits retry', async () => {
  const dom=new JSDOM('<div id="stock-chart-mount-status" role="status"></div><template id="stock-chart-template"><canvas id="stock-kline"></canvas></template>',{runScripts:'outside-only'}),w=dom.window;
  w.eval("var activeMarketScope='stocks',activeWorkspaceId='stock-quotes',currentStockKlinePeriod='1d';");
  for(const name of ['initializeDashboardCollapses','renderChartPatternControls','syncStockChartCompanionControls','bindStockChartCompanionSelection'])w[name]=()=>{};
  let requests=0;w.MoneyWorkspaceModules={ensure:()=>{requests++;return Promise.reject(new Error('资源下载失败'));}};
  w.eval(hydrateFunction());
  try{
    assert.equal(w.mountStockChartWorkspace(),false);
    assert.equal(w.document.getElementById('stock-kline'),null);
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(requests,1);
    assert.match(w.document.getElementById('stock-chart-mount-status').textContent,/资源下载失败/);
    w.MoneyTradingChart={};w.MoneyChartAnalysis={};
    assert.equal(w.mountStockChartWorkspace(),true);
    assert.ok(w.document.getElementById('stock-kline'));
    assert.equal(w.document.getElementById('stock-chart-mount-status'),null);
  }finally{w.close();}
});

test('late chart runtime readiness does not mount a stock chart into another market or workspace', () => {
  const dom=new JSDOM('<div id="stock-chart-mount-status"></div><template id="stock-chart-template"><canvas id="stock-kline"></canvas></template>',{runScripts:'outside-only'}),w=dom.window;
  w.eval("var activeMarketScope='stocks',activeWorkspaceId='stock-quotes',currentStockKlinePeriod='1d',stockChartKlines=[],bnKlineData=[];");
  for(const name of ['initializeDashboardCollapses','renderChartPatternControls','syncStockChartCompanionControls','bindStockChartCompanionSelection','applyMarketScopeView'])w[name]=()=>{};
  w.MoneyWorkspaceModules={ensure:()=>Promise.resolve()};w.eval(hydrateFunction());
  const ast=ts.createSourceFile('runtime.js',source,ts.ScriptTarget.Latest,true);
  const listener=ast.statements.find(n=>ts.isExpressionStatement(n)&&n.getText(ast).startsWith("window.addEventListener('mm-workspace-modules-ready'"));
  assert.ok(listener);w.eval(listener.getText(ast));
  const ready=()=>w.dispatchEvent(new w.CustomEvent('mm-workspace-modules-ready',{detail:{group:'charts'}}));
  try{
    assert.equal(w.mountStockChartWorkspace(),false);
    w.MoneyTradingChart={};w.MoneyChartAnalysis={};
    w.eval("activeMarketScope='crypto';activeWorkspaceId='on-chain';");ready();
    assert.equal(w.document.getElementById('stock-kline'),null);
    w.eval("activeMarketScope='stocks';activeWorkspaceId='insider';");ready();
    assert.equal(w.document.getElementById('stock-kline'),null);
    w.eval("activeWorkspaceId='stock-quotes';");ready();
    assert.ok(w.document.getElementById('stock-kline'));
  }finally{w.close();}
});

test('pattern controls ship with charts rather than blocking the initial core', () => {
  const manifest=JSON.parse(fs.readFileSync('dist/web/public/asset-manifest.json','utf8'));
  const corePath=Object.keys(manifest).find(p=>p.includes('/dashboard-startup-runtime.'));
  const core=fs.readFileSync('dist/web/public'+corePath,'utf8');
  const ast=ts.createSourceFile('core.js',core,ts.ScriptTarget.Latest,true);
  const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='renderChartPatternControls');
  assert.ok(node);
  assert.match(core.slice(node.getStart(ast),node.end),/MoneyWorkspaceModules\.invoke\(["']charts["']/);
});

test('overview startup does not request inactive chart controls', async () => {
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=dom.window;let calls=0;
  w.eval("var activeMarketScope='overview',activeWorkspaceId='overview',currentInstrumentId=null;");
  for(const name of ['markMmPerformanceStage','initTheme','restoreWorkspaceContextFromUrl','renderNavigationState','initializeDashboardCollapses','restoreLastDashboardTab','syncWorkspaceContextUrl','loadNewsTicker','loadMarketOverview','loadResearchBriefing'])w[name]=()=>{};
  w.readInitialMarketScope=()=>'overview';w.waitForDashboardAuthState=async()=>{};w.restoreSharedWorkspaceFromUrl=async()=>{};
  w.renderChartPatternControls=()=>calls++;
  w.eval(hydrateFunction('startDashboard'));
  try{await w.startDashboard();assert.equal(calls,0);}finally{w.close();}
});
test('build defers only the stock chart DOM and preserves the original markup', () => {
  const { deferStockChartMarkup } = require('../scripts/stock-workspace-markup.cjs');
  const output = deferStockChartMarkup(html), dom = new JSDOM(output);
  try {
    assert.equal(dom.window.document.getElementById('stock-kline'), null);
    const template = dom.window.document.getElementById('stock-chart-template');
    assert.ok(template.content.querySelector('#stock-kline'));
    assert.ok(dom.window.document.getElementById('insider-radar'));
    assert.ok(dom.window.document.getElementById('market-timeline-list'));
    assert.ok(dom.window.document.getElementById('macro-indicators'));
    const original = html.slice(html.indexOf('<details class="dash-collapse" data-collapse-key="stocks-market"'), html.indexOf('<details class="dash-collapse" data-collapse-key="stocks-breadth"')).trim();
    assert.ok(output.includes(original), 'no reserialization of original handlers or chart attributes');
    assert.throws(() => deferStockChartMarkup('<html><body></body></html>'), /stocks-market/);
  } finally { dom.window.close(); }
});
test('reinitializing collapse controls after mounting does not attach duplicate toggle listeners', () => {
  const dom = new JSDOM('<div id="stocks-tab" class="active"><details data-collapse-key="stocks-market" class="dash-collapse"></details></div>', { runScripts:'outside-only' });
  const w=dom.window, section=w.document.querySelector('details');let listeners=0;
  const add=section.addEventListener.bind(section);section.addEventListener=(type,...args)=>{if(type==='toggle')listeners++;return add(type,...args);};
  w.readDashboardCollapseState=()=>({});w.writeDashboardCollapseState=()=>{};w.runStockSectionOnce=()=>{};
  try {w.eval(hydrateFunction('initializeDashboardCollapses'));w.initializeDashboardCollapses();w.initializeDashboardCollapses();assert.equal(listeners,1);}finally{dom.window.close();}
});
test('mount is restricted to the stock chart workspace, idempotent, and preserves nodes and preferences', () => {
  const { deferStockChartMarkup } = require('../scripts/stock-workspace-markup.cjs');
  const dom = new JSDOM(deferStockChartMarkup(html), { url:'http://localhost/', runScripts:'outside-only' });
  const w = dom.window, calls = [];
  w.MoneyTradingChart={};w.MoneyChartAnalysis={};
  w.eval("var activeMarketScope='crypto',activeWorkspaceId='crypto-quotes',currentStockKlinePeriod='1d';");
  for (const name of ['initializeDashboardCollapses','renderChartPatternControls','syncStockChartCompanionControls','bindStockChartCompanionSelection']) w[name] = () => calls.push(name);
  w.eval(hydrateFunction());
  try {
    assert.equal(w.mountStockChartWorkspace(), false);
    w.eval("activeMarketScope='stocks';activeWorkspaceId='insider';");
    assert.equal(w.mountStockChartWorkspace(), false);
    w.eval("activeWorkspaceId='stock-quotes';");
    assert.equal(w.mountStockChartWorkspace(), true);
    assert.equal(w.document.querySelector('.stock-kline-period.active').dataset.klinePeriod,'1d','deep-linked period must override the inert markup default');
    const canvas = w.document.getElementById('stock-kline'); canvas.dataset.viewport='saved';
    assert.equal(w.mountStockChartWorkspace(), false);
    assert.equal(w.document.getElementById('stock-kline'), canvas);
    assert.equal(w.document.querySelectorAll('#stock-kline').length, 1);
    assert.equal(canvas.dataset.viewport, 'saved');
    assert.equal(calls.filter(name => name === 'initializeDashboardCollapses').length, 1);
  } finally { dom.window.close(); }
});
