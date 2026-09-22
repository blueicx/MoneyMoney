const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const paper = require('../dist/features/unified-paper-trading');
const { SQLiteStateStore } = require('../dist/storage/sqlite-state');

const order = (extra = {}) => ({ instrumentId: 'prediction:predictfun:42', instrumentType: 'prediction', side: 'YES', price: 0.4, quantity: 10, timestamp: '2026-09-22T00:00:00Z', ...extra });

test('prediction outcomes close independently and retain realized PnL', () => {
  let ledger = paper.applyUnifiedPaperOrder(paper.emptyUnifiedPaperLedger(), order());
  ledger = paper.applyUnifiedPaperOrder(ledger, order({ side: 'NO', price: 0.6 }));
  ledger = paper.applyUnifiedPaperOrder(ledger, order({ side: 'SELL', outcome: 'YES', price: 0.7, quantity: 5 }));
  assert.equal(ledger.realizedPnl, 1.5);
  assert.equal(ledger.positions.find(p => p.outcome === 'YES').quantity, 5);
  assert.equal(ledger.positions.find(p => p.outcome === 'NO').quantity, 10);
  assert.throws(() => paper.applyUnifiedPaperOrder(ledger, order({ side: 'SELL', price: 0.7 })), /outcome|YES|NO/);
});

test('ledger instances share committed state and order IDs prevent duplicate fills', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-reliability-'));
  const db = new SQLiteStateStore(path.join(dir, 'state.sqlite'), dir);
  try {
    const a = new paper.UnifiedPaperLedgerStore(db);
    const b = new paper.UnifiedPaperLedgerStore(db);
    a.apply(order({ id: 'once' }));
    b.apply(order({ id: 'once' }));
    assert.equal(a.get().orders.length, 1);
    assert.equal(a.get().cash, 996);
    b.apply(order({ id: 'second', side: 'NO' }));
    assert.equal(a.get().orders.length, 2);
    assert.equal(a.get().cash, 992);
    assert.throws(() => a.apply(order({ id: 'once', quantity: 20 })), /幂等|ID|重复/);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
