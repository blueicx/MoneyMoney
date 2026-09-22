const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SQLiteStateStore } = require('../dist/storage/sqlite-state');
const { UnifiedPaperLedgerStore, emptyUnifiedPaperLedger } = require('../dist/features/unified-paper-trading');

test('legacy prediction portfolio migrates into the unified ledger once without duplicating capital', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-migration-'));
  const db = new SQLiteStateStore(path.join(dir, 'state.sqlite'), dir);
  try {
    db.set('paper-ledger', emptyUnifiedPaperLedger(1000));
    const store = new UnifiedPaperLedgerStore(db);
    const legacy = {
      startingBalance: 1000, cashBalance: 800, positions: [{ id: 'old-1', marketId: 42, marketTitle: 'Event', outcomeIndex: 0, outcomeName: 'YES', entryPrice: 0.5, currentPrice: 0.6, quantity: 400, entryTime: '2026-01-01T00:00:00Z', status: 'OPEN' }], tradeLog: [], totalPnl: 0, winsCount: 0, lossesCount: 0, maxDrawdownPct: 0, peakEquity: 1000,
    };
    const migrated = store.migrateLegacyPredictionPortfolio(legacy);
    assert.equal(migrated.startingCash, 2000);
    assert.equal(migrated.cash, 1800);
    assert.equal(migrated.positions.length, 1);
    assert.equal(migrated.positions[0].outcome, 'YES');
    assert.equal(migrated.orders.length, 1);
    assert.equal(store.migrateLegacyPredictionPortfolio(legacy).orders.length, 1);
    assert.equal(store.migrateLegacyPredictionPortfolio(legacy).startingCash, 2000);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
