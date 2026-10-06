const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SQLiteStateStore } = require('../dist/storage/sqlite-state');
const { UnifiedPaperLedgerStore, calculateUnifiedPerformance } = require('../dist/features/unified-paper-trading');

function withLedger(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-ai-ledger-'));
  const state = new SQLiteStateStore(path.join(root, 'state.sqlite'), root);
  try { run(new UnifiedPaperLedgerStore(state)); }
  finally { state.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

const order = (id, timestamp, side = 'BUY', price = 10, quantity = 2) => ({
  id,
  instrumentId: 'crypto:binance:BTCUSDT',
  instrumentType: 'crypto',
  title: 'BTC/USDT',
  side,
  price,
  quantity,
  timestamp,
  strategy: 'ai-runner',
  strategyVersion: 'rules-v1',
  reason: 'test fill',
});

test('AI runner orders live in an isolated unified-ledger subaccount', () => {
  withLedger(ledger => {
    ledger.applyRunnerOrder('ai-runner:r1', 'r1', order('r1-o1', '2026-10-05T00:00:00.000Z'), 100);

    const manual = ledger.get();
    const account = ledger.getRunnerAccount('ai-runner:r1');
    assert.equal(manual.cash, 1000);
    assert.equal(manual.orders.length, 0);
    assert.equal(account.cash, 80);
    assert.equal(account.orders[0].runnerId, 'r1');
    assert.equal(account.orders[0].accountId, 'ai-runner:r1');
  });
});

test('runner subaccounts are initialized and survive resets of the manual paper account', () => {
  withLedger(ledger => {
    ledger.ensureRunnerAccount('ai-runner:r1', 'r1', 100);
    ledger.reset(250);

    assert.equal(ledger.get().cash, 250);
    assert.equal(ledger.getRunnerAccount('ai-runner:r1').cash, 100);
    assert.equal(ledger.getRunnerAccount('ai-runner:r1').runnerId, 'r1');
  });
});

test('AI runner order idempotency is scoped to its account and preserves the first fill', () => {
  withLedger(ledger => {
    const first = ledger.applyRunnerOrder('ai-runner:r1', 'r1', order('same-order', '2026-10-05T00:00:00.000Z'), 100);
    const duplicate = ledger.applyRunnerOrder('ai-runner:r1', 'r1', order('same-order', '2026-10-05T00:00:00.000Z'), 100);

    assert.equal(duplicate.orders.length, first.orders.length);
    assert.equal(duplicate.cash, first.cash);
    assert.throws(() => ledger.applyRunnerOrder('ai-runner:r1', 'r1', order('same-order', '2026-10-05T00:01:00.000Z', 'BUY', 11), 100), /重复订单 ID/);
  });
});

test('spread is recorded for analysis but not charged twice after fills already execute at bid and ask', () => {
  withLedger(ledger => {
    ledger.applyRunnerOrder('ai-runner:r1', 'r1', { ...order('buy', '2026-10-05T00:00:00.000Z', 'BUY', 101, 2), feeUsd: 0.202, spreadUsd: 2 }, 1000);
    const closed = ledger.applyRunnerOrder('ai-runner:r1', 'r1', { ...order('sell', '2026-10-05T00:01:00.000Z', 'SELL', 99, 2), feeUsd: 0.198, spreadUsd: 2 }, 1000);
    const performance = calculateUnifiedPerformance(closed);

    assert.equal(closed.orders.reduce((sum, row) => sum + Number(row.spreadUsd || 0), 0), 4);
    assert.equal(performance.feeSlippageTotal, 0.4);
    assert.equal(performance.totalPnl, -4.4);
    assert.equal(performance.cash, 995.6);
  });
});

test('separate AI runners cannot spend or mark one another’s balances and positions', () => {
  withLedger(ledger => {
    ledger.applyRunnerOrder('ai-runner:r1', 'r1', order('r1-o1', '2026-10-05T00:00:00.000Z'), 100);
    ledger.applyRunnerOrder('ai-runner:r2', 'r2', order('r2-o1', '2026-10-05T00:00:00.000Z'), 50);

    assert.equal(ledger.getRunnerAccount('ai-runner:r1').cash, 80);
    assert.equal(ledger.getRunnerAccount('ai-runner:r2').cash, 30);
    assert.equal(ledger.getRunnerAccount('ai-runner:r1').orders.length, 1);
    assert.equal(ledger.getRunnerAccount('ai-runner:r2').orders.length, 1);
  });
});

test('stale runner quotes preserve the last confirmed mark and expose stale valuation status', () => {
  withLedger(ledger => {
    ledger.applyRunnerOrder('ai-runner:r1', 'r1', order('r1-o1', '2026-10-05T00:00:00.000Z'), 100);
    ledger.markRunnerAccountPrices('ai-runner:r1', new Map([['crypto:binance:BTCUSDT', 12]]), {
      status: 'live', source: 'Binance depth', updatedAt: '2026-10-05T00:01:00.000Z',
    });
    const stale = ledger.markRunnerAccountPrices('ai-runner:r1', new Map(), {
      status: 'stale', source: 'Binance depth', updatedAt: '2026-10-05T00:03:00.000Z', reason: '盘口过期',
    });

    assert.equal(stale.positions[0].currentPrice, 12);
    assert.equal(stale.positions[0].markStatus, 'live');
    assert.equal(stale.valuationStatus, 'stale');
    assert.equal(stale.valuationReason, '盘口过期');
  });
});
