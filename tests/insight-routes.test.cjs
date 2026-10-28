const test = require('node:test'), assert = require('node:assert/strict'), express = require('express');
require('ts-node/register/transpile-only');
const { createInsightRouter } = require('../src/web/insight-routes');

const now = Date.parse('2026-10-28T00:00:00Z');
const docs = [
  { id: 'p1', type: 'project', market: 'stocks', title: 'AAPL 动量研究', text: '12 个月动量', updatedAt: '2026-10-27T00:00:00Z', projectId: 'p1', ownerAdmin: true },
];

async function withServer(run) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { role: req.headers['x-test-role'] || 'guest' }; next(); });
  app.use('/api', createInsightRouter({
    adminOnly: (req, res) => {
      if (req.user?.role === 'admin') return true;
      res.status(403).json({ success: false, reason: 'denied' });
      return false;
    },
    gapRows: () => [{ id: 'gap-1', market: 'stocks', instrument: 'stock:us:AAPL', source: 'lake', kind: 'partition', coverage: 'partial', reason: 'unreadable partition', observedAt: '2026-10-27T00:00:00Z' }],
    searchDocuments: () => docs,
    auditEntries: () => [{ id: 'a1', at: '2026-10-27T00:00:00Z', action: 'research-project-created', detail: JSON.stringify({ projectId: 'p1' }) }],
    sourceObservations: () => [
      { sourceId: 'alpha', sourceName: 'Alpha', market: 'stocks', at: '2026-10-27T23:00:00Z', ok: true, latencyMs: 100, reason: null },
      { sourceId: 'alpha', sourceName: 'Alpha', market: 'stocks', at: '2026-10-27T23:10:00Z', ok: true, latencyMs: 120, reason: null },
      { sourceId: 'alpha', sourceName: 'Alpha', market: 'stocks', at: '2026-10-27T23:20:00Z', ok: true, latencyMs: 140, reason: null },
    ],
    now: () => now,
  }));
  app.use('/api', (_req, res) => res.json({ passthrough: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { await run(base); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('methodology catalog is readable by guests while private insights stay admin-only', async () => {
  await withServer(async base => {
    const methodology = await fetch(base + '/api/methodology');
    assert.equal(methodology.status, 200);
    const body = await methodology.json();
    assert.ok(body.data.some(entry => entry.id === 'kelly-sizing'));
    assert.equal((await fetch(base + '/api/methodology/kelly-sizing@1')).status, 200);
    assert.equal((await fetch(base + '/api/methodology/not-real')).status, 404);
    assert.equal((await fetch(base + '/api/evidence-gaps')).status, 403);
    assert.equal((await fetch(base + '/api/evidence-gaps', { headers: { 'x-test-role': 'admin' } })).status, 200);
  });
});

test('evidence gaps, search, audit and health return admin-only payloads', async () => {
  await withServer(async base => {
    const headers = { 'x-test-role': 'admin' };
    const gaps = await (await fetch(base + '/api/evidence-gaps', { headers })).json();
    assert.equal(gaps.total, 1);
    assert.equal(gaps.byCoverage.partial, 1);
    const csv = await fetch(base + '/api/evidence-gaps?format=csv', { headers });
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    const search = await (await fetch(base + '/api/workspace/search?q=aapl', { headers })).json();
    assert.equal(search.total, 1);
    assert.equal(search.hits[0].id, 'p1');
    const audit = await (await fetch(base + '/api/audit/timeline', { headers })).json();
    assert.equal(audit.events[0].category, 'research');
    const health = await (await fetch(base + '/api/source-health/dashboard?windowDays=1', { headers })).json();
    assert.equal(health.sources[0].status, 'live');
  });
});

test('query errors stay explicit', async () => {
  await withServer(async base => {
    const headers = { 'x-test-role': 'admin' };
    assert.equal((await fetch(base + '/api/workspace/search?q=', { headers })).status, 400);
    assert.equal((await fetch(base + '/api/audit/timeline?category=bogus', { headers })).status, 400);
    assert.equal((await fetch(base + '/api/source-health/dashboard?windowDays=99', { headers })).status, 400);
  });
});

test('the insight router leaves unrelated api paths untouched', async () => {
  await withServer(async base => {
    const response = await fetch(base + '/api/open-read');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).passthrough, true);
  });
});
