const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { aiRunnerPortfolioAttribution } = require('../dist/features/portfolio-attribution');

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
  const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
  assert.match(server, /app\.get\('\/api\/ai-runners\/:id\/history', \(req, res\) => \{\s*if \(!adminOnly\(req, res\)\) return;/);
  assert.match(server, /attribution = aiRunnerPortfolioAttribution\(runner\.universe\?\.market/);
  assert.match(html, /跑单成交归因 · 原始报价口径/);
  assert.match(html, /不折算未知汇率/);
});
