const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('src/web/public/index.html', 'utf8');

function workspace(market, current) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const start = html.indexOf('function scopeAllowsView(');
  const end = html.indexOf('function selectOptionLibraryAsset(', start);
  dom.window.eval(`let activeMarketScope = ${JSON.stringify(market)}; let activeWorkspaceId = ${JSON.stringify(current)}; ${html.slice(start, end)} applyMarketScopeView(); applyWorkspaceView();`);
  return dom;
}

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
test('research module installs all panels before binding instrument-scoped experiment controls',()=>{
 const dom=workspace('stocks','guru-holdings');const errors=[];dom.window.addEventListener('error',event=>{errors.push(event.error?.message);event.preventDefault();});dom.window.mm_isLoggedIn=true;dom.window.mm_isGuest=false;
 dom.window.eval(fs.readFileSync('src/web/public/action-research-workspace.js','utf8'));dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
 assert.deepEqual(errors,[]);assert.ok(dom.window.document.getElementById('mm-experiment-all'));assert.equal(dom.window.document.getElementById('mm-research-lab').hidden,true);dom.window.close();
});
