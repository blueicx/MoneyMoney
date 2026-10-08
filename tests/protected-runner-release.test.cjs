const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../scripts/protected-runner-release.cjs');

function runner() {
  return { id: guard.PROTECTED_RUNNER_ID, accountId: 'existing-account', venue: 'Stocks',
    symbolOrMarketId: 'MU', budgetUsd: 1000, mode: 'ai-autonomous-paper', status: 'RUNNING',
    modelSelection: 'available-free', quoteSelection: 'random-valid', model: 'original-model',
    strategyVersion: 'original-version', trigger: 'scheduled', manualPaused: false,
    policy: { allowedSymbols: ['MU', 'SNDK'], maxBudgetUsd: 1000, maxPositions: 5 },
    universe: { hash: guard.PROTECTED_UNIVERSE_HASH, instruments: [{ venue: 'Stocks', symbolOrMarketId: 'MU' }] },
    cashUsd: 1000, positions: [], trades: [], lastRunAt: '2026-10-08T00:00:00Z' };
}

test('release baseline requires the exact protected runner and declared routing', () => {
  const row = runner();
  assert.equal(guard.captureProtectedRunner([row]).schemaVersion, 1);
  assert.throws(() => guard.captureProtectedRunner([]), /protected runner/);
  assert.throws(() => guard.captureProtectedRunner([row, row]), /protected runner/);
  for (const patch of [{ budgetUsd: 999 }, { modelSelection: 'fixed' }, { quoteSelection: 'fixed' }, { status: undefined }]) {
    assert.throws(() => guard.captureProtectedRunner([{ ...row, ...patch }]));
  }
});

test('normal fills and marks may progress without changing protected configuration', () => {
  const row = runner(), baseline = guard.captureProtectedRunner([row]);
  const progressing = { ...row, cashUsd: 400, positions: [{ price: 600 }], trades: [{ id: 'new-fill' }], lastRunAt: '2026-10-08T01:00:00Z' };
  assert.doesNotThrow(() => guard.assertProtectedRunnerPreserved(baseline, [progressing]));
  assert.equal(JSON.stringify(baseline).includes('cashUsd'), false);
  assert.equal(JSON.stringify(baseline).includes('original-model'), false, 'configuration is hashed, not dumped');
});

test('release rejects changes to model, routing, account, risk, universe and running state', () => {
  const row = runner(), baseline = guard.captureProtectedRunner([row]);
  for (const patch of [
    { model: 'replacement' }, { accountId: 'new-account' }, { status: 'STOPPED' }, { manualPaused: true },
    { strategyVersion: 'new-version' }, { trigger: 'signal' },
    { policy: { ...row.policy, maxPositions: 10 } },
    { universe: { ...row.universe, instruments: [] } },
  ]) assert.throws(() => guard.assertProtectedRunnerPreserved(baseline, [{ ...row, ...patch }]), /protected runner/);
  assert.throws(() => guard.assertProtectedRunnerPreserved({}, [row]), /baseline/);
});

test('object key order is irrelevant but frozen instrument order remains protected', () => {
  const row = runner(), baseline = guard.captureProtectedRunner([row]);
  const reordered = { ...row, policy: { maxPositions: 5, maxBudgetUsd: 1000, allowedSymbols: ['MU', 'SNDK'] } };
  assert.doesNotThrow(() => guard.assertProtectedRunnerPreserved(baseline, [reordered]));
  assert.throws(() => guard.assertProtectedRunnerPreserved(baseline, [{ ...row, policy: { ...row.policy, allowedSymbols: ['SNDK', 'MU'] } }]));
});
