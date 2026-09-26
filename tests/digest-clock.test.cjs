const test = require('node:test');
const assert = require('node:assert/strict');

const { zonedDigestClock } = require('../dist/features/digest-clock.js');

test('Telegram digest schedule and idempotency day use Shanghai timezone, not VPS local/UTC time', () => {
  assert.deepEqual(zonedDigestClock('2026-09-27T00:30:00.000Z'), { date: '2026-09-27', minute: '08:30', key: '2026-09-27:08:30' });
  assert.equal(zonedDigestClock('2026-09-26T16:30:00.000Z').key, '2026-09-27:00:30');
  assert.throws(() => zonedDigestClock('not-a-date'), /Invalid digest time/);
});
