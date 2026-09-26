const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { summarizeSourceSlo } = require('../dist/features/source-health-slo.js');

test('source SLO counts a successful empty response as available, not as a provider failure', () => {
  const rows = [
    { market: 'stocks', sourceId: 'sec', sourceName: 'SEC', checkedAt: '2026-09-27T08:00:00.000Z', outcome: 'success', latencyMs: 100, capabilities: ['filings'], detail: 'records found' },
    { market: 'stocks', sourceId: 'sec', sourceName: 'SEC', checkedAt: '2026-09-27T08:01:00.000Z', outcome: 'empty', latencyMs: 110, capabilities: ['filings'], detail: '连接成功，暂无记录' },
    { market: 'stocks', sourceId: 'sec', sourceName: 'SEC', checkedAt: '2026-09-27T08:02:00.000Z', outcome: 'failed', latencyMs: null, capabilities: ['filings'], detail: '连接超时' },
    { market: 'crypto', sourceId: 'sec', sourceName: 'SEC', checkedAt: '2026-09-27T08:02:00.000Z', outcome: 'success', latencyMs: 5, capabilities: ['filings'], detail: 'wrong scope sentinel' },
  ];
  const result = summarizeSourceSlo(rows, { market: 'stocks', now: '2026-09-27T09:00:00.000Z', windowMs: 7 * 86400000 });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].checks, 3);
  assert.equal(result.sources[0].available, 2);
  assert.equal(result.sources[0].empty, 1);
  assert.equal(result.sources[0].failed, 1);
  assert.equal(result.sources[0].availabilityPct, 66.67);
  assert.deepEqual(result.sources[0].capabilities, ['filings']);
  assert.equal(result.sources[0].lastError, '连接超时');
});

test('SLO window ignores samples outside the requested market/time window and excludes unconfigured providers', () => {
  const rows = [
    { market: 'stocks', sourceId: 'a', sourceName: 'A', checkedAt: '2026-09-27T08:00:00.000Z', outcome: 'unconfigured', capabilities: [] },
    { market: 'stocks', sourceId: 'a', sourceName: 'A', checkedAt: '2026-09-19T08:00:00.000Z', outcome: 'failed', capabilities: [] },
    { market: 'crypto', sourceId: 'b', sourceName: 'B', checkedAt: '2026-09-27T08:00:00.000Z', outcome: 'failed', capabilities: [] },
  ];
  const result = summarizeSourceSlo(rows, { market: 'stocks', now: '2026-09-27T09:00:00.000Z', windowMs: 7 * 86400000 });
  assert.deepEqual(result.sources, []);
});

test('seven-day SLO and version routes are wired and validate market scope', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  const authRoutes = fs.readFileSync('src/web/auth-routes.ts', 'utf8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.ok(server.includes("app.get('/api/data/slo'"));
  assert.ok(server.includes("app.get('/api/health/version'"));
  assert.match(server, /summarizeSourceSlo\(/);
  assert.match(authRoutes, /req\.path === '\/health\/version'/);
  assert.match(packageJson.scripts.build, /write-build-info\.cjs/);
});
