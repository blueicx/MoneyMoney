const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateRunnerOpen } = require('../dist/features/ai-paper-runner');

const baseRunner = {
  status: 'RUNNING', cashUsd: 100, lastActionAt: undefined,
  policy: { maxTradeUsd: 25, maxBudgetUsd: 100, maxPositions: 1, maxDailyLossUsd: 10, maxDrawdownPct: 20, minFreshnessMs: 120000, cooldownMinutes: 15, allowedSymbols: ['BTCUSDT'] },
  positions: [],
};

test('AI runner policy blocks oversized trades and allows a bounded trade', () => {
  assert.equal(evaluateRunnerOpen(baseRunner, 20, new Date('2026-09-01T00:00:00Z')).allowed, true);
  assert.equal(evaluateRunnerOpen(baseRunner, 26, new Date('2026-09-01T00:00:00Z')).reason, '超过策略单笔限额');
});

test('AI runner policy blocks a second open position and cooldown violations', () => {
  const occupied = { ...baseRunner, positions: [{ status: 'OPEN' }] };
  assert.equal(evaluateRunnerOpen(occupied, 10).reason, '达到策略最大持仓数');
  const cooling = { ...baseRunner, lastActionAt: '2026-09-01T00:00:00.000Z' };
  assert.equal(evaluateRunnerOpen(cooling, 10, new Date('2026-09-01T00:05:00Z')).reason, '处于策略冷却时间');
});

test('a closed position releases invested-budget exposure while an open position still consumes it', () => {
  const closed = {
    ...baseRunner,
    policy: { ...baseRunner.policy, maxTradeUsd: 30, maxPositions: 3, maxBudgetUsd: 30 },
    trades: [{ action: 'BUY', price: 20, quantity: 1 }],
    positions: [{ status: 'CLOSED', entryPrice: 20, quantity: 1, pnlUsd: 5 }],
  };
  assert.equal(evaluateRunnerOpen(closed, 30).allowed, true);
  const open = { ...closed, positions: [{ status: 'OPEN', entryPrice: 20, quantity: 1 }] };
  assert.equal(evaluateRunnerOpen(open, 10).allowed, true);
  assert.equal(evaluateRunnerOpen(open, 11).reason, '超过策略预算');
});

test('daily-loss circuit includes entry and exit fees and slippage', () => {
  const closedWithCosts = {
    ...baseRunner,
    policy: { ...baseRunner.policy, maxDailyLossUsd: 10, maxPositions: 2 },
    positions: [{ status: 'CLOSED', pnlUsd: -9, exitTime: '2026-09-01T12:00:00.000Z', entryFeeUsd: 0.5, exitFeeUsd: 0.5, entrySlippageUsd: 0, exitSlippageUsd: 0 }],
  };
  assert.equal(evaluateRunnerOpen(closedWithCosts, 1, new Date('2026-09-01T13:00:00.000Z')).reason, '触发策略单日亏损熔断');
});

test('AI runner watchlist policy enforces per-instrument exposure separately from total exposure', () => {
  const watchlist = {
    ...baseRunner,
    cashUsd: 700,
    universe: { kind: 'watchlist' },
    policy: { ...baseRunner.policy, maxTradeUsd: 250, maxPositions: 5, maxBudgetUsd: 800, maxInvestedUsd: 800, maxPerInstrumentUsd: 200 },
    positions: [{ status: 'OPEN', entryPrice: 100, quantity: 1, instrumentId: 'stock:us:AAPL' }],
  };
  assert.equal(evaluateRunnerOpen(watchlist, 101, new Date('2026-10-05T00:00:00Z'), 'stock:us:AAPL').reason, '超过单标的投入上限');
  assert.equal(evaluateRunnerOpen(watchlist, 101, new Date('2026-10-05T00:00:00Z'), 'stock:us:NVDA').allowed, true);
  const nearCap = { ...watchlist, positions: [...watchlist.positions, { status: 'OPEN', entryPrice: 650, quantity: 1, instrumentId: 'stock:us:NVDA' }] };
  assert.equal(evaluateRunnerOpen(nearCap, 51, new Date('2026-10-05T00:00:00Z'), 'stock:us:MSFT').reason, '超过组合总投入上限');
});
