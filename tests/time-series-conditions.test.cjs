const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');
require('ts-node/register/transpile-only');

const now = '2026-10-28T12:00:00.000Z';

function evidence(stage, at, index) {
  const { createEvidenceSnapshot } = require('../src/features/decision-intelligence');
  return createEvidenceSnapshot({
    market: 'stocks',
    instrument: 'stock:us:AAPL',
    workspace: 'event-intelligence',
    dataStatus: 'historical',
    source: { id: 'time-series-fixture', name: 'Saved event fixture' },
    observedAt: at,
    fetchedAt: at,
    fields: { stage, magnitude: index },
  });
}

function input(events, requestId = 'condition-preview-0001') {
  return {
    market: 'stocks',
    instrument: 'stock:us:AAPL',
    name: 'A 后出现 B 且窗口内没有 C',
    asOf: now,
    requestId,
    evidenceIds: events.map(row => row.id),
    maxSpanMs: 45 * 60_000,
    steps: [
      { id: 'a', label: '阶段 A', predicate: { field: 'stage', operator: 'eq', value: 'A' } },
      {
        id: 'b',
        label: '阶段 B',
        afterPreviousMs: 5 * 60_000,
        withinPreviousMs: 20 * 60_000,
        predicate: { field: 'stage', operator: 'eq', value: 'B' },
      },
    ],
    exclusions: [{
      id: 'not-c',
      label: '窗口内不得出现 C',
      afterStepId: 'b',
      withinMs: 15 * 60_000,
      predicate: { field: 'stage', operator: 'eq', value: 'C' },
    }],
  };
}

function stateFixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-time-series-condition-'));
  const { SQLiteStateStore } = require('../src/storage/sqlite-state');
  const state = new SQLiteStateStore(path.join(dir, 'state.sqlite'), dir);
  return Promise.resolve(fn(state, dir)).finally(() => {
    state.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('ordered sequence reports hits and exclusion misses with observed evidence windows', () => {
  const { evaluateTimeSeriesSequence } = require('../src/features/time-series-conditions');
  const a = evidence('A', '2026-10-28T10:00:00.000Z', 1);
  const b = evidence('B', '2026-10-28T10:10:00.000Z', 2);
  const c = evidence('C', '2026-10-28T10:20:00.000Z', 3);
  const laterA = evidence('A', '2026-10-28T11:00:00.000Z', 4);
  const laterB = evidence('B', '2026-10-28T11:08:00.000Z', 5);
  const result = evaluateTimeSeriesSequence(input([a, laterA, c, b, laterB]), [a, laterA, c, b, laterB]);
  assert.equal(result.status, 'calculated');
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].steps.map(step => step.stepId).join(','), 'a,b');
  assert.deepEqual(result.hits[0].evidenceIds, [laterA.id, laterB.id]);
  assert.equal(result.misses.length, 1);
  assert.equal(result.misses[0].startEvidenceId, a.id);
  assert.match(result.misses[0].reason, /排除条件.*not-c/);
  assert.equal(result.ordersCreated, 0);
  assert.equal(result.modelCalls, 0);
});

test('sequence evaluation rejects cross-market, future-fetched and out-of-order windows', () => {
  const { evaluateTimeSeriesSequence } = require('../src/features/time-series-conditions');
  const { createEvidenceSnapshot } = require('../src/features/decision-intelligence');
  const a = evidence('A', '2026-10-28T10:00:00.000Z', 1);
  const b = evidence('B', '2026-10-28T10:20:00.000Z', 2);
  const wrongMarket = createEvidenceSnapshot({
    id: 'ev_cross_market',
    market: 'crypto',
    instrument: 'crypto:binance:BTCUSDT',
    workspace: 'event-intelligence',
    dataStatus: 'historical',
    source: { id: 'time-series-fixture', name: 'Saved event fixture' },
    observedAt: '2026-10-28T10:20:00.000Z',
    fetchedAt: '2026-10-28T10:20:00.000Z',
    fields: { stage: 'B', magnitude: 2 },
  });
  assert.throws(() => evaluateTimeSeriesSequence(input([a, wrongMarket]), [a, wrongMarket]), /市场/);
  const future = createEvidenceSnapshot({
    id: 'ev_future_fetch',
    market: 'stocks',
    instrument: 'stock:us:AAPL',
    workspace: 'event-intelligence',
    dataStatus: 'historical',
    source: { id: 'time-series-fixture', name: 'Saved event fixture' },
    observedAt: '2026-10-28T10:20:00.000Z',
    fetchedAt: '2026-10-28T13:00:00.000Z',
    fields: { stage: 'B', magnitude: 2 },
  });
  assert.throws(() => evaluateTimeSeriesSequence(input([a, future]), [a, future]), /晚于规则截止时间/);
  const lateB = evidence('B', '2026-10-28T10:30:00.000Z', 3);
  const result = evaluateTimeSeriesSequence(input([a, lateB]), [a, lateB]);
  assert.equal(result.hits.length, 0);
  assert.match(result.misses[0].reason, /时间窗口/);
});

test('condition store persists preview, confirmation and runs idempotently with verifiable hashes', async () => {
  await stateFixture(async state => {
    const a = evidence('A', '2026-10-28T10:00:00.000Z', 1);
    const b = evidence('B', '2026-10-28T10:10:00.000Z', 2);
    const rows = new Map([[a.id, a], [b.id, b]]);
    const { TimeSeriesConditionStore } = require('../src/features/time-series-conditions');
    const store = new TimeSeriesConditionStore(state, id => rows.get(id) || null, () => Date.parse(now));
    const preview = store.preview(input([a, b]));
    assert.equal(preview.status, 'preview');
    assert.equal(preview.version, 0);
    assert.deepEqual(store.preview(input([a, b])), preview);
    assert.throws(() => store.preview(input([b, a], 'condition-preview-0001')), /幂等键.*不同/);
    const confirmed = store.confirm(preview.id, {
      expectedVersion: preview.version,
      contentHash: preview.contentHash,
      acknowledge: true,
      confirmationKey: 'condition-confirm-0001',
    });
    assert.equal(confirmed.status, 'confirmed');
    const runInput = {
      expectedVersion: confirmed.version,
      contentHash: confirmed.contentHash,
      runKey: 'condition-run-0001',
    };
    const run = store.run(confirmed.id, runInput);
    assert.equal(run.status, 'calculated');
    assert.equal(run.hits.length, 1);
    assert.deepEqual(store.run(confirmed.id, runInput), run);
    assert.throws(() => store.run(confirmed.id, { ...runInput, contentHash: 'f'.repeat(64) }), /幂等键.*不同/);
    const raw = state.get('time-series-condition:' + confirmed.id);
    raw.result.reason = 'tampered';
    state.set('time-series-condition:' + confirmed.id, raw);
    assert.throws(() => store.get(confirmed.id), /Hash不可核验/);
  });
});

test('explicit hit promotion links a fixed condition hit to a research project and is idempotent', async () => {
  await stateFixture(async state => {
    const a = evidence('A', '2026-10-28T10:00:00.000Z', 1);
    const b = evidence('B', '2026-10-28T10:10:00.000Z', 2);
    const rows = new Map([[a.id, a], [b.id, b]]);
    const { TimeSeriesConditionStore } = require('../src/features/time-series-conditions');
    const store = new TimeSeriesConditionStore(state, id => rows.get(id) || null, () => Date.parse(now));
    const preview = store.preview(input([a, b]));
    const confirmed = store.confirm(preview.id, { expectedVersion: 0, contentHash: preview.contentHash, acknowledge: true, confirmationKey: 'condition-confirm-link-0001' });
    const run = store.run(confirmed.id, { expectedVersion: confirmed.version, contentHash: confirmed.contentHash, runKey: 'condition-run-link-0001' });
    const calls = [];
    const projects = {
      link(projectId, version, reference) {
        calls.push({ projectId, version, reference });
        return { id: projectId, version: version + 1 };
      },
    };
    const linked = store.linkHit(confirmed.id, run.hits[0].id, {
      expectedVersion: store.get(confirmed.id).version,
      projectId: 'project_11111111-1111-4111-8111-111111111111',
      projectVersion: 3,
      linkKey: 'condition-link-0001',
    }, projects);
    assert.equal(linked.hit.linkedProjectId, 'project_11111111-1111-4111-8111-111111111111');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].reference.kind, 'condition-hit');
    assert.equal(calls[0].reference.id, linked.hit.id);
    assert.deepEqual(store.linkHit(confirmed.id, run.hits[0].id, {
      expectedVersion: store.get(confirmed.id).version,
      projectId: 'project_11111111-1111-4111-8111-111111111111',
      projectVersion: 3,
      linkKey: 'condition-link-0001',
    }, projects), linked);
    assert.equal(calls.length, 1);
  });
});

test('condition API requires admin, CSRF, If-Match and idempotency while keeping evidence reads read-only', async () => {
  await stateFixture(async state => {
    const a = evidence('A', '2026-10-28T10:00:00.000Z', 1);
    const b = evidence('B', '2026-10-28T10:10:00.000Z', 2);
    const rows = new Map([[a.id, a], [b.id, b]]);
    const express = require('express');
    const { TimeSeriesConditionStore } = require('../src/features/time-series-conditions');
    const { createTimeSeriesConditionRouter } = require('../src/web/time-series-condition-routes');
    const store = new TimeSeriesConditionStore(state, id => rows.get(id) || null, () => Date.parse(now));
    const calls = [];
    const projects = {
      link(projectId, version, reference) {
        calls.push({ projectId, version, reference });
        return { id: projectId, version: version + 1 };
      },
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: req.get('x-role') === 'admin' ? 'admin' : 'guest', username: 'fixture-admin' }; next(); });
    app.use('/api/research/time-series-conditions', createTimeSeriesConditionRouter(store, {
      projects,
      evidence: rows,
      adminOnly: (req, res) => { if (req.user.role === 'admin') return true; res.status(403).json({ success: false }); return false; },
      csrfValid: req => req.get('x-csrf-token') === 'fixture-csrf',
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/research/time-series-conditions';
    const admin = { 'content-type': 'application/json', 'x-role': 'admin' };
    const csrf = { ...admin, 'x-csrf-token': 'fixture-csrf' };
    try {
      assert.equal((await fetch(base)).status, 403);
      assert.equal((await fetch(base + '/evidence?market=stocks&instrument=stock%3Aus%3AAAPL', { headers: admin })).status, 200);
      const body = input([a, b], 'condition-api-preview-0001');
      delete body.requestId;
      assert.equal((await fetch(base + '/rules/preview', { method: 'POST', headers: admin, body: JSON.stringify(body) })).status, 403);
      assert.equal((await fetch(base + '/rules/preview', { method: 'POST', headers: csrf, body: JSON.stringify(body) })).status, 400);
      const previewResponse = await fetch(base + '/rules/preview', { method: 'POST', headers: { ...csrf, 'Idempotency-Key': 'condition-api-preview-key' }, body: JSON.stringify(body) });
      const previewPayload = await previewResponse.json();
      assert.equal(previewResponse.status, 201, previewPayload.reason);
      assert.equal(previewPayload.market, 'stocks');
      assert.equal(previewPayload.instrument, 'stock:us:AAPL');
      const preview = previewPayload.data;
      assert.equal((await fetch(base + '/rules/' + preview.id + '/confirm', { method: 'POST', headers: { ...csrf, 'Idempotency-Key': 'condition-api-confirm-key' }, body: JSON.stringify({ expectedVersion: preview.version, contentHash: preview.contentHash, acknowledge: true }) })).status, 400);
      const confirmedResponse = await fetch(base + '/rules/' + preview.id + '/confirm', { method: 'POST', headers: { ...csrf, 'Idempotency-Key': 'condition-api-confirm-key', 'If-Match': '"' + preview.version + '"' }, body: JSON.stringify({ expectedVersion: preview.version, contentHash: preview.contentHash, acknowledge: true }) });
      const confirmed = (await confirmedResponse.json()).data;
      assert.equal(confirmedResponse.status, 200);
      assert.equal((await fetch(base + '/rules/' + preview.id + '/run', { method: 'POST', headers: { ...csrf, 'Idempotency-Key': 'condition-api-run-key' }, body: JSON.stringify({ expectedVersion: confirmed.version, contentHash: confirmed.contentHash }) })).status, 400);
      const runResponse = await fetch(base + '/rules/' + preview.id + '/run', { method: 'POST', headers: { ...csrf, 'Idempotency-Key': 'condition-api-run-key', 'If-Match': '"' + confirmed.version + '"' }, body: JSON.stringify({ expectedVersion: confirmed.version, contentHash: confirmed.contentHash }) });
      const run = (await runResponse.json()).data;
      assert.equal(runResponse.status, 201);
      assert.equal(run.hits.length, 1);
      const latest = store.get(preview.id);
      const linkResponse = await fetch(base + '/rules/' + preview.id + '/hits/' + run.hits[0].id + '/link', {
        method: 'POST',
        headers: { ...csrf, 'Idempotency-Key': 'condition-api-link-key', 'If-Match': '"' + latest.version + '"' },
        body: JSON.stringify({ expectedVersion: latest.version, projectId: 'project_11111111-1111-4111-8111-111111111111', projectVersion: 1 }),
      });
      assert.equal(linkResponse.status, 200);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].reference.kind, 'condition-hit');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

test('condition hits resolve as immutable condition-hit references in research projects', async () => {
  await stateFixture(async state => {
    const a = evidence('A', '2026-10-28T10:00:00.000Z', 1);
    const b = evidence('B', '2026-10-28T10:10:00.000Z', 2);
    const rows = new Map([[a.id, a], [b.id, b]]);
    const { TimeSeriesConditionStore } = require('../src/features/time-series-conditions');
    const { ResearchProjectStore } = require('../src/features/research-projects');
    const { createProjectReferenceResolver } = require('../src/features/research-project-references');
    const conditions = new TimeSeriesConditionStore(state, id => rows.get(id) || null, () => Date.parse(now));
    const preview = conditions.preview(input([a, b], 'condition-project-preview-0001'));
    const confirmed = conditions.confirm(preview.id, { expectedVersion: preview.version, contentHash: preview.contentHash, acknowledge: true, confirmationKey: 'condition-project-confirm-0001' });
    const run = conditions.run(confirmed.id, { expectedVersion: confirmed.version, contentHash: confirmed.contentHash, runKey: 'condition-project-run-0001' });
    const projects = new ResearchProjectStore(state, createProjectReferenceResolver({
      evidence: id => rows.get(id) || null,
      verifyEvidence: row => require('../src/features/decision-intelligence').verifyEvidenceSnapshotHash(row),
      partition: () => null,
      experiment: () => null,
      decision: () => null,
      signal: () => null,
      conditionHit: id => conditions.reference(id),
    }), () => Date.parse(now));
    const project = projects.create({ market: 'stocks', title: '条件序列研究', question: '条件是否可复现？', hypothesis: '固定窗口可复现', counterEvidence: '排除条件窗口不成立', acceptance: '固定引用与历史运行一致' });
    const fixedReference = conditions.reference(run.hits[0].id);
    conditions.linkHit(confirmed.id, run.hits[0].id, {
      expectedVersion: conditions.get(confirmed.id).version,
      projectId: project.id,
      projectVersion: project.version,
      linkKey: 'condition-project-store-link-0001',
    }, projects);
    const linked = projects.read(project.id);
    assert.equal(linked.links.length, 1);
    assert.equal(linked.links[0].kind, 'condition-hit');
    assert.equal(linked.links[0].id, run.hits[0].id);
    assert.equal(linked.links[0].instrument, 'stock:us:AAPL');
    assert.deepEqual(conditions.reference(run.hits[0].id), fixedReference);
  });
});

test('condition UI cancels stale context requests and requires explicit run and project-link actions', async () => {
  const source = fs.readFileSync('src/web/public/time-series-conditions.js', 'utf8');
  assert.match(source, /AbortController/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /If-Match/);
  assert.match(source, /\/api\/research\/time-series-conditions/);
  assert.match(source, /明确.*转入研究项目/);
  const dom = new JSDOM('<div id="market-workspace-shell" data-market-scope="stocks" data-workspace="screener" data-instrument="stock:us:AAPL"></div><section id="market-research-tools"></section>', { url: 'https://test.invalid/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.mm_isLoggedIn = true;
  w.mm_isGuest = false;
  let finish;
  let signal;
  w.fetch = async (_url, options) => {
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  };
  try {
    w.eval(source);
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const panel = w.document.getElementById('time-series-conditions');
    assert.equal(panel.parentElement, w.document.getElementById('market-research-tools'));
    const pending = panel.querySelector('[data-sequence-list]').onclick();
    const shell = w.document.getElementById('market-workspace-shell');
    shell.dataset.instrument = 'stock:us:MSFT';
    w.dispatchEvent(new w.Event('mm-workspace-context'));
    assert.equal(signal.aborted, true);
    finish({ ok: true, json: async () => ({ success: true, data: [] }) });
    await pending;
    assert.match(panel.textContent, /stock:us:MSFT/);
  } finally {
    dom.window.close();
  }
});
