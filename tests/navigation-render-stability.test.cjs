const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
const ast = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, true);
function declaration(name) {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  return node ? source.slice(node.getStart(ast), node.end) : '';
}
function fixture() {
  const dom = new JSDOM('<div id="workspace-sidebar-content"></div><div id="workspace-drawer-content"></div><div id="market-scope-bar"></div><div id="utility-nav-bar"></div><div id="core-workspace-nav"></div><div id="mobile-nav"></div>', {runScripts:'outside-only'});
  const w = dom.window;
  w.eval(`var navigationMarkupCache = new WeakMap(); var activeWorkspaceId='stock-quotes'; var activeMarketScope='stocks';
    var MARKET_SCOPES=[{id:'stocks',label:'股票'},{id:'crypto',label:'虚拟币'}];
    var UTILITY_NAV_ITEMS=[['news','新闻']];var CORE_NAV_ITEMS=[['paper','模拟盘'],['radar','雷达']];var GUEST_ADMIN_TABS=new Set(['paper']);`);
  w.marketResearchEscape = value => String(value);
  w.marketRadarTab = () => 'stocks';w.marketRadarLabel=()=>'股票雷达';
  for(const name of ['setNavigationMarkup','workspaceMenuMarkup','renderWorkspaceMenu','bindCompactNavigation','renderMarketScopeBar','renderUtilityNav','renderCoreNav'])w.eval(declaration(name));
  return dom;
}
test('unchanged navigation preserves DOM nodes and focused controls without repeat mutations', () => {
  const dom=fixture(),w=dom.window;
  const groups=[{id:'market',label:'市场',items:[{id:'stock-quotes',icon:'X',label:'行情'}]}];
  const render=()=>{w.renderWorkspaceMenu(groups);w.renderMarketScopeBar();w.renderUtilityNav();w.renderCoreNav();};
  try {
    render();const nodes=[...w.document.querySelectorAll('button')];nodes[0].focus();
    const observer=new w.MutationObserver(()=>{});observer.observe(w.document.body,{subtree:true,childList:true});
    render();render();
    assert.ok(nodes.every((node,index)=>w.document.querySelectorAll('button')[index]===node));
    assert.equal(w.document.activeElement,nodes[0]);
    assert.equal(observer.takeRecords().length,0);
    observer.disconnect();
  }finally{w.close();}
});
test('market, selection and role changes still update navigation, and cleared hosts recover', () => {
  const dom=fixture(),w=dom.window;
  const groups=[{id:'market',label:'市场',items:[{id:'stock-quotes',icon:'X',label:'行情'},{id:'events',icon:'Y',label:'事件'}]}];
  try {
    w.renderWorkspaceMenu(groups);w.eval("activeWorkspaceId='events';activeMarketScope='crypto';");
    w.renderWorkspaceMenu(groups);w.renderMarketScopeBar();
    assert.equal(w.document.querySelector('.workspace-item.active').dataset.workspaceId,'events');
    assert.equal(w.document.querySelector('.market-scope-btn.active').dataset.marketScope,'crypto');
    w.mm_isGuest=false;w.renderCoreNav();assert.ok(w.document.querySelector('#core-workspace-nav [data-tab="paper"]'));
    w.mm_isGuest=true;w.renderCoreNav();w.renderMarketScopeBar();
    assert.equal(w.document.querySelector('#core-workspace-nav [data-tab="paper"]'),null);
    assert.equal(w.document.querySelector('[data-admin-entry]'),null);
    w.document.getElementById('workspace-sidebar-content').replaceChildren();w.renderWorkspaceMenu(groups);
    assert.equal(w.document.querySelectorAll('#workspace-sidebar-content button').length,2);
  }finally{w.close();}
});

test('navigation applies workspace visibility once through the market scope guard', () => {
  const dom=fixture(),w=dom.window;let calls=0;
  for(const name of ['mountStockChartWorkspace','ensureMacroWorkspace','renderMarketScopeBar','renderUtilityNav','renderCoreNav','renderWorkspaceSidebar','loadWorkspaceDashboardCards','applySidebarScope'])w[name]=()=>{};
  w.applyWorkspaceView=()=>calls++;w.applyMarketScopeView=()=>w.applyWorkspaceView();
  w.eval(declaration('renderNavigationState'));
  try{w.renderNavigationState();assert.equal(calls,1);}finally{w.close();}
});

test('unchanged visibility does not reassign hidden, open, workspace or text attributes', () => {
  const dom=fixture(),w=dom.window;
  w.document.body.insertAdjacentHTML('beforeend','<div id="market-workspace-shell"></div><div id="stocks-tab"><div class="section-title"></div><details class="dash-collapse" data-market-scopes="stocks" data-workspace-id="stock-quotes"></details><details class="dash-collapse" data-market-scopes="crypto" data-workspace-id="events" open></details><div id="market-scope-empty"></div><div data-legacy>Legacy panel</div></div><div id="binance-tab"></div>');
  w.eval('var legacyWorkspaceVisibility=new WeakMap();');
  for(const name of ['scopeAllowsView','workspaceIdsForNode','workspaceAllowsView','applyWorkspaceView','applyMarketScopeView'])w.eval(declaration(name));
  try{
    w.applyMarketScopeView();
    const observer=new w.MutationObserver(()=>{});observer.observe(w.document.body,{subtree:true,attributes:true,childList:true});
    w.applyMarketScopeView();w.applyWorkspaceView();
    assert.equal(observer.takeRecords().length,0);
    observer.disconnect();
    w.eval("activeWorkspaceId='events';activeMarketScope='crypto';");w.applyMarketScopeView();
    assert.equal(w.document.querySelector('[data-workspace-id="stock-quotes"][data-market-scopes]').hidden,true);
    assert.equal(w.document.querySelector('[data-workspace-id="events"][data-market-scopes]').hidden,false);
  }finally{w.close();}
});
