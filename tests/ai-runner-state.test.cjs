const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
require('ts-node/register/transpile-only');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-ai-runner-state-'));
process.env.MONEYMONEY_DATA_DIR = root;
const {
  createAiRunner,
  getAiRunners,
  summarizeRunner,
  runnerOpenPosition,
  updateAiRunnerMarketState,
  recordAiRunnerModelCall,
  listAiRunnerHistory,
  updateAiRunnerPolicy,
} = require('../dist/features/ai-paper-runner');
const { stateStore } = require('../dist/storage/sqlite-state');

test.after(() => { stateStore.close(); fs.rmSync(root, { recursive: true, force: true }); });

test('runner valuation persists fresh marks and preserves the last mark when quotes become stale', () => {
  const runner = createAiRunner('Binance', 'BTCUSDT', 'Bitcoin', 100);
  const at = new Date().toISOString();
  const quote = { market: 'crypto', status: 'live', price: 10, bestBid: 9.9, bestAsk: 10, fetchedAt: at, source: 'Binance depth' };
  assert.equal(runnerOpenPosition(runner.id, 10, 1, 'LONG', 'test', undefined, { quote, source: quote.source, dataAt: at }), true);

  updateAiRunnerMarketState(runner.id, {
    market: 'crypto', status: 'live', source: 'Binance depth', dataAt: at, prices: { BTCUSDT: 12 },
  });
  let saved = getAiRunners().find(item => item.id === runner.id);
  assert.equal(saved.positions[0].currentPrice, 12);
  assert.equal(saved.lastDataStatus, 'live');
  assert.equal(saved.positions[0].maxFavorablePnlUsd, 2);
  assert.equal(saved.equityHistory.length, 1);
  assert.equal(saved.benchmarks.BTCUSDT.currentPrice, 12);

  updateAiRunnerMarketState(runner.id, {
    market: 'crypto', status: 'stale', source: 'Binance depth', dataAt: at, reason: '盘口过期', prices: {},
  });
  saved = getAiRunners().find(item => item.id === runner.id);
  assert.equal(saved.positions[0].currentPrice, 12);
  assert.equal(saved.lastDataStatus, 'stale');
  assert.equal(saved.lastDataReason, '盘口过期');
  assert.equal(saved.positions[0].currentPrice, 12);
  assert.equal(saved.equityHistory.length, 2);
});

test('AI call quota is durably consumed before a model request can fail', () => {
  const runner = createAiRunner('Binance', 'ETHUSDT', 'Ethereum', 100, undefined, { mode: 'ai-review' });
  const calledAt = new Date().toISOString();
  recordAiRunnerModelCall(runner.id, { at: calledAt, model: 'configured-model', decisionId: 'decision-timeout' });
  const saved = getAiRunners().find(item => item.id === runner.id);
  assert.equal(saved.aiCalls.length, 1);
  assert.equal(saved.aiCalls[0].decisionId, 'decision-timeout');
  assert.equal(saved.lastAiCallAt, calledAt);
});

test('runner history supports idempotent decision snapshots and cursor pagination', () => {
  const runner = createAiRunner('Stocks', 'AAPL', 'Apple', 100);
  const row = (id) => ({
    id, runnerId: runner.id, idempotencyKey: id, at: new Date().toISOString(), market: 'stocks', instrument: 'AAPL',
    dataStatus: 'unavailable', signals: [], riskChecks: [], action: 'NONE', reason: id,
  });
  const { appendAiRunnerDecision } = require('../dist/features/ai-paper-runner');
  appendAiRunnerDecision(row('decision-1'));
  appendAiRunnerDecision(row('decision-1'));
  appendAiRunnerDecision(row('decision-2'));
  const first = listAiRunnerHistory(runner.id, undefined, 1);
  const second = listAiRunnerHistory(runner.id, first.nextCursor, 1);
  assert.equal(first.data.length, 1);
  assert.equal(second.data.length, 1);
  assert.notEqual(first.data[0].id, second.data[0].id);
  assert.equal(listAiRunnerHistory(runner.id, undefined, 20).data.length, 2);
});

test('watchlist policy edits cannot widen the frozen universe or exceed the runner budget', () => {
  const runner = createAiRunner('Stocks', 'AAPL', 'Apple', 100, undefined, {
    universe: { kind: 'watchlist', instruments: [
      { venue: 'Stocks', symbolOrMarketId: 'AAPL' },
      { venue: 'Stocks', symbolOrMarketId: 'MSFT' },
    ] },
  });
  updateAiRunnerPolicy(runner.id, {
    allowedSymbols: ['BTCUSDT'], maxTradeUsd: 500, maxBudgetUsd: 900, maxPositions: 99,
    maxDailyLossUsd: 900, maxPerInstrumentUsd: 900, maxInvestedUsd: 900,
  });
  const saved = getAiRunners().find(item => item.id === runner.id);
  assert.deepEqual(saved.policy.allowedSymbols, ['AAPL', 'MSFT']);
  assert.equal(saved.policy.maxTradeUsd <= 100, true);
  assert.equal(saved.policy.maxBudgetUsd <= 100, true);
  assert.equal(saved.policy.maxPositions, 2);
  assert.equal(saved.policy.maxDailyLossUsd <= 100, true);
  assert.equal(saved.policy.maxPerInstrumentUsd <= 100, true);
  assert.equal(saved.policy.maxInvestedUsd <= 100, true);
});

test('runner creation rejects non-finite budget and unsupported runtime strategy values', () => {
  assert.throws(() => createAiRunner('Stocks', 'AAPL', 'Apple', Number.NaN), /预算/);
  assert.throws(() => createAiRunner('Stocks', 'AAPL', 'Apple', 100, undefined, { mode: 'unbounded' }), /跑单模式/);
  assert.throws(() => createAiRunner('Stocks', 'AAPL', 'Apple', 100, undefined, { universe: { kind: 'everything', instruments: [{ venue: 'Stocks', symbolOrMarketId: 'AAPL' }] } }), /范围类型/);
});

test('refreshing one watchlist mark does not make another independently fresh mark stale', () => {
  const runner = createAiRunner('Stocks', 'AAPL', 'Apple', 100, undefined, {
    universe: { kind: 'watchlist', instruments: [
      { venue: 'Stocks', symbolOrMarketId: 'AAPL' },
      { venue: 'Stocks', symbolOrMarketId: 'MSFT' },
    ] },
  });
  updateAiRunnerPolicy(runner.id, { cooldownMinutes: 0 });
  const at = new Date().toISOString();
  for (const symbol of ['AAPL', 'MSFT']) {
    const quote = { market: 'stocks', status: 'delayed', price: 10, bestBid: 9.9, bestAsk: 10, fetchedAt: at, source: 'verified book' };
    assert.equal(runnerOpenPosition(runner.id, 10, 1, 'LONG', 'test', { venue: 'Stocks', symbolOrMarketId: symbol }, { quote, source: quote.source, dataAt: at }), true);
  }
  updateAiRunnerMarketState(runner.id, {
    market: 'stocks', status: 'delayed', source: 'verified book', dataAt: at,
    instrument: 'AAPL', prices: { AAPL: 12 },
  });
  const saved = getAiRunners().find(item => item.id === runner.id);
  assert.equal(saved.positions.find(item => item.instrument?.symbolOrMarketId === 'AAPL').currentPrice, 12);
  assert.equal(saved.positions.find(item => item.instrument?.symbolOrMarketId === 'MSFT').markStatus, 'delayed');
});

test('prediction-market NO valuation requires its actual outcome book and keeps the last mark otherwise', () => {
  const runner = createAiRunner('Predict.fun', '12345', 'Binary event', 100);
  const at = new Date().toISOString();
  const noQuote = { market: 'prediction', status: 'live', price: 0.6, bestBid: 0.59, bestAsk: 0.61, fetchedAt: at, source: 'official orderbook' };
  assert.equal(runnerOpenPosition(runner.id, 0.61, 10, 'NO', 'test', undefined, { quote: noQuote, source: noQuote.source, dataAt: at }), false);
  const { buildPredictFunExecutionQuote, predictionOutcomeQuote } = require('../src/features/runner-prediction-quotes');
  const market = { id: 12345, status: 'REGISTERED', tradingStatus: 'OPEN', isVisible: true, conditionId: 'condition-12345', description: 'Will the event happen?', decimalPrecision: 2,
    outcomes: [{ name: 'YES', onChainId: 'yes-12345' }, { name: 'NO', onChainId: 'no-12345' }] };
  const makeNoQuote = (bid, ask) => predictionOutcomeQuote(buildPredictFunExecutionQuote(market,
    { marketId: 12345, updateTimestampMs: Date.parse(at), bids: [[bid, 100]], asks: [[ask, 100]] }, new Date(at)), 'NO', new Date(at));
  const entryQuote = makeNoQuote(.39, .41);
  assert.equal(entryQuote.bestAsk, .61);
  assert.equal(runnerOpenPosition(runner.id, 0.61, 10, 'NO', 'test', undefined, { quote: entryQuote, source: entryQuote.source, dataAt: at }), false,
    'new prediction positions remain blocked until independently verifiable resolution rules exist');
  const ledger = require('../dist/features/unified-paper-trading').unifiedPaperLedgerStore;
  const seededAccount = ledger.applyRunnerOrder(runner.accountId, runner.id, {
    id: 'legacy-prediction-position', instrumentId: 'prediction:predictfun:12345', instrumentType: 'prediction',
    title: 'Binary event', side: 'NO', outcome: 'NO', price: .61, quantity: 10, timestamp: at,
  }, 100);
  const historicalPosition = {
    id: 'legacy-prediction-position', instrumentId: 'prediction:predictfun:12345',
    instrument: { venue: 'Predict.fun', symbolOrMarketId: '12345', title: 'Binary event' },
    side: 'NO', entryPrice: .61, currentPrice: .61, quantity: 10, entryTime: at,
    markStatus: 'unavailable', markSource: 'prior source', markUpdatedAt: at, status: 'OPEN',
  };
  stateStore.set('ai-paper-runners', getAiRunners().map(item => item.id === runner.id
    ? { ...item, cashUsd: seededAccount.cash, positions: [historicalPosition] }
    : item), 1);
  updateAiRunnerMarketState(runner.id, {
    market: 'prediction', status: 'live', instrument: '12345', source: 'official orderbook', dataAt: at,
    prices: { '12345': 0.4 },
  });
  let saved = getAiRunners().find(item => item.id === runner.id);
  assert.equal(saved.positions[0].currentPrice, 0.61);
  assert.equal(saved.positions[0].markStatus, 'unavailable');
  assert.equal(ledger.getRunnerAccount(saved.accountId).positions[0].markStatus, 'unavailable');
  const actualQuote = makeNoQuote(.43, .45);
  updateAiRunnerMarketState(runner.id, {
    market: 'prediction', status: 'live', instrument: '12345', source: 'official orderbook', dataAt: at,
    executionStatus: 'unsupported', executionReason: 'Predict.fun 官方详情没有独立、可验证的结算规则',
    prices: { '12345': .4 }, outcomeQuotes: { 'prediction:predictfun:12345': actualQuote },
  });
  saved = getAiRunners().find(item => item.id === runner.id);
  assert.ok(Math.abs(saved.positions[0].currentPrice - .56) < 1e-9);
  assert.match(saved.lastDataReason, /没有独立、可验证的结算规则/);
  assert.match(summarizeRunner(saved).valuationReason, /没有独立、可验证的结算规则/);
  assert.ok(Math.abs(saved.positions[0].maxAdversePnlUsd + 0.5) < 1e-9);
  const account = ledger.getRunnerAccount(saved.accountId);
  assert.equal(account.positions[0].outcome, 'NO');
  assert.ok(Math.abs(account.positions[0].currentPrice - .56) < 1e-9);
  actualQuote.predictionContract.instrumentId = 'prediction:predictfun:999';
  updateAiRunnerMarketState(runner.id, { market: 'prediction', status: 'live', instrument: '12345', dataAt: at,
    prices: { '12345': .4 }, outcomeQuotes: { 'prediction:predictfun:12345': actualQuote } });
  saved = getAiRunners().find(item => item.id === runner.id);
  assert.equal(saved.positions[0].markStatus, 'unavailable');
  assert.ok(Math.abs(saved.positions[0].currentPrice - .56) < 1e-9);
  actualQuote.predictionContract.instrumentId = 'prediction:predictfun:12345';
  updateAiRunnerMarketState(runner.id, { market: 'prediction', status: 'live', instrument: '12345', dataAt: at,
    outcomeQuotes: { 'prediction:predictfun:12345': actualQuote } });
  updateAiRunnerMarketState(runner.id, { market: 'prediction', status: 'stale', instrument: '12345', dataAt: at });
  assert.equal(ledger.getRunnerAccount(saved.accountId).positions[0].markStatus, 'stale');
  updateAiRunnerMarketState(runner.id, { market: 'prediction', status: 'live', instrument: '12345', dataAt: at,
    outcomeQuotes: { 'prediction:predictfun:12345': { ...actualQuote, market: 'stocks', price: .9 } } });
  saved = getAiRunners().find(item => item.id === runner.id);
  assert.equal(saved.positions[0].markStatus, 'unavailable');
  assert.ok(Math.abs(saved.positions[0].currentPrice - .56) < 1e-9);
});

test('legacy runner records without a verifiable isolated ledger remain read-only and are not guessed into a new account', () => {
  stateStore.set('ai-paper-runners', [{
    id: 'legacy-runner', venue: 'Stocks', symbolOrMarketId: 'AAPL', title: 'Legacy', budgetUsd: 100, cashUsd: 100,
    status: 'RUNNING', createdAt: '2026-09-01T00:00:00.000Z', positions: [], trades: [], peakEquityUsd: 100,
    policy: { maxTradeUsd: 20, maxBudgetUsd: 100, maxPositions: 1, maxDailyLossUsd: 10, maxDrawdownPct: 20, minFreshnessMs: 120000, cooldownMinutes: 15, allowedSymbols: ['AAPL'] },
  }], 1);
  const legacy = getAiRunners()[0];
  assert.equal(legacy.executionState, 'legacy-readonly');
  assert.equal(require('../dist/features/unified-paper-trading').unifiedPaperLedgerStore.getRunnerAccount(legacy.accountId), null);
});

test('prediction runner does not present an untyped YES probability as a side-neutral holding benchmark', () => {
  const summary = summarizeRunner({
    id: 'prediction-benchmark', venue: 'Predict.fun', symbolOrMarketId: '12345', title: 'Event', budgetUsd: 100, cashUsd: 100,
    status: 'RUNNING', createdAt: new Date().toISOString(), positions: [], trades: [], peakEquityUsd: 100,
    policy: { allowedSymbols: ['12345'], maxTradeUsd: 20, maxBudgetUsd: 100, maxPositions: 1, maxDailyLossUsd: 10, maxDrawdownPct: 20, minFreshnessMs: 120000, cooldownMinutes: 15 },
    universe: { kind: 'single', market: 'prediction', instruments: [{ venue: 'Predict.fun', symbolOrMarketId: '12345' }], hash: 'h', frozenAt: new Date().toISOString() },
    accountId: 'ai-runner:prediction-benchmark', executionState: 'ready',
  });
  assert.equal(summary.benchmarkPnlUsd, null);
  assert.match(summary.benchmarkReason, /YES\/NO/);
});
