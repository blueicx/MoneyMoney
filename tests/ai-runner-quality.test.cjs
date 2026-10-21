const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { summarizeAiRunnerQuality } = require('../src/features/ai-paper-runner');

test('AI runner quality reports explicit matured trade outcomes but never reinterprets action confidence as profit probability', () => {
  const decisions = Array.from({ length: 20 }, (_, index) => ({
    id: `decision-${index}`, runnerId: 'runner-1', idempotencyKey: `tick-${index}:AAPL`,
    at: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, market: 'stocks', instrument: 'AAPL',
    dataStatus: 'delayed', strategyVersion: 'strategy-v2', modelVersion: 'model-fixed', modelConfidence: 0.8,
    modelLatencyMs: 100 + index, modelCallStatus: 'success', action: 'BUY', reason: 'test', orderId: `entry-${index}`,
  }));
  const positions = decisions.map((decision, index) => ({
    status: 'CLOSED', entryOrderId: decision.orderId, exitTime: '2026-02-01T00:00:00.000Z',
    pnlUsd: index < 15 ? 10 : -10, entryFeeUsd: 1, exitFeeUsd: 1, entrySlippageUsd: 0.5, exitSlippageUsd: 0.5,
  }));
  const output = summarizeAiRunnerQuality({ decisions, positions, aiCalls: [] }, 20);
  assert.equal(output.matured.count, 20);
  assert.equal(output.matured.calibrationAvailable, false);
  assert.equal(output.matured.modelVersionGroups[0].modelVersion, 'model-fixed');
  assert.equal(output.matured.brierScore, null);
  assert.equal(output.matured.winRate, .75);
  assert.match(output.matured.reason, /目标|期限/);
  assert.equal(output.latency.averageMs, 109.5);
  assert.equal(output.unlinkedDecisions, 0);
});

test('AI runner quality warns below sample gate and never pairs decisions by timestamp or instrument alone', () => {
  const output = summarizeAiRunnerQuality({
    decisions: [{ id: 'old', runnerId: 'r', idempotencyKey: 'legacy', at: '2026-01-01T00:00:00Z', market: 'stocks', instrument: 'AAPL', action: 'BUY', reason: 'legacy', modelConfidence: 0.9, modelVersion: 'm' }],
    positions: [{ status: 'CLOSED', instrumentId: 'stock:us:AAPL', exitTime: '2026-01-02T00:00:00Z', pnlUsd: 5 }],
    aiCalls: [],
  }, 20);
  assert.equal(output.matured.count, 0);
  assert.equal(output.matured.calibrationAvailable, false);
  assert.match(output.matured.reason, /至少 20/);
  assert.equal(output.unlinkedDecisions, 1);
});

test('AI runner quality is rendered only when an administrator expands private history', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/web/public/modules/dashboard-runtime.js'), 'utf8');
  const historyLoader = source.slice(source.indexOf('async function loadAiRunnerHistory'), source.indexOf('async function createAiRunner'));
  assert.match(historyLoader, /\/api\/ai-runners\/\$\{encodeURIComponent\(id\)\}\/quality/);
  assert.match(historyLoader, /置信度校准/);
  assert.match(historyLoader, /至少 20 笔/);
});
