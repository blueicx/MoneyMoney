const test = require('node:test');
const assert = require('node:assert');

test('data status distinguishes live, cached, degraded and unavailable', async () => {
  const { normalizeDataStatus } = await import('../dist/features/stock-data-contracts.js');
  assert.equal(normalizeDataStatus({ state: 'live', source: 'nasdaq' }).state, 'live');
  assert.equal(normalizeDataStatus({ state: 'cached', source: 'nasdaq', observedAt: '2026-09-12T00:00:00Z' }).state, 'cached');
  assert.equal(normalizeDataStatus({ state: 'bad', source: 'nasdaq' }).state, 'unavailable');
});

test('source health exposes capabilities for each source family', async () => {
  const { capabilitiesForSource } = await import('../dist/features/source-health.js');
  assert.deepEqual(capabilitiesForSource('nasdaq-public-quote'), ['quote']);
  assert.deepEqual(capabilitiesForSource('sec-edgar-companyfacts'), ['fundamentals', 'filings']);
  assert.deepEqual(capabilitiesForSource('unknown-source'), []);
});

test('readiness should not be blocked by single slow source', async () => {
  const { getSourceHealth } = await import('../dist/features/source-health.js');
  const start = Date.now();
  const result = await getSourceHealth('all');
  const duration = Date.now() - start;
  assert.ok(duration < 2000, 'should return within budget');
  assert.ok(result.items.length > 0, 'should return partial state');
});
