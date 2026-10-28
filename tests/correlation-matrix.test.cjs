const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { buildCorrelationMatrix, renderCorrelationCsv } = require('../src/features/correlation-matrix');

const evidence = (instrument) => ({
  market: 'stocks', instrument, kind: 'bars', source: 'fixture',
  publishedAt: '2026-01-01T00:00:00Z', observedAt: '2026-01-01T00:00:01Z', fetchedAt: '2026-01-01T00:00:02Z',
  contentHash: 'a'.repeat(64), coverage: 'complete', unknownReason: null,
});
const points = (values, offset = 0) => values.map((v, index) => ({ t: 1000 + index * 1000 + offset, v }));

test('correlation matrix aligns exact timestamps and reports overlap', () => {
  const matrix = buildCorrelationMatrix({ series: [
    { instrument: 'stock:us:AAA', evidence: evidence('stock:us:AAA'), points: points([100, 110, 100, 105, 115]) },
    { instrument: 'stock:us:BBB', evidence: evidence('stock:us:BBB'), points: points([200, 190, 205, 195, 210]) },
  ], minSamples: 4 });
  assert.equal(matrix.dataStatus, 'ready');
  assert.equal(matrix.values[0][0], 1);
  assert.equal(matrix.values[0][1], matrix.values[1][0]);
  assert.equal(matrix.overlap[0][1], 4);
  assert.equal(typeof matrix.pairs[0].value, 'number');
  assert.match(matrix.contentHash, /^[a-f0-9]{64}$/);
});

test('mismatched timestamps become explicit insufficient overlap', () => {
  const matrix = buildCorrelationMatrix({ series: [
    { instrument: 'stock:us:AAA', evidence: evidence('stock:us:AAA'), points: points([100, 110, 100, 105, 115]) },
    { instrument: 'stock:us:BBB', evidence: evidence('stock:us:BBB'), points: points([200, 190, 205, 195, 210], 1) },
  ], minSamples: 3 });
  assert.equal(matrix.dataStatus, 'unavailable');
  assert.equal(matrix.values[0][1], null);
  assert.match(matrix.pairs[0].reason, /重叠样本/);
});

test('correlation refuses duplicate instruments and bad evidence', () => {
  assert.throws(() => buildCorrelationMatrix({ series: [
    { instrument: 'stock:us:AAA', evidence: evidence('stock:us:AAA'), points: points([1, 2, 3]) },
    { instrument: 'stock:us:AAA', evidence: evidence('stock:us:AAA'), points: points([1, 2, 3]) },
  ] }), /唯一/);
  assert.throws(() => buildCorrelationMatrix({ series: [
    { instrument: 'stock:us:AAA', evidence: { ...evidence('stock:us:AAA'), fetchedAt: null }, points: points([1, 2, 3]) },
    { instrument: 'stock:us:BBB', evidence: evidence('stock:us:BBB'), points: points([1, 2, 3]) },
  ] }), /证据引用/);
});

test('correlation csv keeps nulls explicit', () => {
  const matrix = buildCorrelationMatrix({ series: [
    { instrument: 'stock:us:AAA', evidence: evidence('stock:us:AAA'), points: points([100, 110, 100, 105]) },
    { instrument: 'stock:us:BBB', evidence: evidence('stock:us:BBB'), points: points([200, 190, 205], 500) },
  ], minSamples: 3 });
  const csv = renderCorrelationCsv(matrix);
  assert.match(csv, /stock:us:AAA,stock:us:BBB,,/);
});
