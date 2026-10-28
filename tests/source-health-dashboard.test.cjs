const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { buildSourceHealthDashboard } = require('../src/features/source-health-dashboard');

const now = Date.parse('2026-10-28T00:00:00Z');
const sample = (sourceId, minutesAgo, ok, latencyMs, reason = null) => ({
  sourceId, sourceName: sourceId.toUpperCase(), market: 'stocks',
  at: new Date(now - minutesAgo * 60_000).toISOString(), ok, latencyMs, reason,
});

test('source health summarises success rate and latency quantiles', () => {
  const dashboard = buildSourceHealthDashboard({
    observations: [sample('alpha', 3, true, 100), sample('alpha', 2, true, 200), sample('alpha', 1, true, 300)],
    now,
  });
  const source = dashboard.sources[0];
  assert.equal(source.status, 'live');
  assert.equal(source.samples, 3);
  assert.equal(source.successRate, 1);
  assert.equal(source.latencyP50Ms, 200);
  assert.equal(source.latencyP95Ms, 290);
});

test('failures degrade or mark unavailable and count reasons', () => {
  const degraded = buildSourceHealthDashboard({
    observations: [sample('beta', 4, true, 100), sample('beta', 3, true, 120), sample('beta', 2, true, 140), sample('beta', 1, false, null, 'timeout')],
    now,
  });
  assert.equal(degraded.sources[0].status, 'degraded');
  assert.deepEqual(degraded.sources[0].failureReasons, [{ reason: 'timeout', count: 1 }]);
  const unavailable = buildSourceHealthDashboard({
    observations: [sample('gamma', 2, false, null, 'reset'), sample('gamma', 1, false, null, 'reset')],
    minSamples: 2,
    now,
  });
  assert.equal(unavailable.sources[0].status, 'unavailable');
});

test('sparse sources stay unknown instead of guessing', () => {
  const dashboard = buildSourceHealthDashboard({ observations: [sample('delta', 1, true, 90)], now });
  assert.equal(dashboard.sources[0].status, 'unknown');
  assert.equal(dashboard.unknownSources, 1);
});

test('out-of-window observations are excluded', () => {
  const dashboard = buildSourceHealthDashboard({
    observations: [sample('old', 60 * 24 * 10, true, 90)],
    windowMs: 7 * 86_400_000,
    now,
  });
  assert.equal(dashboard.sources.length, 0);
});
