const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('Monte Carlo repeats exactly with the same seed and exposes the input snapshot hash', () => {
  const { runUnifiedMonteCarlo } = require('../dist/features/paper-trading');
  const pnls = [-30, 10, 40, -20, 50];
  const first = runUnifiedMonteCarlo(pnls, 1000, 200, 30, 42);
  const second = runUnifiedMonteCarlo(pnls, 1000, 200, 30, 42);
  assert.equal(first.seed, 42);
  assert.match(first.snapshotHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(first, second);
  assert.match(first.noteZh, /30 笔/);
});

test('Monte Carlo rejects invalid or unbounded work and seeds', () => {
  const { runUnifiedMonteCarlo } = require('../dist/features/paper-trading');
  for (const args of [[200, 20, -1], [Infinity, 20, 1], [200, NaN, 1], [200, 20, 1.2], [10000000, 20, 1]]) {
    assert.equal(typeof runUnifiedMonteCarlo([-30, 10, 40, -20, 50], 1000, ...args).error, 'string');
  }
});
