const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = require('./helpers/dashboard-source.cjs').readDashboardSource();
const { resolveWorkspaceNavigation } = require('../dist/features/market-workspace.js');

function workspace(market, current) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const start = html.indexOf('function scopeAllowsView(');
  const end = html.indexOf('function selectOptionLibraryAsset(', start);
  dom.window.eval(`let activeMarketScope = ${JSON.stringify(market)}; let activeWorkspaceId = ${JSON.stringify(current)}; ${html.slice(start, end)} window.setWorkspaceTestContext = (market, workspace) => { activeMarketScope = market; activeWorkspaceId = workspace; applyMarketScopeView(); applyWorkspaceView(); }; applyMarketScopeView(); applyWorkspaceView();`);
  return dom;
}

test('unselected root workspace panels stay hidden before any script initializes the context', () => {
  const dom=new JSDOM(fs.readFileSync('src/web/public/index.html','utf8'));
  try {
    const panels=[...dom.window.document.querySelectorAll('#center-workspace > [data-workspace-id], #center-workspace > [data-workspace-ids]')].filter(node=>!node.classList.contains('tab-content'));
    assert.equal(panels.length,4,'overview, cards, digest and screener remain in their original DOM');
    for(const node of panels) {
      assert.equal(node.hidden,true,node.id+' must not flash in an unrelated workspace');
      assert.ok(node.classList.contains('workspace-hidden'),node.id+' must override inline display styles too');
    }
  } finally {dom.window.close();}
});

test('all four markets keep dashboard and action summary out of specific workspaces', () => {
  for (const [market, current] of [['stocks','guru-holdings'],['stocks','insider'],['stocks','backtest'],['options','greeks'],['crypto','funding-rate'],['prediction','prediction-radar']]) {
    const dom = workspace(market, current);
    try {
      for (const id of ['market-overview','workspace-dashboard-cards','market-change-digest']) {
        assert.equal(dom.window.document.getElementById(id).hidden, true, `${market}/${current}: ${id} must be hidden`);
      }
      // Reapplying market visibility, as a late API response does, must preserve workspace ownership.
      dom.window.eval('applyMarketScopeView();');
      assert.equal(dom.window.document.getElementById('workspace-dashboard-cards').hidden, true);
    } finally { dom.window.close(); }
  }
});

test('dashboard content restores only on overview and watchlist summary stays scoped', () => {
  const overview = workspace('stocks','overview');
  const watchlist = workspace('watchlist','watchlist');
  try {
    for (const id of ['market-overview','workspace-dashboard-cards','market-change-digest']) assert.equal(overview.window.document.getElementById(id).hidden, false);
    assert.equal(watchlist.window.document.getElementById('market-overview').hidden, true);
    assert.equal(watchlist.window.document.getElementById('workspace-watchlist-panel').hidden, false);
  } finally { overview.window.close(); watchlist.window.close(); }
});

test('every registered non-overview workspace hides unowned legacy panels in mixed market tabs', () => {
  const dom = workspace('overview', 'overview');
  try {
    const probes = ['stocks-tab', 'binance-tab'].map((tabId, index) => {
      const node = dom.window.document.createElement('div');
      node.dataset.workspaceBoundaryProbe = tabId;
      if (index === 1) node.hidden = true;
      dom.window.document.getElementById(tabId).appendChild(node);
      return { node, initiallyHidden: node.hidden };
    });
    const contexts = new Map();
    for (const scope of ['overview', 'stocks', 'options', 'crypto', 'prediction', 'watchlist']) {
      for (const group of resolveWorkspaceNavigation(scope)) {
        for (const item of group.items) contexts.set(`${scope}:${item.id}`, { scope, workspace: item.id });
      }
    }
    for (const workspaceId of ['watchlist', 'positions']) {
      contexts.set(`stocks:${workspaceId}`, { scope: 'stocks', workspace: workspaceId });
    }

    for (const { scope, workspace: workspaceId } of contexts.values()) {
      dom.window.setWorkspaceTestContext(scope, workspaceId);
      for (const { node, initiallyHidden } of probes) {
        assert.equal(node.hidden, workspaceId !== 'overview' || initiallyHidden, `${scope}/${workspaceId} must preserve the original visibility of unowned ${node.dataset.workspaceBoundaryProbe} panels`);
      }
    }
  } finally { dom.window.close(); }
});
test('registered workspace panels are visible only for their market and workspace context', () => {
  const dom = workspace('overview', 'overview');
  try {
    const contexts = new Map();
    for (const scope of ['overview', 'stocks', 'options', 'crypto', 'prediction', 'watchlist']) {
      for (const group of resolveWorkspaceNavigation(scope)) {
        for (const item of group.items) contexts.set(`${scope}:${item.id}`, { scope, workspace: item.id });
      }
      contexts.set(`${scope}:watchlist`, { scope, workspace: 'watchlist' });
      contexts.set(`${scope}:positions`, { scope, workspace: 'positions' });
    }
    const panels = [...contexts.values()].map(({ scope, workspace: workspaceId }, index) => {
      const node = dom.window.document.createElement('section');
      node.dataset.workspaceId = workspaceId;
      node.dataset.marketScopes = scope;
      node.dataset.workspaceProbe = `${scope}-${workspaceId}-${index}`;
      dom.window.document.getElementById('stocks-tab').appendChild(node);
      return { node, scope, workspace: workspaceId };
    });

    for (const { scope, workspace: workspaceId } of contexts.values()) {
      dom.window.setWorkspaceTestContext(scope, workspaceId);
      for (const panel of panels) {
        const expectedVisible = panel.scope === scope && panel.workspace === workspaceId;
        assert.equal(panel.node.hidden, !expectedVisible, `${scope}/${workspaceId}: ${panel.scope}/${panel.workspace} ownership mismatch`);
      }
    }
  } finally { dom.window.close(); }
});
test('research module installs all panels before binding instrument-scoped experiment controls',()=>{
 const dom=workspace('stocks','guru-holdings');const errors=[];dom.window.addEventListener('error',event=>{errors.push(event.error?.message);event.preventDefault();});dom.window.mm_isLoggedIn=true;dom.window.mm_isGuest=false;
 dom.window.eval(fs.readFileSync('src/web/public/action-research-workspace.js','utf8'));dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
 assert.deepEqual(errors,[]);assert.ok(dom.window.document.getElementById('mm-experiment-all'));assert.equal(dom.window.document.getElementById('mm-research-lab').hidden,true);dom.window.close();
});
