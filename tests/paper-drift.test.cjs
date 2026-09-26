const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { analyzePaperDrift, analyzePaperDriftByStrategy, collectPaperDriftSamples, summarizePaperDriftCoverage, samePaperInstrument, StrategyDriftGate } = require('../dist/features/paper-drift');
const { SignalMonitor } = require('../dist/features/signal-monitor');

function sample(index, overrides = {}) {
  return {
    market: 'stocks', instrumentId: 'stock:us:AAPL', strategyId: 'test-ma', strategyVersion: 'v1',
    experimentId: 'exp-test', signalId: `signal-${index}`, dataSnapshotId: 'snapshot-test',
    timestamp: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    dataStatus: 'live', paperPrice: 100, paperQuantity: 1, paperSlippageUsd: 0.25,
    expectedSlippageUsd: 0.1, paperNetPnlUsd: 1, expectedNetPnlUsd: 7,
    ...overrides,
  };
}

test('drift requires 20 explicitly linked fresh fills and pauses only that strategy', () => {
  const samples = Array.from({ length: 20 }, (_, index) => sample(index));
  const below = analyzePaperDrift(samples.slice(0, 19), new Date('2026-09-25T00:00:00.000Z'));
  assert.equal(below.status, 'insufficient');
  const result = analyzePaperDrift(samples, new Date('2026-09-25T00:00:00.000Z'));
  assert.equal(result.status, 'paused');
  assert.equal(result.pairedCount, 20);
  assert.ok(result.slippageRatio > 2);
  assert.ok(result.netReturnGapPp > 5);
  assert.equal(analyzePaperDrift(samples.map(item => ({ ...item, dataStatus: 'cached' })), new Date('2026-09-25T00:00:00.000Z')).status, 'insufficient');
  assert.equal(analyzePaperDrift(samples.map(item => ({ ...item, experimentId: undefined })), new Date('2026-09-25T00:00:00.000Z')).status, 'insufficient');
});

test('drift metrics never combine two strategies into a false twenty-trade decision', () => {
  const mixed = Array.from({ length: 10 }, (_, index) => sample(index)).concat(
    Array.from({ length: 10 }, (_, index) => sample(index + 10, { strategyId: 'another-strategy' })),
  );
  const groups = analyzePaperDriftByStrategy(mixed, new Date('2026-09-25T00:00:00.000Z'));
  assert.equal(groups.length, 2);
  assert.ok(groups.every(group => group.result.status === 'insufficient' && group.result.pairedCount === 10));
});

test('lineage identity checks never match another option contract or prediction event by suffix', () => {
  assert.equal(samePaperInstrument('stocks', 'stock:us:AAPL', 'AAPL'), true);
  assert.equal(samePaperInstrument('options', 'option:us:SPY:2027-01-15:500:C', 'option:us:QQQ:2027-01-15:500:C'), false);
  assert.equal(samePaperInstrument('prediction', 'prediction:predictfun:123', 'prediction:kalshi:123'), false);
});

test('drift gate persists per-market strategy pause and requires manual resume', () => {
  const memory = new Map();
  const store = { get: key => memory.get(key) || null, set: (key, value) => memory.set(key, value) };
  const gate = new StrategyDriftGate(store);
  const result = analyzePaperDrift(Array.from({ length: 20 }, (_, index) => sample(index)), new Date('2026-09-25T00:00:00.000Z'));
  gate.update('stocks', 'test-ma', 'v1', result);
  assert.equal(new StrategyDriftGate(store).isPaused('stocks', 'test-ma', 'v1'), true);
  assert.equal(gate.isPaused('crypto', 'test-ma', 'v1'), false);
  const monitor = new SignalMonitor(0, gate);
  assert.equal(monitor.processSignal({ id: 'paused-signal', strategyId: 'test-ma', strategyVersion: 'v1', marketId: 'stocks', timestamp: Date.now(), direction: 'buy' }), 'paused');
  gate.resume('stocks', 'test-ma', 'v1');
  assert.equal(gate.isPaused('stocks', 'test-ma', 'v1'), false);
});

test('only explicit same-market experiment and snapshot links become drift samples', () => {
  const paper = {
    id: 'paper-1', instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side: 'SELL',
    price: 100, quantity: 1, timestamp: '2026-09-23T12:00:00.000Z', strategy: 'test-ma', strategyVersion: 'v1',
    experimentId: 'exp-test', signalId: 'signal-1', dataSnapshotId: 'snapshot-1', backtestTradeIndex: 0,
    feeUsd: 0.2, slippageUsd: 0.25, pnlUsd: 2,
  };
  const experiment = { experiment: { id: 'exp-test', market: 'stocks', instrument: 'AAPL', strategyId: 'test-ma', strategyVersion: 'v1' }, backtest: { trades: [{ direction: 'sell', price: 100, volume: 1, fee: 0.1, slippage: 0.1, pnl: 7 }] } };
  const snapshot = { id: 'snapshot-1', market: 'stocks', instrument: 'AAPL', asOf: '2026-09-23T12:00:00.000Z', source: 'market-feed', createdAt: '2026-09-23T12:00:00.000Z' };
  const resolve = { experiment: () => experiment, snapshot: () => snapshot };
  const paired = collectPaperDriftSamples([paper], resolve);
  assert.equal(paired.length, 1);
  assert.equal(paired[0].paperNetPnlUsd, 1.55);
  assert.equal(paired[0].expectedNetPnlUsd, 7);
  assert.equal(paired[0].dataStatus, 'delayed');
  assert.equal(collectPaperDriftSamples([paper], { ...resolve, snapshot: () => ({ ...snapshot, asOf: '2026-09-23T00:00:00.000Z' }) })[0].dataStatus, 'cached');
  assert.deepEqual(collectPaperDriftSamples([{ ...paper, experimentId: undefined }], resolve), []);
  assert.deepEqual(collectPaperDriftSamples([paper], { ...resolve, snapshot: () => ({ ...snapshot, market: 'crypto' }) }), []);
  assert.deepEqual(collectPaperDriftSamples([paper], { ...resolve, snapshot: () => ({ ...snapshot, asOf: '2026-08-01T00:00:00.000Z' }) }), []);
  assert.deepEqual(collectPaperDriftSamples([paper], { ...resolve, snapshot: () => ({ ...snapshot, createdAt: '2026-09-24T00:00:00.000Z' }) }), []);
  const coverage = summarizePaperDriftCoverage([paper, { ...paper, id: 'legacy', signalId: undefined }], resolve);
  assert.deepEqual(coverage, { closedOrders: 2, explicitlyLinked: 1, freshPairs: 1, stalePairs: 0, rejectedPairs: 1 });
  const staleCoverage = summarizePaperDriftCoverage([paper], { ...resolve, snapshot: () => ({ ...snapshot, asOf: '2026-09-23T00:00:00.000Z' }) });
  assert.equal(staleCoverage.stalePairs, 1);
});

test('paper order and drift API wire lineage, scoped pause and manual resume', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/web/server.ts'), 'utf8');
  assert.match(server, /app\.get\('\/api\/research\/drift'/);
  assert.match(server, /app\.post\('\/api\/research\/drift\/resume'/);
  assert.match(server, /collectPaperDriftSamples\(/);
  assert.match(server, /dataSnapshotId: body\.dataSnapshotId/);
  assert.match(server, /driftGate\.update\(/);
  assert.match(server, /summarizePaperDriftCoverage\(/);
});

test('analysis engine consults the persisted drift gate for strategy signals', () => {
  const engine = fs.readFileSync(path.join(__dirname, '../src/analysis/engine.ts'), 'utf8');
  assert.match(engine, /new SignalMonitor\(60000, new StrategyDriftGate\(stateStore\)\)/);
  assert.match(engine, /strategyVersion: 'v1'/);
  assert.match(engine, /marketId: 'prediction'/);
});

test('paper workspace exposes drift status and manual resume controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
  assert.match(html, /id="paper-drift-status"/);
  assert.match(html, /async function loadPaperDriftStatus\(/);
  assert.match(html, /async function resumePaperDriftGate\(/);
  assert.match(html, /未关联实验\/信号/);
  assert.match(html, /标的身份待确认/);
  assert.match(html, /配对覆盖/);
});
