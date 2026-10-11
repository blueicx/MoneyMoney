const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { aiRunnerPortfolioAttribution, aiRunnerSelectionAttribution } = require('../dist/features/portfolio-attribution');

function selectionAttributionFixture() {
  const runner = {
    id: 'runner-selection', venue: 'Stocks', budgetUsd: 1000,
    universe: { kind: 'watchlist', market: 'stocks', hash: 'frozen-universe-hash', instruments: [
      { venue: 'Stocks', symbolOrMarketId: 'AAPL' },
      { venue: 'Stocks', symbolOrMarketId: 'NVDA' },
    ] },
    positions: [{ id: 'position-aapl', instrumentId: 'stock:us:AAPL', entryOrderId: 'entry', exitOrderId: 'exit', status: 'CLOSED', entryPrice: 100, exitPrice: 110, quantity: 1, entryTime: '2026-10-10T10:05:00.000Z', exitTime: '2026-10-10T11:00:00.000Z', pnlUsd: 10, entryFeeUsd: 1, entrySlippageUsd: 0, exitFeeUsd: 1, exitSlippageUsd: 0 }],
    benchmarks: {
      AAPL: { market: 'stocks', instrument: 'AAPL', startPrice: 100, currentPrice: 110, allocationUsd: 500, observedAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T11:00:00.000Z', source: 'Nasdaq' },
      NVDA: { market: 'stocks', instrument: 'NVDA', startPrice: 200, currentPrice: 220, allocationUsd: 500, observedAt: '2026-10-10T10:00:20.000Z', updatedAt: '2026-10-10T11:00:20.000Z', source: 'Nasdaq' },
    },
  };
  const account = {
    accountId: 'ai-runner:runner-selection', runnerId: runner.id, startingCash: 1000, cash: 1008,
    valuationStatus: 'live', valuationUpdatedAt: '2026-10-10T11:00:20.000Z',
    positions: [],
    orders: [
      { id: 'entry', accountId: 'ai-runner:runner-selection', runnerId: runner.id, instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side: 'BUY', price: 100, quantity: 1, timestamp: '2026-10-10T10:05:00.000Z', feeUsd: 1, slippageUsd: 0 },
      { id: 'exit', accountId: 'ai-runner:runner-selection', runnerId: runner.id, instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side: 'SELL', price: 110, quantity: 1, timestamp: '2026-10-10T11:00:00.000Z', pnlUsd: 10, feeUsd: 1, slippageUsd: 0 },
    ],
  };
  return { runner, account };
}

test('selection/configuration attribution decomposes actual account net PnL against frozen equal-weight holdings', () => {
  const { runner, account } = selectionAttributionFixture();
  const originalHash = runner.universe.hash;
  const result = aiRunnerSelectionAttribution('stocks', runner, account);
  assert.equal(result.status, 'available');
  assert.equal(result.selectionPnlUsd, 100);
  assert.equal(result.netPnlUsd, 8);
  assert.equal(result.configurationPnlUsd, -92);
  assert.equal(result.selectionPnlUsd + result.configurationPnlUsd, result.netPnlUsd);
  assert.equal(result.universeHash, originalHash);
  assert.match(result.method, /等权持有/);
  assert.match(result.method, /非标准 Brinson/);
  assert.match(result.method, /已平仓/);
  assert.deepEqual(result.sources, ['Nasdaq']);
});

test('selection attribution only includes closed positions with exact ledger order lineage and no floating marks', () => {
  const missingLineage = selectionAttributionFixture();
  delete missingLineage.runner.positions[0].entryOrderId;
  assert.equal(aiRunnerSelectionAttribution('stocks', missingLineage.runner, missingLineage.account).status, 'unavailable');

  const mismatchedFill = selectionAttributionFixture();
  mismatchedFill.account.orders.find(order => order.id === 'exit').price = 111;
  assert.equal(aiRunnerSelectionAttribution('stocks', mismatchedFill.runner, mismatchedFill.account).status, 'unavailable');

  const open = selectionAttributionFixture();
  open.runner.positions[0].status = 'OPEN';
  open.runner.positions[0].exitOrderId = undefined;
  open.account.positions = [{ instrumentId: 'stock:us:AAPL', instrumentType: 'stock', title: 'AAPL', quantity: 1, averageEntryPrice: 100, currentPrice: 150, openedAt: '2026-10-10T10:05:00.000Z', realizedPnl: 0, currency: 'USD', markStatus: 'live', markUpdatedAt: '2026-10-10T11:00:20.000Z' }];
  open.account.orders = open.account.orders.filter(order => order.side === 'BUY');
  assert.equal(aiRunnerSelectionAttribution('stocks', open.runner, open.account).status, 'unavailable');
});

test('selection/configuration attribution refuses incomplete or time-misaligned quote baselines', () => {
  const { runner, account } = selectionAttributionFixture();
  delete runner.benchmarks.NVDA;
  const result = aiRunnerSelectionAttribution('stocks', runner, account);
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /覆盖|报价/);

  const misaligned = selectionAttributionFixture();
  misaligned.runner.benchmarks.NVDA.updatedAt = '2026-10-10T11:05:20.000Z';
  assert.equal(aiRunnerSelectionAttribution('stocks', misaligned.runner, misaligned.account).status, 'unavailable');
  misaligned.runner.benchmarks.NVDA.updatedAt = '2026-10-10T11:00:20.000Z';
  misaligned.runner.benchmarks.NVDA.observedAt = '2026-10-10T10:05:20.000Z';
  const skewedBaseline = aiRunnerSelectionAttribution('stocks', misaligned.runner, misaligned.account);
  assert.equal(skewedBaseline.status, 'unavailable');
  assert.match(skewedBaseline.reason, /报价时间不一致/);
});

test('selection benchmark may advance after the last close while the fully realized runner remains in cash', () => {
  const { runner, account } = selectionAttributionFixture();
  runner.benchmarks.AAPL.updatedAt = '2026-10-10T11:10:00.000Z';
  runner.benchmarks.NVDA.updatedAt = '2026-10-10T11:10:20.000Z';
  const refreshed = aiRunnerSelectionAttribution('stocks', runner, account);
  assert.equal(refreshed.status, 'available');
  assert.equal(refreshed.asOf, '2026-10-10T11:10:20.000Z');

  runner.benchmarks.AAPL.updatedAt = '2026-10-10T10:55:00.000Z';
  runner.benchmarks.NVDA.updatedAt = '2026-10-10T10:55:20.000Z';
  const staleEndpoint = aiRunnerSelectionAttribution('stocks', runner, account);
  assert.equal(staleEndpoint.status, 'unavailable');
  assert.match(staleEndpoint.reason, /平仓|基准终点/);
});

test('selection/configuration attribution refuses future benchmark and fill timestamps', () => {
  const { runner, account } = selectionAttributionFixture();
  const future = new Date(Date.now() + 30_000).toISOString();
  for (const row of Object.values(runner.benchmarks)) row.updatedAt = future;
  const result = aiRunnerSelectionAttribution('stocks', runner, account);
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /未来|将来/);

  const futureFill = selectionAttributionFixture();
  const futureClose = new Date(Date.now() + 30_000).toISOString();
  futureFill.runner.positions[0].exitTime = futureClose;
  futureFill.account.orders.find(order => order.id === 'exit').timestamp = futureClose;
  assert.equal(aiRunnerSelectionAttribution('stocks', futureFill.runner, futureFill.account).status, 'unavailable');
});

test('selection/configuration attribution refuses legacy costs and orders before the common baseline', () => {
  const first = selectionAttributionFixture();
  first.account.orders[0].feeUsd = undefined;
  assert.equal(aiRunnerSelectionAttribution('stocks', first.runner, first.account).status, 'unavailable');
  const second = selectionAttributionFixture();
  second.account.orders[0].timestamp = '2026-10-10T09:59:00.000Z';
  assert.equal(aiRunnerSelectionAttribution('stocks', second.runner, second.account).status, 'unavailable');
});

test('selection/configuration attribution is explicitly unsupported outside multi-stock runners', () => {
  const { runner, account } = selectionAttributionFixture();
  assert.equal(aiRunnerSelectionAttribution('crypto', runner, account).status, 'unsupported');
  runner.universe.instruments = [runner.universe.instruments[0]];
  assert.equal(aiRunnerSelectionAttribution('stocks', runner, account).status, 'unsupported');
});

test('runner attribution includes only the exact account and never converts unknown quote PnL', () => {
  const account = {
    accountId: 'ai-runner:runner-a', runnerId: 'runner-a', startingCash: 1000, cash: 890,
    realizedPnl: 10, peakEquity: 1000, maxDrawdownPct: 0,
    positions: [{ instrumentId: 'stock:us:AAPL', instrumentType: 'stock', title: 'AAPL', quantity: 1, averageEntryPrice: 100, currentPrice: 110, openedAt: '2026-10-10T10:00:00.000Z', realizedPnl: 0 }],
    orders: [
      { id: 'entry-a', accountId: 'ai-runner:runner-a', runnerId: 'runner-a', instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side: 'BUY', price: 100, quantity: 1, timestamp: '2026-10-10T10:00:00.000Z', strategy: 'ai-runner', strategyVersion: 'v2', feeUsd: 1, slippageUsd: 0.5 },
      { id: 'exit-a', accountId: 'ai-runner:runner-a', runnerId: 'runner-a', instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side: 'SELL', price: 110, quantity: 1, timestamp: '2026-10-10T10:05:00.000Z', strategy: 'ai-runner', strategyVersion: 'v2', pnlUsd: 10, feeUsd: 1, slippageUsd: 0.5, signalId: 'signal-a', dataSnapshotId: 'snapshot-a' },
      { id: 'foreign-order', accountId: 'ai-runner:runner-b', runnerId: 'runner-b', instrumentId: 'stock:us:NVDA', instrumentType: 'stock', side: 'SELL', price: 100, quantity: 1, timestamp: '2026-10-10T10:06:00.000Z', strategy: 'other', pnlUsd: 99, feeUsd: 0, slippageUsd: 0 },
      { id: 'unlinked-order', instrumentId: 'stock:us:TSLA', instrumentType: 'stock', side: 'SELL', price: 100, quantity: 1, timestamp: '2026-10-10T10:07:00.000Z', strategy: 'unknown', pnlUsd: 500, feeUsd: 0, slippageUsd: 0 },
    ],
  };
  const result = aiRunnerPortfolioAttribution('stocks', 'runner-a', account);
  assert.equal(result.market, 'stocks');
  assert.equal(result.executionEnabled, false);
  assert.equal(result.totalConvertedValue, null);
  assert.equal(result.byCurrency.UNKNOWN.marketValue, null);
  assert.equal(result.strategies.length, 1);
  assert.equal(result.strategies[0].runnerId, 'runner-a');
  assert.equal(result.strategies[0].orders, 2);
  assert.equal(result.strategies[0].realizedQuotePnl, 10);
  assert.equal(result.strategies[0].recordedFeesUsd, 2);
  assert.equal(result.strategies[0].recordedSlippageUsd, 1);
  assert.equal(result.strategies[0].lineage.find(row => row.orderId === 'exit-a').signalId, 'signal-a');
  assert.ok(result.warnings.some(reason => /未显式关联到该跑单账户/.test(reason)));
});

test('runner attribution refuses mismatched account ownership and market', () => {
  const account = { accountId: 'ai-runner:runner-a', runnerId: 'runner-a', positions: [], orders: [] };
  assert.throws(() => aiRunnerPortfolioAttribution('stocks', 'runner-b', account), /账户归属/);
  assert.throws(() => aiRunnerPortfolioAttribution('crypto', 'runner-a', {
    ...account,
    orders: [{ accountId: 'ai-runner:runner-a', runnerId: 'runner-a', instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side: 'BUY', price: 10, quantity: 1, timestamp: '2026-10-10T00:00:00.000Z' }],
  }), /市场/);
});

test('runner attribution leaves realized PnL unknown until there is an explicit closing trade', () => {
  const result = aiRunnerPortfolioAttribution('stocks', 'runner-open-only', {
    accountId: 'ai-runner:runner-open-only', runnerId: 'runner-open-only', positions: [],
    orders: [{ accountId: 'ai-runner:runner-open-only', runnerId: 'runner-open-only', instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side: 'BUY', price: 100, quantity: 1, timestamp: '2026-10-10T00:00:00.000Z' }],
  });
  assert.equal(result.strategies.length, 1);
  assert.equal(result.strategies[0].realizedQuotePnl, null, 'no closed order is not a verified zero realized return');
});

test('private runner history API and existing history panel expose scoped attribution', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/web/server.ts'), 'utf8');
  const html = require('./helpers/dashboard-source.cjs').readDashboardSource();
  assert.match(server, /app\.get\('\/api\/ai-runners\/:id\/history', \(req, res\) => \{\s*if \(!adminOnly\(req, res\)\) return;/);
  assert.match(server, /const attribution = aiRunnerPortfolioAttribution\(market, runner\.id, account\)/);
  assert.match(server, /const selectionAttribution = aiRunnerSelectionAttribution\(market, runner, account\)/);
  assert.match(html, /跑单成交归因 · 原始报价口径/);
  assert.match(html, /不折算未知汇率/);
  assert.match(html, /冻结自选归因/);
  assert.match(html, /data-runner-attribution-chart/);
});
