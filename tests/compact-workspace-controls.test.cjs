const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const ts = require('typescript');
const runtime = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
const html = fs.readFileSync('src/web/public/index.html', 'utf8');
function loadFunctions(w, names) {
  const ast = ts.createSourceFile('runtime.js', runtime, ts.ScriptTarget.Latest, true);
  for (const name of names) {
    const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    assert.ok(fn, `${name} exists`);
    w.eval(fn.getText(ast));
  }
}
test('stock periods and source status remain visible while historical and layer controls are disclosed', () => {
  const dom = new JSDOM(html), d = dom.window.document;
  try {
    const history = d.querySelector('#stock-chart-history-tools');
    const layers = d.querySelector('#stock-chart-layer-tools');
    assert.ok(history && layers, 'history and layers have separate compact disclosures');
    assert.equal(history.open, false); assert.equal(layers.open, false);
    assert.ok(history.querySelector('[data-chart-as-of]'));
    assert.ok(history.querySelector('[data-chart-candle-date]'));
    assert.ok(history.querySelector('[data-intraday-controls]'));
    assert.ok(layers.querySelector('#stock-chart-overlays'));
    assert.ok(layers.querySelector('[data-chart-strategy="volumeBreakout"]'));
    for (const selector of ['.stock-kline-period', '#stock-chart-data-status', '[data-chart-fullscreen="stocks"]']) {
      assert.equal(d.querySelector(selector).closest('#stock-chart-history-tools, #stock-chart-layer-tools'), null);
    }
    assert.equal(d.querySelectorAll('#stock-chart-overlays').length, 1);
    assert.equal(d.querySelector('[data-chart-overlay="signals"]').checked, true);
  } finally { dom.window.close(); }
});
test('compact navigation retains market and utility callbacks, role boundary and escape focus', () => {
  const dom = new JSDOM('<div id="market-scope-bar"></div><div id="utility-nav-bar"></div>', {runScripts:'outside-only'}), w=dom.window, d=w.document;
  w.eval("var activeMarketScope='stocks',MARKET_SCOPES=[{id:'stocks',label:'股票'},{id:'options',label:'期权'}],UTILITY_NAV_ITEMS=[['backtest','回测']];");
  w.setNavigationMarkup=(host, markup)=>{host.innerHTML=markup;};
  d.body.tabIndex=-1;
  d.addEventListener('keydown', event=>{if(event.key==='Escape')d.body.focus();});
  try {
    loadFunctions(w, ['bindCompactNavigation', 'renderMarketScopeBar', 'renderUtilityNav']);
    w.renderMarketScopeBar(); w.renderUtilityNav();
    assert.equal(d.querySelectorAll('#market-scope-bar > details').length, 2);
    assert.match(d.querySelector('[data-compact-market] > summary').textContent, /股票/);
    assert.match(d.querySelector('[data-market-scope="options"]').getAttribute('onclick'), /setMarketScope/);
    assert.match(d.querySelector('[data-tab="backtest"]').getAttribute('onclick'), /showTab/);
    assert.equal(d.querySelector('#utility-nav-bar').hidden, true);
    const observer=new w.MutationObserver(()=>{});
    observer.observe(d.querySelector('#utility-nav-bar'),{attributes:true});
    w.renderUtilityNav();
    assert.equal(observer.takeRecords().length,0,'unchanged navigation does not rewrite the hidden attribute');
    observer.disconnect();
    const menu = d.querySelector('[data-compact-tools]'); menu.open=true;
    const button=menu.querySelector('button'); button.focus();
    button.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(menu.open,false); assert.equal(d.activeElement,menu.querySelector('summary'));
    menu.open=true; d.body.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true})); assert.equal(menu.open,false);
    menu.open=true; button.click(); assert.equal(menu.open,false);
    w.mm_isGuest=true; w.renderMarketScopeBar();
    assert.equal(d.querySelectorAll('[data-admin-entry]').length,0);
    assert.equal(d.querySelectorAll('[data-market-scope]').length,2);
  } finally { w.close(); }
});
