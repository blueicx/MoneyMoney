const assert = require('node:assert/strict');

const {
  EVENT_REMINDER_THRESHOLDS_MINUTES,
  getReachedEventReminderThreshold,
  decideEventReminder,
  compareEventValues,
  classifyEventResult,
} = require('../dist/features/event-alerts');

assert.deepEqual([...EVENT_REMINDER_THRESHOLDS_MINUTES], [1440, 720, 360, 180, 60, 30, 10, 5]);
assert.equal(getReachedEventReminderThreshold(800), 1440);
assert.equal(getReachedEventReminderThreshold(700), 720);
assert.equal(getReachedEventReminderThreshold(9), 10);
assert.equal(getReachedEventReminderThreshold(4), 5);
assert.equal(getReachedEventReminderThreshold(1500), null);

assert.deepEqual(decideEventReminder(700, null, false), { stage: 720, shouldSend: false });
assert.deepEqual(decideEventReminder(350, 720, true), { stage: 360, shouldSend: true });
assert.deepEqual(decideEventReminder(4, 720, true), { stage: 5, shouldSend: true });
assert.deepEqual(decideEventReminder(-1, 5, true), { stage: null, shouldSend: false });

assert.equal(compareEventValues('3.2%', '3.0%'), 'above');
assert.equal(compareEventValues('2.9%', '3.0%'), 'below');
assert.equal(compareEventValues('3.0%', '3.0%'), 'inline');
assert.equal(compareEventValues('N/A', '3.0%'), 'unknown');
assert.equal(classifyEventResult('CPI m/m', 'above'), 'bearish');
assert.equal(classifyEventResult('Non-Farm Employment Change', 'above'), 'bullish');
assert.equal(classifyEventResult('Unknown Indicator', 'above'), 'neutral');

console.log('event alert helpers: all assertions passed');
