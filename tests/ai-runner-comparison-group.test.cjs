const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-runner-comparison-'));
process.env.MONEYMONEY_DATA_DIR = dir;
const runners = require('../dist/features/ai-paper-runner');
const { stateStore } = require('../dist/storage/sqlite-state');
test.after(() => { stateStore.close(); fs.rmSync(dir, { recursive: true, force: true }); });
test('controlled comparison creates three paused independent accounts with the same experiment settings', () => {
  const { createAiRunnerComparison, validateAiRunnerComparison } = require('../dist/features/ai-runner-comparison-group');
  const group = createAiRunnerComparison('Binance', 'BTCUSDT', 'Bitcoin', 100, {}, { seed: 123, model: 'test-model' });
  const rows = group.runnerIds.map(id => runners.getAiRunners().find(row => row.id === id));
  assert.deepEqual(rows.map(row => row.mode), ['rules', 'ai-review', 'ai-autonomous-paper']);
  assert.equal(new Set(rows.map(row => row.accountId)).size, 3);
  assert.equal(new Set(rows.map(row => row.createdAt)).size, 1);
  assert.equal(new Set(rows.map(row => row.universe.hash)).size, 1);
  assert.equal(new Set(rows.map(row => JSON.stringify(row.policy))).size, 1);
  assert.ok(rows.every(row => row.status === 'STOPPED' && row.comparisonControl.seed === 123));
  assert.equal(validateAiRunnerComparison(group, rows).valid, true);
  assert.throws(() => runners.updateAiRunnerPolicy(rows[0].id, { feeRateBps: 20 }), /对照.*固定/);
  assert.equal(runners.resumeAiRunner(rows[0].id), null, 'individual resume cannot evade the group sampling');
  runners.activateAiRunnerComparison(group.id, group.runnerIds);
  group.runnerIds.forEach(id => runners.pauseAiRunner(id, 'round complete'));
  runners.activateAiRunnerComparison(group.id, group.runnerIds);
  assert.ok(group.runnerIds.every(id => runners.getAiRunners().find(row => row.id === id).status === 'RUNNING'));
  group.runnerIds.forEach(id => runners.pauseAiRunner(id, 'test ended'));
});
test('comparison samples freeze real inputs and a hash-verified replay has no execution side effects', () => {
  const { createAiRunnerComparison, buildAiRunnerComparisonSample, saveAiRunnerComparisonSample, replayAiRunnerComparisonSample } = require('../dist/features/ai-runner-comparison-group');
  const group = createAiRunnerComparison('Stocks', 'AAPL', 'Apple', 100, {}, { seed: 23 });
  const at = '2026-10-06T14:00:00Z';
  const inputs = [{ market: 'stocks', instrument: 'AAPL', dataStatus: 'historical', source: 'test source', dataAt: at, price: 100, ref: { venue: 'Stocks', symbolOrMarketId: 'AAPL' } }];
  const sample = buildAiRunnerComparisonSample(group, 'round-1', at, inputs);
  const replayRecords = group.runnerIds.map(runnerId => ({ runnerId, action: 'NONE', reason: '历史无盘口', instrument: 'AAPL', market: 'stocks', snapshotHash: sample.snapshots[0].snapshotHash }));
  saveAiRunnerComparisonSample(group.id, { ...sample, results: replayRecords });
  const before = JSON.stringify(runners.getAiRunners());
  const replay = replayAiRunnerComparisonSample(group.id, sample.id);
  assert.equal(replay.executionEnabled, false); assert.equal(replay.modelCalls, 0);
  assert.deepEqual(replay.sample.results, replayRecords);
  assert.equal(JSON.stringify(runners.getAiRunners()), before);
  const second = buildAiRunnerComparisonSample(group, 'round-1', at, structuredClone(inputs));
  assert.equal(second.hash, sample.hash);
  assert.throws(() => buildAiRunnerComparisonSample(group, 'round-2', at, [{ ...inputs[0], market: 'crypto' }]), /市场/);
  assert.throws(() => saveAiRunnerComparisonSample(group.id, { ...sample, snapshots: [{ ...sample.snapshots[0], price: 999 }] }), /Hash/);
  const saved = stateStore.get('ai-runner-comparison:' + group.id + ':samples');
  saved[0].results[0].reason = 'tampered'; stateStore.set('ai-runner-comparison:' + group.id + ':samples', saved);
  assert.throws(() => replayAiRunnerComparisonSample(group.id, sample.id), /Hash/);
});

test('comparison preserves the frozen source watchlist identity in every arm', () => {
  const { createAiRunnerComparison, validateAiRunnerComparison } = require('../dist/features/ai-runner-comparison-group');
  const group = createAiRunnerComparison('Stocks', 'AAPL', 'Apple', 100, {}, {
    seed: 42, universe: { kind: 'watchlist', sourceWatchlistId: 'owner-watchlist', instruments: [{ venue: 'Stocks', symbolOrMarketId: 'AAPL', title: 'Apple' }] },
  });
  const rows = group.runnerIds.map(id => runners.getAiRunners().find(row => row.id === id));
  assert.equal(validateAiRunnerComparison(group, rows).valid, true);
  assert.ok(rows.every(row => row.universe.sourceWatchlistId === 'owner-watchlist'));
});
