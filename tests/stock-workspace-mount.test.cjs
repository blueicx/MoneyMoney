const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const ts = require('typescript');
const html = fs.readFileSync('src/web/public/index.html', 'utf8');
const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
function hydrateFunction(name = 'mountStockChartWorkspace') {
  const ast = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const node = ast.statements.find(row => ts.isFunctionDeclaration(row) && row.name?.text === name);
  assert.ok(node, 'stock chart workspace needs an explicit mount boundary');
  return source.slice(node.getStart(ast), node.end);
}
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
