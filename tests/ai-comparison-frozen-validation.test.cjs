const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
process.env.MONEYMONEY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-comparison-integrity-'));
require('ts-node/register/transpile-only');
const runner = require('../src/features/ai-paper-runner');
const { stateStore } = require('../src/storage/sqlite-state');
const { createAiRunnerComparison, validateAiRunnerComparison } = require('../src/features/ai-runner-comparison-group');
const comparison = require('../src/features/ai-runner-comparison-group');
test.after(() => stateStore.close());
function fixture() {
  const group = createAiRunnerComparison('Stocks', 'MU', 'Micron', 1000, {}, { seed: 42, model: 'fixture/fixed-model' });
  const rows = group.runnerIds.map(id => runner.getAiRunners().find(row => row.id === id));
  assert.equal(validateAiRunnerComparison(group, rows).valid, true);
  return { group, rows };
}
test('matching edits to all arms cannot bypass the original frozen configuration hash', () => {
  for (const change of [r => r.budgetUsd = 2000, r => r.policy.feeRateBps = 99, r => r.model = 'another/model']) {
    const { group, rows } = fixture(); rows.forEach(change);
    assert.equal(validateAiRunnerComparison(group, rows).valid, false);
  }
});
test('comparison requires three distinct accounts and the exact rules/review/autonomous roles', () => {
  for (const change of [rows => rows[1].accountId = rows[0].accountId, rows => rows[1].mode = 'ai-autonomous-paper',
    rows => rows.forEach(r => r.trigger = 'signal'), rows => rows[2].modelSelection = 'available-free',
    rows => rows[0].quoteSelection = 'random-valid', rows => rows[0].strategyVersion = 'changed']) {
    const { group, rows } = fixture(); change(rows);
    assert.equal(validateAiRunnerComparison(group, rows).valid, false);
  }
});
test('a stored universe hash does not authorize changed actual instruments or owner identity', () => {
  for (const change of [r => r.universe.instruments[0].symbolOrMarketId = 'AAPL', r => r.universe.sourceWatchlistId = 'other-owner']) {
    const { group, rows } = fixture(); rows.forEach(change);
    assert.equal(validateAiRunnerComparison(group, rows).valid, false);
  }
});
test('live balances, positions and runtime status do not invalidate an unchanged experiment', () => {
  const { group, rows } = fixture();
  rows[0].cashUsd = 500; rows[0].status = 'RUNNING'; rows[1].lastDataStatus = 'cached';
  assert.equal(validateAiRunnerComparison(group, rows).valid, true);
});
test('automatic resume requires the same fixed model and complete frozen instrument membership', () => {
  const { group, rows } = fixture();
  const scheduled = { market: 'stocks', groupId: group.id, model: 'fixture/fixed-model', instruments: ['MU'] };
  assert.equal(comparison.validateScheduledAiRunnerComparison(scheduled, group, rows).valid, true);
  for (const change of [s => s.model = 'other/model', s => s.instruments = ['AAPL'], s => s.market = 'crypto',
    s => s.model = 'openrouter/free', s => s.instruments = ['MU', 'MU']]) {
    const changed = structuredClone(scheduled); change(changed);
    assert.equal(comparison.validateScheduledAiRunnerComparison(changed, group, rows).valid, false);
  }
  assert.equal(comparison.validateScheduledAiRunnerComparison(scheduled, null, []).valid, false);
});
