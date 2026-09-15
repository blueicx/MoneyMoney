const test = require('node:test');
const { strict: assert } = require('node:assert');
const { StrategyCandidateRegistry } = require('../dist/features/strategy-candidates.js');

test('candidate registry requires a passing gate and explicit approval before monitoring', () => {
  const registry = new StrategyCandidateRegistry();
  const draft = registry.saveDraft({ id: 's1', market: 'stocks', instrument: 'AAPL', version: '1.0.0', metrics: { oosReturnPct: -2, trades: 2 } });
  assert.equal(draft.status, 'draft');
  const pending = registry.evaluate('s1', { minOutOfSampleReturnPct: 0, minTrades: 5 });
  assert.equal(pending.status, 'pending');
  assert.equal(registry.canMonitor('s1'), false);
  assert.throws(() => registry.approve('s1'), /gate/);
  registry.evaluate('s1', { minOutOfSampleReturnPct: -5, minTrades: 1 });
  assert.equal(registry.approve('s1').status, 'approved');
  assert.equal(registry.canMonitor('s1'), true);
});

test('candidate registry preserves market isolation', () => {
  const registry = new StrategyCandidateRegistry();
  assert.throws(() => registry.saveDraft({ id: 'bad', market: 'stocks', instrument: 'crypto:BTCUSDT', version: '1', metrics: {} }), /does not belong/);
});
