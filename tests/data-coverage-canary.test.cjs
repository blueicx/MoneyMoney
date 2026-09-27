const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DataCoverageCanary,
  validateCanaryTarget,
  toPublicCoverageCanarySummary,
  shouldRunOncePerShanghaiDay,
  summarizeCoverageCanaryHistory,
} = require('../dist/features/data-coverage-canary');

function createStore() {
  const data = new Map();
  let leaseOwner = null;
  return {
    get: key => data.get(key) ?? null,
    set: (key, value) => data.set(key, value),
    acquireLease: (_key, owner) => {
      if (leaseOwner && leaseOwner !== owner) return false;
      leaseOwner = owner;
      return true;
    },
    releaseLease: (_key, owner) => {
      if (leaseOwner !== owner) return false;
      leaseOwner = null;
      return true;
    },
  };
}

test('coverage canary rejects cross-market and non-canonical instrument identities', () => {
  assert.throws(() => validateCanaryTarget({ market: 'crypto', instrument: 'stock:us:AAPL', label: 'crossed' }), /market|市场/);
  assert.throws(() => validateCanaryTarget({ market: 'stocks', instrument: 'AAPL', label: 'bare' }), /instrument|标的/);
  assert.equal(validateCanaryTarget({ market: 'crypto', instrument: 'crypto:binance:BTCUSDT', label: 'BTC' }).instrument, 'crypto:binance:BTCUSDT');
});

test('coverage canary persists per-market results and preserves empty, unsupported, and failed distinctions', async () => {
  const store = createStore();
  const runner = new DataCoverageCanary(store, async target => {
    if (target.market === 'options') throw new Error('CBOE timeout');
    if (target.market === 'prediction') return { capabilities: { settlementEvidence: { status: 'unsupported', source: 'official resolution source', reason: '该事件没有最终结算证据' } } };
    return { capabilities: {
      quote: { status: 'live', source: 'test-provider', updatedAt: '2026-09-27T01:00:00.000Z', count: 1 },
      news: { status: 'empty', source: 'test-news', updatedAt: '2026-09-27T01:00:00.000Z', count: 0, reason: '来源已响应，但没有标的新闻' },
    } };
  }, { owner: 'canary-test' });
  const targets = [
    { market: 'stocks', instrument: 'stock:us:SNDK', label: 'SNDK' },
    { market: 'options', instrument: 'option:cboe:SPY', label: 'SPY options' },
    { market: 'crypto', instrument: 'crypto:binance:BTCUSDT', label: 'BTC' },
    { market: 'prediction', instrument: 'prediction:polymarket:active-1', label: 'Active event' },
  ];
  const run = await runner.run(targets, new Date('2026-09-27T01:00:00.000Z'));
  assert.equal(run.results.length, 4);
  assert.equal(run.results.find(row => row.market === 'stocks').capabilities.news.status, 'empty');
  assert.equal(run.results.find(row => row.market === 'options').status, 'failed');
  assert.equal(run.results.find(row => row.market === 'prediction').capabilities.settlementEvidence.status, 'unsupported');
  assert.equal(runner.listRuns().length, 1);
  const publicSummary = toPublicCoverageCanarySummary(run);
  assert.equal(publicSummary.total, 4);
  assert.equal(JSON.stringify(publicSummary).includes('SNDK'), false);
  assert.equal(JSON.stringify(publicSummary).includes('BTCUSDT'), false);
});

test('coverage canary serializes overlapping runs with a persistent lease', async () => {
  const store = createStore();
  store.acquireLease('data-coverage-canary', 'other-worker');
  const runner = new DataCoverageCanary(store, async () => ({ capabilities: {} }), { owner: 'this-worker' });
  await assert.rejects(runner.run([{ market: 'stocks', instrument: 'stock:us:AAPL', label: 'AAPL' }]), /already running|正在运行/);
});

test('one canary instance rejects overlapping same-owner runs while a provider check is pending', async () => {
  const finishChecks = [];
  let startedCheck;
  const started = new Promise(resolve => { startedCheck = resolve; });
  const store = createStore();
  const runner = new DataCoverageCanary(store, async () => {
    startedCheck();
    await new Promise(resolve => { finishChecks.push(resolve); });
    return { capabilities: { quote: { status: 'live', source: 'provider', count: 1 } } };
  }, { owner: 'same-process-worker' });
  const targets = [{ market: 'stocks', instrument: 'stock:us:AAPL', label: 'AAPL' }];
  const first = runner.run(targets);
  await started;
  const secondResult = runner.run(targets).then(() => null, error => error);
  await new Promise(resolve => setImmediate(resolve));
  for (const finish of finishChecks) finish();
  await first;
  const error = await secondResult;
  assert.ok(error instanceof Error && /already running|正在运行/.test(error.message), 'overlapping same-owner run must be rejected');
});

test('public coverage summary aggregates every market target without exposing instrument ids', () => {
  const run = {
    id: 'run-1', status: 'partial', startedAt: '2026-09-27T01:00:00.000Z', completedAt: '2026-09-27T01:01:00.000Z', durationMs: 60_000,
    results: [
      { market: 'stocks', instrument: 'stock:us:AAPL', label: 'AAPL', status: 'live' },
      { market: 'stocks', instrument: 'stock:us:SNDK', label: 'SNDK', status: 'failed' },
      { market: 'crypto', instrument: 'crypto:binance:BTCUSDT', label: 'BTC', status: 'cached' },
    ],
    summary: {
      total: 3, byMarket: { stocks: 2, options: 0, crypto: 1, prediction: 0 },
      byStatus: { live: 1, delayed: 0, cached: 1, partial: 0, empty: 0, unavailable: 0, unsupported: 0, failed: 1 },
    },
  };
  const result = toPublicCoverageCanarySummary(run);
  assert.equal(result.marketStatus.stocks.checked, 2);
  assert.equal(result.marketStatus.stocks.status, 'partial');
  assert.equal(result.marketStatus.crypto.status, 'cached');
  assert.equal(JSON.stringify(result).includes('AAPL'), false);
  assert.equal(JSON.stringify(result).includes('BTCUSDT'), false);
});

test('market-level source failures contribute to the run status even when no dynamic event target exists', async () => {
  const runner = new DataCoverageCanary(createStore(), async () => ({ capabilities: {
    quote: { status: 'live', source: 'stock provider', count: 1 },
  } }), { owner: 'market-reason-status-test' });
  const run = await runner.run([{ market: 'stocks', instrument: 'stock:us:AAPL', label: 'AAPL' }], new Date(), {
    marketReasons: { prediction: { status: 'partial', reason: 'one venue unavailable' } },
  });
  assert.equal(run.status, 'partial');
  const publicSummary = toPublicCoverageCanarySummary(run);
  assert.equal(publicSummary.marketStatus.prediction.status, 'partial');
  assert.match(publicSummary.marketStatus.prediction.reason, /部分|来源/);
});

test('coverage history reports source window coverage and never treats missing required data as success', async () => {
  const store = createStore();
  const runner = new DataCoverageCanary(store, async () => ({ capabilities: {
    quote: { status: 'live', source: 'provider', updatedAt: '2026-09-26T12:00:00.000Z', count: 1 },
  } }), { owner: 'coverage-window-test' });
  const run = await runner.run([{
    market: 'stocks', instrument: 'stock:us:AAPL', label: 'AAPL', requiredCapabilities: ['quote', 'bars'],
  }], new Date('2026-09-27T01:00:00.000Z'));
  assert.equal(run.results[0].status, 'partial');
  const history = summarizeCoverageCanaryHistory([run], 7, new Date(Date.parse(run.completedAt) + 1_000));
  assert.equal(history[0].checks, 1);
  assert.equal(history[0].capabilities.quote.count, 1);
  assert.equal(history[0].capabilities.quote.lastStatus, 'live');
  assert.equal(history[0].capabilities.bars.lastStatus, 'unavailable');
  assert.match(history[0].capabilities.bars.reason, /required|必需|未返回/);
});

test('daily canary schedule runs once after 09:00 Shanghai time', () => {
  assert.equal(shouldRunOncePerShanghaiDay(null, new Date('2026-09-27T00:59:00.000Z')), false);
  assert.equal(shouldRunOncePerShanghaiDay(null, new Date('2026-09-27T01:00:00.000Z')), true);
  assert.equal(shouldRunOncePerShanghaiDay('2026-09-27T01:15:00.000Z', new Date('2026-09-27T02:00:00.000Z')), false);
  assert.equal(shouldRunOncePerShanghaiDay('2026-09-26T01:15:00.000Z', new Date('2026-09-27T02:00:00.000Z')), true);
});

test('manual canary reruns do not consume the scheduled daily run', async () => {
  const store = createStore();
  const runner = new DataCoverageCanary(store, async () => ({ capabilities: {
    quote: { status: 'live', source: 'provider', count: 1 },
  } }), { owner: 'manual-does-not-consume-daily' });
  const targets = [{ market: 'stocks', instrument: 'stock:us:AAPL', label: 'AAPL' }];
  await runner.runResolved(async () => ({ targets }), new Date('2026-09-27T01:30:00.000Z'));
  assert.equal(store.get('data-coverage-canary:last-daily-run-at'), null);
  const scheduled = await runner.runIfDue(new Date('2026-09-27T02:00:00.000Z'));
  assert.ok(scheduled);
  assert.equal(store.get('data-coverage-canary:last-daily-run-at'), scheduled.completedAt);
});
