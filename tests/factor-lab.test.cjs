const test = require('node:test');
const { strict: assert } = require('node:assert');
const { analyzeFactor, removeCorrelatedFactors } = require('../dist/features/factor-lab.js');

test('factor lab reports rank IC, quantile returns and stability without leaking market scope', () => {
  const result = analyzeFactor({ market: 'stocks', factorId: 'quality', values: [1, 2, 3, 4, 5, 6], forwardReturns: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06], quantiles: 3 });
  assert.equal(result.market, 'stocks');
  assert.equal(result.rankIc, 1);
  assert.equal(result.quantiles.length, 3);
  assert.ok(result.quantiles[2].averageReturn > result.quantiles[0].averageReturn);
  assert.equal(result.stability, 1);
});

test('factor lab rejects mismatched samples and removes only highly correlated duplicates', () => {
  assert.throws(() => analyzeFactor({ market: 'crypto', factorId: 'x', values: [1], forwardReturns: [] }), /same length/);
  const kept = removeCorrelatedFactors([
    { id: 'a', values: [1, 2, 3, 4] },
    { id: 'b', values: [2, 4, 6, 8] },
    { id: 'c', values: [4, 3, 2, 1] },
  ], 0.95);
  assert.deepEqual(kept.map(item => item.id), ['a']);
});
