const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { buildSignalBoard } = require('../src/features/strategy-signal-board');

const now = Date.parse('2026-10-28T00:00:00Z');
const signal = (overrides) => ({ id: 's1', strategyId: 'momentum', market: 'stocks', instrument: 'stock:us:AAA', action: 'BUY', triggeredAt: now - 86_400_000, evidenceRefs: ['e1'], ...overrides });

test('signal board summarizes consensus, conflicts and evidence gaps', () => {
  const board = buildSignalBoard({ market: 'stocks', now, signals: [
    signal({ id: 's1' }),
    signal({ id: 's2', strategyId: 'mean-reversion', action: 'SELL', evidenceRefs: [] }),
    signal({ id: 's3', strategyId: 'old', action: 'BUY', expiresAt: now - 1000 }),
    signal({ id: 's4', strategyId: 'macro', action: undefined, evidenceRefs: ['e2'] }),
  ] });
  assert.equal(board.rows.length, 1);
  const row = board.rows[0];
  assert.equal(row.longs, 1);
  assert.equal(row.shorts, 1);
  assert.equal(row.unknownDirection, 1);
  assert.equal(row.conflict, true);
  assert.equal(row.consensus, 'mixed');
  assert.equal(row.expired, 1);
  assert.equal(row.missingEvidence, 1);
  assert.equal(row.strategyCount, 3);
  assert.equal(row.stale, false);
  assert.match(board.contentHash, /^[a-f0-9]{64}$/);
});

test('signal board respects as-of time and instrument filter', () => {
  const board = buildSignalBoard({ market: 'stocks', instrument: 'stock:us:AAA', asOf: now - 2 * 86_400_000, now, signals: [
    signal({ id: 'past', triggeredAt: now - 3 * 86_400_000 }),
    signal({ id: 'future', triggeredAt: now - 86_400_000 }),
    signal({ id: 'other', instrument: 'stock:us:BBB' }),
  ] });
  assert.equal(board.rows[0].strategyCount, 1);
  assert.ok(board.excluded.some(row => row.id === 'future' && /之后/.test(row.reason)));
});

test('signal board marks stale saved signals and rejects bad market', () => {
  const board = buildSignalBoard({ market: 'stocks', now, staleAfterMs: 1000, signals: [signal({ triggeredAt: now - 60_000 })] });
  assert.equal(board.rows[0].stale, true);
  assert.throws(() => buildSignalBoard({ market: 'bonds', now, signals: [] }), /市场/);
  assert.throws(() => buildSignalBoard({ market: 'stocks', now, asOf: now + 60_000, signals: [] }), /未来/);
});
