const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { buildSourceHealthTransitions } = require('../dist/features/source-health-history.js');
const { buildDecisionMobileSummary } = require('../dist/features/decision-mobile-summary.js');

test('source health history records failures and recoveries with affected capabilities', () => {
  const previous = { updatedAt: '2026-09-19T00:00:00Z', total: 1, online: 1, configuredOptional: 0, items: [
    { id: 'nasdaq', name: 'Nasdaq', group: 'stocks', ok: true, latencyMs: 20, detail: '正常', checkedAt: '2026-09-19T00:00:00Z', capabilities: ['quote'] },
  ] };
  const failed = { ...previous, updatedAt: '2026-09-19T00:01:00Z', online: 0, items: [{ ...previous.items[0], ok: false, status: 'unavailable', detail: '连接超时', checkedAt: '2026-09-19T00:01:00Z' }] };
  const recovered = { ...previous, updatedAt: '2026-09-19T00:02:00Z', items: [{ ...previous.items[0], checkedAt: '2026-09-19T00:02:00Z' }] };
  const outage = buildSourceHealthTransitions('stocks', previous, failed);
  assert.equal(outage[0].kind, 'outage');
  assert.deepEqual(outage[0].affectedCapabilities, ['quote']);
  const recovery = buildSourceHealthTransitions('stocks', failed, recovered);
  assert.equal(recovery[0].kind, 'recovery');
  assert.match(recovery[0].detail, /恢复/);
});

test('evidence history and retry APIs are present', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  assert.ok(server.includes("app.get('/api/evidence/source-health/history'"));
  assert.ok(server.includes("app.post('/api/evidence/source-health/retry'"));
});

test('PWA caches only public decision snapshots and exposes an honest offline state', () => {
  const worker = fs.readFileSync('src/web/public/sw.js', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('src/web/public/manifest.json', 'utf8'));
  assert.equal(worker.includes('Response.new'), false);
  assert.match(worker, /\/api\/evidence/);
  assert.match(worker, /\/api\/evidence\/changes/);
  assert.match(worker, /\/api\/evidence\/source-health\/history/);
  assert.match(worker, /\/api\/workspaces\/shared/);
  assert.match(worker, /\/api\/signals\/quality/);
  assert.doesNotMatch(worker, /\/api\/decisions/);
  assert.match(worker, /dataStatus[^\n]+cached|cached[^\n]+dataStatus/);
  assert.match(manifest.description, /研究|证据|模拟/);
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.some(item => /decision-intelligence/.test(item.url)));
});

test('mobile summary stays market scoped and links to the trusted decision workspace', () => {
  const text = buildDecisionMobileSummary({
    market: 'stocks', evidence: [{ dataStatus: 'live' }, { dataStatus: 'cached' }], openDecisions: 2,
    signalQuality: { total: 8, hitRate: 0.625, warnings: ['样本量不足'] }, outages: 1,
    deepLink: 'https://example.com/?market=stocks&workspace=decision-intelligence',
  });
  assert.match(text, /股票/);
  assert.match(text, /实时 1/);
  assert.match(text, /62.5%/);
  assert.match(text, /decision-intelligence/);
  assert.doesNotMatch(text, /BTC|虚拟币/);
});

test('private runtime diagnostics API and connected UI panels are present', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  const page = fs.readFileSync('src/web/public/index.html', 'utf8');
  assert.ok(server.includes("app.get('/api/diagnostics'"));
  assert.match(page, /来源故障时间线/);
  assert.match(page, /负知识库/);
  assert.match(page, /network-status-banner/);
});

test('workspace deep links take priority over the last visited tab', () => {
  const page = fs.readFileSync('src/web/public/index.html', 'utf8');
  assert.match(page, /requestedWorkspaceFromUrl[\s\S]*workspaceTabFor\(activeWorkspaceId\)[\s\S]*showTab\(requestedWorkspaceTab/);
});

test('guest access exposes shared workspace snapshots but not private workspace lists', () => {
  const { isGuestRequestAllowed } = require('../dist/web/auth.js');
  assert.equal(isGuestRequestAllowed('GET', '/workspaces/shared/public-id'), true);
  assert.equal(isGuestRequestAllowed('GET', '/workspaces'), false);
  assert.equal(isGuestRequestAllowed('POST', '/workspaces/shared/public-id'), false);
});
