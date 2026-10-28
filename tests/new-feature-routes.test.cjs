const test = require('node:test'), assert = require('node:assert/strict'), express = require('express');
require('ts-node/register/transpile-only');
const { createResearchTemplateRouter } = require('../src/web/research-template-routes');
const { createReportScheduleRouter } = require('../src/web/report-schedule-routes');
const { createAnalysisPreviewRouter } = require('../src/web/analysis-preview-routes');

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { await run(base); } finally { await new Promise(resolve => server.close(resolve)); }
}

function appWith(routerFactory, mount) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { role: req.headers['x-test-role'] || 'guest' }; next(); });
  app.use(mount, routerFactory({
    adminOnly: (req, res) => {
      if (req.user?.role === 'admin') return true;
      res.status(403).json({ success: false, reason: 'denied' });
      return false;
    },
    csrfValid: req => req.headers['x-test-csrf'] === 'valid',
    listSignals: (market) => [{ id: 's1', strategyId: 'momentum', market, instrument: 'stock:us:AAA', action: 'BUY', triggeredAt: Date.now() - 1000, evidenceRefs: ['e1'] }],
  }));
  return app;
}

test('template routes list catalog and require admin plus csrf for checklist', async () => {
  const app = appWith(deps => createResearchTemplateRouter(deps), '/api/research/templates');
  await withServer(app, async base => {
    assert.equal((await fetch(base + '/api/research/templates')).status, 403);
    const headers = { 'x-test-role': 'admin' };
    const list = await (await fetch(base + '/api/research/templates?market=stocks', { headers })).json();
    assert.ok(list.data.every(row => row.market === 'stocks'));
    assert.equal((await fetch(base + '/api/research/templates/factor-validation@1', { headers })).status, 200);
    assert.equal((await fetch(base + '/api/research/templates/nope', { headers })).status, 404);
    const noCsrf = await fetch(base + '/api/research/templates/factor-validation/checklist', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ completed: [] }) });
    assert.equal(noCsrf.status, 403);
    const ok = await fetch(base + '/api/research/templates/factor-validation/checklist', { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'x-test-csrf': 'valid' }, body: JSON.stringify({ completed: ['universe-as-of'] }) });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).status, 'missing');
  });
});

test('report schedule routes delegate to the store with auth checks', async () => {
  const calls = [];
  const fakeStore = {
    list: () => [{ id: 'report_schedule_00000000-0000-0000-0000-000000000001' }],
    get: id => ({ id }),
    create: input => { calls.push(['create', input]); return { id: 'created', ...input }; },
    update: (id, version, patch) => ({ id, version: version + 1, ...patch }),
    remove: (id, version) => ({ id, deleted: true, version: version + 1 }),
    preview: id => ({ id, due: true, window: '2026-10-28:daily', timezone: 'Asia/Shanghai', wouldWrite: true }),
    runDue: () => ({ generated: [], skipped: [], failed: [] }),
  };
  const app = appWith(deps => createReportScheduleRouter(fakeStore, deps), '/api/report-schedules');
  await withServer(app, async base => {
    assert.equal((await fetch(base + '/api/report-schedules')).status, 403);
    const headers = { 'x-test-role': 'admin', 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/api/report-schedules', { method: 'POST', headers, body: JSON.stringify({ projectId: 'project_00000000-0000-0000-0000-000000000001' }) })).status, 403);
    const created = await fetch(base + '/api/report-schedules', { method: 'POST', headers: { ...headers, 'x-test-csrf': 'valid' }, body: JSON.stringify({ projectId: 'project_00000000-0000-0000-0000-000000000001', linkIds: ['a', 'b'], cadence: 'daily', timeOfDay: '09:00', requestId: 'request-id-0000001' }) });
    assert.equal(created.status, 201);
    assert.equal(calls.length, 1);
    assert.equal((await fetch(base + '/api/report-schedules/run-due', { method: 'POST', headers: { ...headers, 'x-test-csrf': 'valid' }, body: '{}' })).status, 200);
    assert.equal((await fetch(base + '/api/report-schedules/x', { method: 'PATCH', headers: { ...headers, 'x-test-csrf': 'valid' }, body: JSON.stringify({ expectedVersion: 1, enabled: false }) })).status, 200);
    assert.equal((await fetch(base + '/api/report-schedules/x', { method: 'DELETE', headers: { ...headers, 'x-test-csrf': 'valid' }, body: JSON.stringify({ expectedVersion: 1 }) })).status, 200);
  });
});

test('signal board route reads saved signals only', async () => {
  const app = appWith(deps => createAnalysisPreviewRouter(deps), '/api/analysis');
  await withServer(app, async base => {
    assert.equal((await fetch(base + '/api/analysis/signals?market=stocks')).status, 403);
    const response = await fetch(base + '/api/analysis/signals?market=stocks&instrument=stock:us:AAA', { headers: { 'x-test-role': 'admin' } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0].longs, 1);
    assert.equal((await fetch(base + '/api/analysis/signals?market=bonds', { headers: { 'x-test-role': 'admin' } })).status, 400);
  });
});
