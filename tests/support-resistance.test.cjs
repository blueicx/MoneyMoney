const assert = require('node:assert/strict');
const { supportResistanceRecencyScore } = require('../dist/features/support-resistance');

assert.equal(supportResistanceRecencyScore(1_000, 0, 1_000), 30);
assert.equal(supportResistanceRecencyScore(0, 0, 1_000), 0);
assert.ok(supportResistanceRecencyScore(800, 0, 1_000) > supportResistanceRecencyScore(200, 0, 1_000));
assert.equal(supportResistanceRecencyScore(2_000, 0, 1_000), 30, 'future timestamps are treated as current, not rewarded above the cap');

console.log('support/resistance scoring: all assertions passed');
