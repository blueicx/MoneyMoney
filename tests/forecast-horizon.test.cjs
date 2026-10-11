const test = require('node:test');
const assert = require('node:assert/strict');
const { forecastHorizonGroup, isPreOutcomeSnapshot } = require('../dist/features/forecast-lab.js');

test('forecast horizon groups use the time-to-resolution known at each snapshot', () => {
  assert.equal(forecastHorizonGroup('2026-10-01T00:00:00Z', '2026-10-01T20:00:00Z').key, 'within-1d');
  assert.equal(forecastHorizonGroup('2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z').key, '1-7d');
  assert.equal(forecastHorizonGroup('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z').key, 'over-7d');
  assert.equal(forecastHorizonGroup('2026-10-01T00:00:00Z', undefined).key, 'unknown');
  assert.equal(forecastHorizonGroup('2026-10-02T00:00:00Z', '2026-10-01T00:00:00Z').key, 'expired');
});

test('forecast evaluator excludes probabilities after the event deadline or recorded outcome', () => {
  assert.equal(isPreOutcomeSnapshot('2026-10-01T18:00:00Z', '2026-10-02T00:00:00Z', '2026-10-01T20:00:00Z'), true);
  assert.equal(isPreOutcomeSnapshot('2026-10-01T21:00:00Z', '2026-10-02T00:00:00Z', '2026-10-01T20:00:00Z'), false);
  assert.equal(isPreOutcomeSnapshot('2026-10-02T01:00:00Z', '2026-10-02T00:00:00Z'), false);
  assert.equal(isPreOutcomeSnapshot('2026-10-01T20:00:00Z', '2026-10-02T00:00:00Z', '2026-10-01T20:00:00Z'), false, 'a snapshot at the deadline is not known to precede resolution');
  assert.equal(isPreOutcomeSnapshot('2026-10-01T18:00:00Z', '', '2026-10-01T20:00:00Z'), true, 'the event deadline can bound a sample when resolvedAt is absent');
  assert.equal(isPreOutcomeSnapshot('2026-10-01T18:00:00Z', '', undefined), false, 'without any outcome boundary the sample cannot be proven pre-outcome');
});
