const test = require('node:test'), assert = require('node:assert/strict'), express = require('express');
require('ts-node/register/transpile-only');
const { createAnalysisPreviewRouter } = require('../src/web/analysis-preview-routes');

const evidence = {
  market: 'stocks', instrument: 'stock:us:AAPL', kind: 'backtest', source: 'fixture',
  publishedAt: '2026-01-01T00:00:00Z', observedAt: '2026-01-01T00:00:01Z', fetchedAt: '2026-01-01T00:00:02Z',
  contentHash: 'a'.repeat(64), coverage: 'complete', unknownReason: null,
};

async function withServer(run) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { role: req.headers['x-test-role'] || 'guest' }; next(); });
  app.use('/api/analysis', createAnalysisPreviewRouter({
    adminOnly: (req, res) => {
      if (req.user?.role === 'admin') return true;
      res.status(403).json({ success: false, reason: 'denied' });
      return false;
    },
    csrfValid: req => req.headers['x-test-csrf'] === 'valid',
  }));
  app.use('/api/analysis', (_req, res) => res.json({ passthrough: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { await run(base); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('analysis previews require admin and CSRF', async () => {
  await withServer(async base => {
    const payload = { stats: { kind: 'backtest', evidence, samples: 100, winRate: 0.6, payoffRatio: 1.5 }, bankroll: 1000, currency: 'USD' };
    const guest = await fetch(base + '/api/analysis/position-sizing/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal(guest.status, 403);
    const noCsrf = await fetch(base + '/api/analysis/position-sizing/preview', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-role': 'admin' }, body: JSON.stringify(payload) });
    assert.equal(noCsrf.status, 403);
    const ok = await fetch(base + '/api/analysis/position-sizing/preview', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-role': 'admin', 'x-test-csrf': 'valid' }, body: JSON.stringify(payload) });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.dataStatus, 'ready');
    assert.equal(body.noExecution, true);
  });
});

test('the analysis router does not gate the pre-existing /api/analysis route', async () => {
  await withServer(async base => {
    const response = await fetch(base + '/api/analysis');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).passthrough, true);
  });
});

test('analysis previews reject extra fields and serve correlation csv', async () => {
  await withServer(async base => {
    const headers = { 'content-type': 'application/json', 'x-test-role': 'admin', 'x-test-csrf': 'valid' };
    const extra = await fetch(base + '/api/analysis/position-sizing/preview', { method: 'POST', headers, body: JSON.stringify({ bogus: 1 }) });
    assert.equal(extra.status, 400);
    const series = [
      { instrument: 'stock:us:AAA', evidence: { ...evidence, instrument: 'stock:us:AAA' }, points: [{ t: 1000, v: 100 }, { t: 2000, v: 110 }, { t: 3000, v: 100 }, { t: 4000, v: 105 }, { t: 5000, v: 115 }] },
      { instrument: 'stock:us:BBB', evidence: { ...evidence, instrument: 'stock:us:BBB' }, points: [{ t: 1000, v: 200 }, { t: 2000, v: 190 }, { t: 3000, v: 205 }, { t: 4000, v: 195 }, { t: 5000, v: 210 }] },
    ];
    const csv = await fetch(base + '/api/analysis/correlation-matrix/preview', { method: 'POST', headers, body: JSON.stringify({ series, minSamples: 4, format: 'csv' }) });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    const text = await csv.text();
    assert.match(text, /stock:us:AAA,stock:us:BBB/);
  });
});
