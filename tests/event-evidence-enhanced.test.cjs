const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEventEvidence } = require('../dist/features/event-evidence.js');

test('event evidence keeps market-specific fields in their owning scope', () => {
  const ev1 = buildEventEvidence({
    scope: 'stocks',
    title: 'Test',
    actual: '1',
    forecast: '2',
    previous: '3',
    openInterest: 1000,
    yesPrice: 0.5
  });
  assert.equal(ev1.openInterest, undefined);
  assert.equal(ev1.yesPrice, undefined);

  const ev2 = buildEventEvidence({
    scope: 'crypto',
    title: 'Test Crypto',
    actual: '1',
    forecast: '2',
    previous: '3',
    openInterest: 1000,
    yesPrice: 0.5
  });
  assert.equal(ev2.openInterest, 1000);
  assert.equal(ev2.yesPrice, undefined);

  const ev3 = buildEventEvidence({
    scope: 'prediction',
    title: 'Test Prediction',
    actual: null,
    forecast: null,
    previous: null,
    openInterest: 1000,
    yesPrice: 0.5
  });
  assert.equal(ev3.openInterest, undefined);
  assert.equal(ev3.yesPrice, 0.5);
});
