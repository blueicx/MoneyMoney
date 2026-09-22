const assert = require('node:assert/strict');
const {
  DATA_STATUS_VALUES,
  normalizeDataStatus,
  createDataEnvelope,
} = require('../dist/features/data-status');

assert.deepEqual(DATA_STATUS_VALUES, ['live', 'delayed', 'cached', 'partial', 'empty', 'unavailable', 'unsupported', 'failed', 'historical']);
assert.equal(normalizeDataStatus('stale'), 'cached');
assert.equal(normalizeDataStatus('degraded'), 'partial');
assert.equal(normalizeDataStatus('not-a-status'), 'unavailable');
assert.deepEqual(createDataEnvelope({
  market: 'stocks',
  instrument: 'stock:us:AAPL',
  data: { price: 100 },
  dataStatus: 'live',
  source: 'test-source',
  requestId: 'req_test',
}), {
  success: true,
  market: 'stocks',
  instrument: 'stock:us:AAPL',
  dataStatus: 'live',
  source: 'test-source',
  updatedAt: null,
  reason: null,
  evidenceRefs: [],
  requestId: 'req_test',
  data: { price: 100 },
});

console.log('data status contract: all assertions passed');
