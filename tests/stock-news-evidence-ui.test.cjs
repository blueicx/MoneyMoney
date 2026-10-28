const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('research evidence panel explicitly captures and renders per-item stock news evidence', async () => {
  const dom = new JSDOM(
    '<div id="market-workspace-shell" data-workspace="research-lab" data-market-scope="stocks"><div id="mm-research-lab"></div></div>',
    { url: 'http://localhost/', runScripts: 'outside-only' },
  );
  const w = dom.window;
  const calls = [];
  Object.defineProperty(w.document, 'hidden', { value: false });
  w.mm_isLoggedIn = true;
  w.mm_isGuest = false;
  w.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    let body;
    if (String(url).startsWith('/api/research/projects?')) {
      body = { success: true, data: [{ id: 'project-1', title: 'Saved project', version: 1 }] };
    } else if (String(url) === '/api/evidence/stock-news') {
      body = {
        success: true,
        reason: '已冻结明确股票新闻响应',
        data: {
          responseStatus: 'live',
          responseContentHash: 'a'.repeat(64),
          evidence: [{
            id: 'news_fixture',
            title: 'Apple update',
            observedAt: '2026-01-02T10:00:00.000Z',
            fetchedAt: '2026-01-02T10:03:00.000Z',
            hash: 'b'.repeat(64),
            fields: { title: 'Apple update' },
          }],
        },
      };
    } else {
      throw new Error('unexpected request ' + url);
    }
    return { ok: true, json: async () => body };
  };
  try {
    w.eval(fs.readFileSync('src/web/public/research-evidence-governance-workspace.js', 'utf8'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const root = w.document.querySelector('[data-research-evidence-governance]');
    assert.ok(root);
    root.open = true;
    root.dispatchEvent(new w.Event('toggle'));
    await new Promise(resolve => setTimeout(resolve, 20));
    root.querySelector('[data-project]').value = 'project-1';
    root.querySelector('[data-instrument]').value = 'stock:us:AAPL';
    root.querySelector('[data-news-capture]').click();
    await new Promise(resolve => setTimeout(resolve, 20));

    const call = calls.find(row => row.url === '/api/evidence/stock-news');
    assert.equal(call.options.method, 'POST');
    assert.deepEqual(JSON.parse(call.options.body), { instrument: 'stock:us:AAPL', symbol: 'AAPL' });
    assert.match(root.querySelector('[data-output]').textContent, /Apple update/);
    assert.match(root.querySelector('[data-output]').textContent, /2026-01-02T10:03:00.000Z/);
    assert.match(root.querySelector('[data-status]').textContent, /已冻结/);
  } finally {
    dom.window.close();
  }
});
