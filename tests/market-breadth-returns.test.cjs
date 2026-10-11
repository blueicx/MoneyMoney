const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeBreadthReturns } = require('../dist/features/market-breadth.js');

test('breadth separates equal-weight and prior-market-cap weighted returns using covered rows only', () => {
  const result = summarizeBreadthReturns([
    { changePct: 10, marketCapUsd: 100 },
    { changePct: -1, marketCapUsd: 1000 },
    { changePct: 4, marketCapUsd: null },
  ]);
  assert.equal(result.equalWeightPct, 4.33);
  assert.equal(result.equalWeightCount, 3);
  assert.equal(result.capWeightedCount, 2);
  assert.ok(result.capWeightedPct < 0);
  assert.equal(result.method, 'equal-weight-and-reconstructed-prior-cap-weight');
});

test('breadth reports weighted return unavailable when market-cap coverage is absent', () => {
  const result = summarizeBreadthReturns([{ changePct: 1, marketCapUsd: null }]);
  assert.equal(result.capWeightedPct, null);
  assert.equal(result.capWeightedCount, 0);
  assert.match(result.reason, /没有可用市值/);
});
