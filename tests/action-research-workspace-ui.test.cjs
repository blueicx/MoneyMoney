const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = require('./helpers/dashboard-source.cjs').readDashboardSource();

function workspace() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const start = html.indexOf('function scopeAllowsView(');
  const end = html.indexOf('function selectOptionLibraryAsset(', start);
  dom.window.eval(`let activeMarketScope = 'stocks'; let activeWorkspaceId = 'action-center'; ${html.slice(start, end)} window.setWorkspaceTestContext = (market, workspace) => { activeMarketScope = market; activeWorkspaceId = workspace; applyMarketScopeView(); applyWorkspaceView(); }; applyMarketScopeView(); applyWorkspaceView();`);
  const shell = dom.window.document.getElementById('market-workspace-shell');
  shell.dataset.marketScope = 'stocks';
  shell.dataset.workspace = 'action-center';
  return dom;
}

test('action-center shows review coverage and opens the existing review queue for the active market', async () => {
  const dom = workspace(), w = dom.window, calls = [];
  w.mm_isLoggedIn = true;
  w.mm_isGuest = false;
  w.fetch = async url => {
    calls.push(String(url));
    if (String(url).startsWith('/api/watchlist/action-center')) return { ok: true, json: async () => ({ success: true, items: [], operations: [], counts: { unread: 0 }, dataStatus: 'partial', updatedAt: '2026-10-27T00:00:00.000Z', reviewCoverage: { total: 7, shown: 4, hasMore: true, queuePath: 'javascript:alert(1)' } }) };
    if (String(url).startsWith('/api/research/review-queue?')) return { ok: true, json: async () => ({ success: true, items: [{ id: 'rq_item', title: 'Saved review', kind: 'source-recheck', version: 'v1' }], lifecycle: {}, pagination: { total: 7, offset: 0, limit: 50, nextOffset: 1, hasMore: true } }) };
    throw new Error('unexpected request: ' + url);
  };
  try {
    w.eval(fs.readFileSync('src/web/public/action-research-workspace.js', 'utf8'));
    w.eval(fs.readFileSync('src/web/public/review-queue-workspace.js', 'utf8'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    w.document.getElementById('mm-action-refresh').click();
    await new Promise(resolve => setTimeout(resolve, 20));

    const coverage = w.document.querySelector('[data-review-coverage]');
    assert.ok(coverage, 'coverage summary should be rendered');
    assert.match(coverage.textContent, /4\s*\/\s*7/);
    assert.match(coverage.textContent, /行动卡片候选：4\s*\/\s*7/);
    assert.doesNotMatch(coverage.textContent, /有行动时间证据|已纳入行动卡片/);
    assert.doesNotMatch(coverage.textContent, /\/api\/research\/review-queue/);
    const openQueue = coverage.querySelector('button');
    assert.ok(openQueue, 'partial coverage should provide a queue button');
    openQueue.click();
    await new Promise(resolve => setTimeout(resolve, 20));

    const queue = w.document.querySelector('[data-review-lifecycle]');
    assert.equal(queue.open, true);
    assert.match(queue.textContent, /Saved review/);
    assert.ok(calls.some(url => url.startsWith('/api/research/review-queue?market=stocks')));
  } finally { w.close(); }
});

test('changing market clears old review coverage immediately and a late response cannot restore it', async () => {
  const dom = workspace(), w = dom.window;
  w.mm_isLoggedIn = true;
  w.mm_isGuest = false;
  const stock = { success: true, items: [], operations: [], counts: { unread: 0 }, dataStatus: 'partial', updatedAt: '2026-10-27T00:00:00.000Z', reviewCoverage: { total: 7, shown: 4, hasMore: true } };
  w.fetch = async () => ({ ok: true, json: async () => stock });
  try {
    w.eval(fs.readFileSync('src/web/public/action-research-workspace.js', 'utf8'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    w.document.getElementById('mm-action-refresh').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(w.document.querySelector('[data-review-coverage]').hidden, false);

    let resolvePending;
    w.fetch = () => new Promise(resolve => { resolvePending = resolve; });
    w.document.getElementById('mm-action-refresh').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(typeof resolvePending, 'function');
    assert.equal(w.document.querySelector('[data-review-coverage]').hidden, false, 'same-market refresh keeps the current coverage until replacement data arrives');
    const shell = w.document.getElementById('market-workspace-shell');
    w.setWorkspaceTestContext('crypto', 'action-center');
    shell.dataset.marketScope = 'crypto';
    w.dispatchEvent(new w.Event('mm-workspace-context'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(w.document.querySelector('[data-review-coverage]').hidden, true);
    assert.equal(w.document.querySelector('[data-review-coverage]').childElementCount, 0);

    resolvePending({ ok: true, json: async () => stock });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(w.document.querySelector('[data-review-coverage]').hidden, true);
    assert.equal(w.document.querySelector('[data-review-coverage]').childElementCount, 0);
  } finally { w.close(); }
});

test('action-center hides malformed or absent review coverage from older responses', async () => {
  const dom = workspace(), w = dom.window;
  w.mm_isLoggedIn = true;
  w.mm_isGuest = false;
  let response = { success: true, items: [], operations: [], counts: { unread: 0 }, dataStatus: 'cached', updatedAt: '2026-10-27T00:00:00.000Z' };
  w.fetch = async () => ({ ok: true, json: async () => response });
  try {
    w.eval(fs.readFileSync('src/web/public/action-research-workspace.js', 'utf8'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    w.document.getElementById('mm-action-refresh').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(w.document.querySelector('[data-review-coverage]').hidden, true);

    response = { ...response, reviewCoverage: { total: '<img src=x>', shown: 1, hasMore: true, queuePath: 'javascript:alert(1)' } };
    w.document.getElementById('mm-action-refresh').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(w.document.querySelector('[data-review-coverage]').hidden, true);
    assert.equal(w.document.querySelector('[data-review-coverage]').childElementCount, 0);

    response = { ...response, reviewCoverage: { total: 2, shown: 1, hasMore: true } };
    w.document.getElementById('mm-action-refresh').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(w.document.querySelector('[data-review-coverage]').hidden, false);
    w.fetch = async () => ({ ok: false, status: 503, json: async () => ({ success: false, reason: 'temporary failure' }) });
    w.document.getElementById('mm-action-refresh').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(w.document.querySelector('[data-review-coverage]').hidden, true);
    assert.match(w.document.getElementById('mm-action-status').textContent, /temporary failure/);
  } finally { w.close(); }
});
