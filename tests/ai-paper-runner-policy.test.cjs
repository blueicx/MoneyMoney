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

test('AI runner policy treats max budget as cumulative BUY commitment', () => {
  const committed = {
    ...baseRunner,
    policy: { ...baseRunner.policy, maxPositions: 3, maxBudgetUsd: 30 },
    trades: [{ action: 'BUY', price: 20, quantity: 1 }],
  };
  assert.equal(evaluateRunnerOpen(committed, 10).allowed, true);
  assert.equal(evaluateRunnerOpen(committed, 11).reason, '超过策略预算');
});
