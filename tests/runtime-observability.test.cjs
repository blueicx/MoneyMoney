const assert = require('node:assert/strict');
const test = require('node:test');

const observability = require('../dist/features/runtime-observability');

test('runtime observations expose request rate, errors and p95 latency', () => {
  const collector = observability.createRuntimeObservability({ maxSamples: 10, startedAt: 1_000 });
  collector.recordHttp({ method: 'GET', path: '/api/market', status: 200, latencyMs: 10, at: 2_000 });
  collector.recordHttp({ method: 'GET', path: '/api/market', status: 503, latencyMs: 80, at: 3_000 });
  collector.recordHttp({ method: 'POST', path: '/api/research/jobs', status: 202, latencyMs: 20, at: 4_000 });
  const snapshot = collector.snapshot(5_000);
  assert.equal(snapshot.http.requests, 3);
  assert.equal(snapshot.http.errors, 1);
  assert.equal(snapshot.http.errorRate, 1 / 3);
  assert.equal(snapshot.http.p95LatencyMs, 80);
  assert.ok(snapshot.memory.rssBytes > 0);
  assert.equal(snapshot.uptimeMs, 4_000);
});

test('source SLO keeps success, p95, freshness and recovery facts separate', () => {
  const result = observability.buildSourceSlo([
    { id: 'nasdaq', ok: true, latencyMs: 100, checkedAt: '2026-09-21T00:00:00.000Z', status: 'live' },
    { id: 'nasdaq', ok: false, latencyMs: 500, checkedAt: '2026-09-21T00:01:00.000Z', status: 'unavailable' },
    { id: 'binance', ok: true, latencyMs: 40, checkedAt: '2026-09-21T00:02:00.000Z', status: 'cached' },
  ], Date.parse('2026-09-21T00:03:00.000Z'));
  assert.equal(result.nasdaq.samples, 2);
  assert.equal(result.nasdaq.successRate, 0.5);
  assert.equal(result.nasdaq.p95LatencyMs, 500);
  assert.equal(result.nasdaq.consecutiveFailures, 1);
  assert.equal(result.binance.freshnessMs, 60_000);
});
