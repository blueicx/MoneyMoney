const PROTECTED_RUNNER_ID = 'ar_b5cdccff-e0d1-41e1-8721-e527a4e3acca';
const PROTECTED_UNIVERSE_HASH = 'da55492b94d47c17f04693f5330f49f946d66ba4d7d7566bb20dbe923008cbd1';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function captureProtectedRunner(rows) {
  assert.ok(Array.isArray(rows), 'protected runner response must be an array');
  const matches = rows.filter(row => row?.id === PROTECTED_RUNNER_ID);
  assert.equal(matches.length, 1, 'protected runner must exist exactly once');
  const row = matches[0];
  assert.equal(row.budgetUsd, 1000, 'protected runner budget changed');
  assert.equal(row.mode, 'ai-autonomous-paper', 'protected runner mode changed');
  assert.equal(row.modelSelection, 'available-free', 'protected runner model routing changed');
  assert.equal(row.quoteSelection, 'random-valid', 'protected runner quote routing changed');
  assert.equal(row.universe?.hash, PROTECTED_UNIVERSE_HASH, 'protected runner universe changed');
  assert.ok(['RUNNING', 'STOPPED'].includes(row.status), 'protected runner status is missing or unknown');
  assert.ok(row.accountId && row.policy && row.universe?.instruments?.length, 'protected runner configuration incomplete');
  // Exclude financial state and timestamps: the existing scheduler may keep making valid fills.
  const config = Object.fromEntries([
    'id', 'accountId', 'venue', 'symbolOrMarketId', 'budgetUsd', 'mode', 'model',
    'modelSelection', 'quoteSelection', 'strategyVersion', 'trigger', 'policy', 'universe',
    'status', 'manualPaused', 'executionState', 'comparisonControl',
  ].map(key => [key, row[key] ?? null]));
  return { schemaVersion: 1, runnerId: PROTECTED_RUNNER_ID,
    configurationHash: crypto.createHash('sha256').update(JSON.stringify(canonical(config))).digest('hex') };
}
function assertProtectedRunnerPreserved(baseline, rows) {
  assert.ok(baseline?.schemaVersion === 1 && baseline.runnerId === PROTECTED_RUNNER_ID &&
    /^[a-f0-9]{64}$/.test(baseline.configurationHash), 'protected runner baseline is invalid');
  const current = captureProtectedRunner(rows);
  assert.equal(current.configurationHash, baseline.configurationHash, 'protected runner configuration or running state changed');
}
module.exports = { PROTECTED_RUNNER_ID, PROTECTED_UNIVERSE_HASH, captureProtectedRunner, assertProtectedRunnerPreserved };
