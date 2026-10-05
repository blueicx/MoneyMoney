const assert = require('node:assert/strict');
const test = require('node:test');
const {
  freezeAiRunnerUniverse,
  getAiRunnerRiskDefaults,
  evaluateRunnerQuoteGate,
  resolveRunnerFill,
  calculateRunnerExecutionCosts,
  isAiRunnerCallAllowed,
  validateAiRunnerModelIntent,
  evaluateAiRunnerTrigger,
  normalizeAiRunnerStockKlines,
  evaluateRunnerOpen,
  evaluateRunnerIndicatorEvidence,
} = require('../dist/features/ai-paper-runner');

test('a frozen watchlist universe is stable, immutable, and contains one market only', () => {
  const at = new Date('2026-10-05T00:00:00.000Z');
  const universe = freezeAiRunnerUniverse([
    { venue: 'Stocks', symbolOrMarketId: 'NVDA', title: 'NVIDIA' },
    { venue: 'Stocks', symbolOrMarketId: 'AAPL', title: 'Apple' },
  ], { kind: 'watchlist', sourceWatchlistId: 'tech' }, at);
  const reversed = freezeAiRunnerUniverse([
    { venue: 'Stocks', symbolOrMarketId: 'AAPL', title: 'Apple' },
    { venue: 'Stocks', symbolOrMarketId: 'NVDA', title: 'NVIDIA' },
  ], { kind: 'watchlist', sourceWatchlistId: 'tech' }, at);

  assert.equal(universe.hash, reversed.hash);
  assert.equal(universe.instruments.length, 2);
  assert.equal(Object.isFrozen(universe), true);
  assert.equal(Object.isFrozen(universe.instruments), true);
  assert.throws(() => freezeAiRunnerUniverse([
    { venue: 'Stocks', symbolOrMarketId: 'AAPL' },
    { venue: 'Binance', symbolOrMarketId: 'BTCUSDT' },
  ], { kind: 'watchlist' }, at), /不能跨市场/);
  assert.throws(() => freezeAiRunnerUniverse([
    { venue: 'Binance', symbolOrMarketId: 'BTCETH' },
  ], { kind: 'single' }, at), /USDT 计价/);
});

test('watchlist risk defaults cap per-symbol and total exposure with daily-loss and drawdown brakes', () => {
  const risk = getAiRunnerRiskDefaults(1000, 'watchlist');
  assert.equal(risk.maxPositions, 5);
  assert.equal(risk.maxPerInstrumentUsd, 200);
  assert.equal(risk.maxInvestedUsd, 800);
  assert.equal(risk.maxDailyLossUsd, 100);
  assert.equal(risk.maxDrawdownPct, 20);
});

test('stale, cached, failed, or future-dated quotes cannot authorize a runner order', () => {
  const policy = { minFreshnessMs: 120_000 };
  const now = new Date('2026-10-05T00:10:00.000Z');
  const valid = { status: 'delayed', price: 10, fetchedAt: '2026-10-05T00:09:30.000Z', source: 'verified-provider' };
  assert.equal(evaluateRunnerQuoteGate(policy, valid, now).allowed, true);
  assert.equal(evaluateRunnerQuoteGate(policy, { ...valid, status: 'cached' }, now).reason, '缓存报价不能触发新订单');
  assert.equal(evaluateRunnerQuoteGate(policy, { ...valid, status: 'failed' }, now).reason, '行情来源不可用');
  assert.equal(evaluateRunnerQuoteGate(policy, { ...valid, fetchedAt: '2026-10-05T00:00:00.000Z' }, now).reason, '报价已过期');
  assert.equal(evaluateRunnerQuoteGate(policy, { ...valid, fetchedAt: '2026-10-05T00:11:00.000Z' }, now).reason, '报价时间无效');
});

test('simulated market buys execute at ask and sells at bid with explicit spread and fee costs', () => {
  const risk = { minFreshnessMs: 120_000, feeRateBps: 10, additionalSlippageBps: 0 };
  const quote = { status: 'live', price: 100, bestBid: 99, bestAsk: 101, fetchedAt: '2026-10-05T00:09:30.000Z', source: 'book' };
  const now = new Date('2026-10-05T00:10:00.000Z');

  const buy = resolveRunnerFill(risk, quote, 'BUY', now);
  const sell = resolveRunnerFill(risk, quote, 'SELL', now);
  assert.equal(buy.price, 101);
  assert.equal(sell.price, 99);
  assert.deepEqual(calculateRunnerExecutionCosts(risk, quote, 'BUY', 2), { feeUsd: 0.202, slippageUsd: 0, spreadUsd: 2 });
  assert.deepEqual(calculateRunnerExecutionCosts({ ...risk, additionalSlippageBps: 10 }, quote, 'BUY', 2), { feeUsd: 0.202, slippageUsd: 0.202, spreadUsd: 2 });
  assert.equal(resolveRunnerFill(risk, { ...quote, bestAsk: undefined }, 'BUY', now).reason, '盘口缺少有效买卖价，无法确认模拟成交');
});

test('AI runner call quota fails closed at 24 calls per UTC day and requires configured OpenRouter', () => {
  const runner = {
    aiCalls: Array.from({ length: 24 }, (_, index) => ({ at: `2026-10-05T${String(index).padStart(2, '0')}:00:00.000Z` })),
  };
  const now = new Date('2026-10-05T23:59:00.000Z');
  assert.equal(isAiRunnerCallAllowed(runner, true, now).reason, '已达到该跑单每日 24 次 AI 调用上限');
  assert.equal(isAiRunnerCallAllowed({ aiCalls: [] }, false, now).reason, '未配置 OpenRouter，AI 跑单不可用');
  assert.equal(isAiRunnerCallAllowed({ aiCalls: [{ at: '2026-10-04T23:59:00.000Z' }] }, true, now).allowed, true);
});

test('AI model intent accepts only a frozen-universe instrument and a bounded structured rationale', () => {
  const runner = { universe: { market: 'stocks', instruments: [{ venue: 'Stocks', symbolOrMarketId: 'AAPL' }] } };
  const valid = { action: 'BUY', instrument: 'AAPL', confidence: 0.7, rationale: '趋势与成交量同步', counterEvidence: ['财报前波动风险'], riskNotes: ['仅使用模拟资金'] };
  assert.equal(validateAiRunnerModelIntent(valid, runner).ok, true);
  assert.equal(validateAiRunnerModelIntent({ ...valid, instrument: 'BTCUSDT' }, runner).reason, 'AI 意图标的不在冻结范围内');
  assert.equal(validateAiRunnerModelIntent({ ...valid, budgetUsd: 999999 }, runner).reason, 'AI 意图包含未允许的字段');
  assert.equal(validateAiRunnerModelIntent('{not-json', runner).reason, 'AI 意图格式无效');
});

test('AI runner triggers enforce hourly scheduled scans and a 15-minute signal cooldown', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  assert.equal(evaluateAiRunnerTrigger({ mode: 'ai-review', trigger: 'scheduled', lastAiCallAt: '2026-10-05T11:30:00.000Z' }, true, now).reason, '定时 AI 扫描每小时最多一次');
  assert.equal(evaluateAiRunnerTrigger({ mode: 'ai-review', trigger: 'scheduled' }, false, now).allowed, true);
  assert.equal(evaluateAiRunnerTrigger({ mode: 'ai-review', trigger: 'signal' }, false, now).reason, '当前没有候选信号');
  assert.equal(evaluateAiRunnerTrigger({ mode: 'ai-review', trigger: 'signal', lastAiCallAt: '2026-10-05T11:50:00.000Z' }, true, now).reason, '候选信号触发至少间隔 15 分钟');
});

test('Tencent daily stock fields normalize into OHLC order with the true close at index four', () => {
  const rows = normalizeAiRunnerStockKlines([['2026-10-01', '100', '107', '110', '98', '5000']]);
  assert.deepEqual(rows[0], [new Date('2026-10-01').getTime(), 100, 110, 98, 107, 5000]);
});

test('stale, unavailable, future-dated, or historical indicator evidence cannot authorize a live strategy signal', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  const fresh = { status: 'live', dataAt: '2026-10-05T11:59:00.000Z', retrievedAt: '2026-10-05T11:59:10.000Z' };
  assert.equal(evaluateRunnerIndicatorEvidence(fresh, 120_000, now).allowed, true);
  assert.equal(evaluateRunnerIndicatorEvidence({ ...fresh, status: 'stale' }, 120_000, now).allowed, false);
  assert.equal(evaluateRunnerIndicatorEvidence({ ...fresh, status: 'historical' }, 120_000, now).allowed, false);
  assert.equal(evaluateRunnerIndicatorEvidence({ ...fresh, dataAt: '2026-10-05T12:01:00.000Z' }, 120_000, now).reason, '指标数据时间晚于当前决策时间');
  assert.equal(evaluateRunnerIndicatorEvidence({ status: 'unavailable' }, 120_000, now).reason, '指标数据不可用');
});

test('a closed single-instrument trade releases exposure for a later position within the remaining cash budget', () => {
  const runner = {
    status: 'RUNNING', executionState: 'ready', cashUsd: 50, budgetUsd: 100, positions: [], lastActionAt: undefined,
    universe: { kind: 'single', instruments: [{ venue: 'Binance', symbolOrMarketId: 'BTCUSDT' }] },
    trades: [{ action: 'BUY', price: 100, quantity: 1 }, { action: 'SELL', price: 110, quantity: 1 }],
    policy: { maxTradeUsd: 100, maxBudgetUsd: 100, maxPositions: 1, maxDailyLossUsd: 20, cooldownMinutes: 0 },
  };
  assert.equal(evaluateRunnerOpen(runner, 40, new Date()).allowed, true);
});
