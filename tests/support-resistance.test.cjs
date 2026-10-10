const assert = require('node:assert/strict');
const { supportResistanceRecencyScore, analyzeSupportResistance } = require('../dist/features/support-resistance');

assert.equal(supportResistanceRecencyScore(1_000, 0, 1_000), 30);
assert.equal(supportResistanceRecencyScore(0, 0, 1_000), 0);
assert.ok(supportResistanceRecencyScore(800, 0, 1_000) > supportResistanceRecencyScore(200, 0, 1_000));
assert.equal(supportResistanceRecencyScore(2_000, 0, 1_000), 30, 'future timestamps are treated as current, not rewarded above the cap');

assert.equal(typeof analyzeSupportResistance, 'function', 'the shared OHLC analyzer must support stock and crypto source bars');
const bars = Array.from({ length: 90 }, (_, index) => {
  const highPivot = [12, 34, 56, 78].includes(index);
  const lowPivot = [20, 42, 64, 84].includes(index);
  return { time: Date.UTC(2026, 0, 1) + index * 86_400_000, open: 100, high: highPivot ? 110 : 101, low: lowPivot ? 90 : 99, close: 100, volume: 1000 };
});
const analyzed = analyzeSupportResistance('AAPL', '1d', bars);
assert.equal(analyzed.symbol, 'AAPL');
assert.equal(analyzed.interval, '1d');
assert.ok(analyzed.supports.some(row => row.price === 90));
assert.ok(analyzed.resistances.some(row => row.price === 110));
assert.throws(() => analyzeSupportResistance('AAPL', '1d', bars.slice(0, 20)), /30/);

console.log('support/resistance scoring: all assertions passed');
