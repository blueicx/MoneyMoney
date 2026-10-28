const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { analyzeCrossSection, runRollingFactorValidation } = require('../src/features/factor-cross-section');

const universe = {
  id: 'historical_universe_00000000-0000-0000-0000-000000000001',
  contentHash: 'a'.repeat(64),
  members: [
    { instrument: 'stock:us:AAA', industry: 'tech', status: 'active' },
    { instrument: 'stock:us:BBB', industry: 'tech', status: 'active' },
    { instrument: 'stock:us:CCC', industry: 'tech', status: 'active' },
    { instrument: 'stock:us:DDD', industry: 'energy', status: 'active' },
    { instrument: 'stock:us:EEE', industry: 'energy', status: 'delisted' },
    { instrument: 'stock:us:FFF', industry: 'energy', status: 'active' },
    { instrument: 'stock:us:GGG', industry: null, status: 'unknown' },
  ],
};
const observation = (instrument, value, forwardReturn = null, industry = null) => ({ instrument, evidenceId: 'evidence-' + instrument, value, forwardReturn, industry });

test('cross-section matches only universe members and preserves exclusions', () => {
  const result = analyzeCrossSection({ universe, observations: [
    observation('stock:us:AAA', 10, 1), observation('stock:us:BBB', 20, 2), observation('stock:us:CCC', 30, 3),
    observation('stock:us:DDD', 5, 1), observation('stock:us:EEE', 15, 2), observation('stock:us:FFF', 25, 3),
    observation('stock:us:GGG', 12, 0),
    observation('stock:us:ZZZ', 99, 9),
  ] });
  assert.equal(result.universeId, universe.id);
  assert.equal(result.universeHash, universe.contentHash);
  assert.equal(result.matched, 7);
  assert.equal(result.universeSize, 7);
  assert.ok(result.excluded.some(row => row.instrument === 'stock:us:ZZZ'));
  assert.equal(result.industryNeutral.industriesUsed, 2);
  assert.equal(result.industryNeutral.industriesInsufficient.length, 0);
  assert.equal(result.groups.length, 5);
  assert.ok(result.groups.some(group => group.averageForwardReturn !== null));
  assert.equal(typeof result.rankIc, 'number');
  assert.match(result.methodologyRef, /^factor-cross-section@1$/);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
});

test('cross-section refuses duplicate instruments and non-members are excluded', () => {
  assert.throws(() => analyzeCrossSection({ universe, observations: [
    observation('stock:us:AAA', 10), observation('stock:us:AAA', 11),
  ] }), /重复/);
  const result = analyzeCrossSection({ universe, observations: [observation('stock:us:ZZZ', 10)] });
  assert.equal(result.dataStatus, 'unavailable');
  assert.equal(result.matched, 0);
  assert.equal(result.rankIc, null);
});

test('missing industry falls back to global standardization with a warning', () => {
  const result = analyzeCrossSection({ universe, observations: universe.members.map((member, index) => observation(member.instrument, index + 1, index)) });
  assert.equal(result.industryNeutral.available, true);
  assert.match(result.survivorshipWarning, /缺失行业/);
});

test('rolling validation reports folds and insufficient windows', () => {
  const periods = Array.from({ length: 6 }, (_, period) => ({
    asOf: `2026-0${period + 1}-01T00:00:00Z`,
    observations: ['stock:us:AAA', 'stock:us:BBB', 'stock:us:CCC'].map((instrument, index) => observation(instrument, period * 3 + index + 1, period * 3 + index + 1)),
  }));
  const result = runRollingFactorValidation({ periods, trainPeriods: 2, testPeriods: 1, minSamples: 3 });
  assert.equal(result.folds.length, 4);
  assert.ok(result.folds.every(fold => fold.status === 'ready'));
  assert.equal(result.dataStatus, 'ready');
  assert.equal(result.testHitRate, 1);
  assert.match(result.methodologyRef, /^rolling-oos@1$/);
});

test('rolling validation refuses too few periods', () => {
  assert.throws(() => runRollingFactorValidation({ periods: [{ asOf: '2026-01-01T00:00:00Z', observations: [] }], trainPeriods: 1, testPeriods: 1 }), /至少/);
});
