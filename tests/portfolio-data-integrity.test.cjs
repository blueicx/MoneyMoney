const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzePortfolio, importPortfolioRows } = require('../dist/features/decision-intelligence');
const row = (id, currency, datedReturns) => ({ instrument: `stock:us:${id}`, market: 'stocks', quantity: 1, price: 100, currency, datedReturns });
test('missing benchmark is unavailable, not an invented zero return', () => {
  const result = analyzePortfolio([row('AAPL', 'USD')]);
  assert.equal(result.benchmarkReturnPct, null);
  assert.equal(result.excessReturnPct, null);
  assert.ok(result.returnReason);
});
test('different currencies are not added without conversion', () => {
  const result = analyzePortfolio([row('AAPL', 'USD'), row('MU', 'HKD')]);
  assert.equal(result.totalValue, null);
  assert.deepEqual(result.byCurrency, { USD: 100, HKD: 100 });
  assert.ok(result.currencyReason);
  assert.deepEqual(result.byMarket, {});
  assert.deepEqual(result.bySector, {});
  assert.deepEqual(result.byFactor, {});
});

test('stablecoin units are preserved without assuming USD conversion', () => {
  const result = importPortfolioRows([{ instrument:'crypto:binance:BTCUSDT', market:'crypto', quantity:1, price:100, currency:'USDT' }]);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.accepted[0].currency, 'USDT');
});
test('date-aligned returns exclude missing dates and produce covariance contributions', () => {
  const result = analyzePortfolio([
    row('AAPL', 'USD', [{ date: '2026-01-01', value: .01 }, { date: '2026-01-02', value: .02 }, { date: '2026-01-03', value: .03 }]),
    row('MU', 'USD', [{ date: '2026-01-02', value: .04 }, { date: '2026-01-03', value: .06 }, { date: '2026-01-04', value: -10 }]),
  ]);
  assert.equal(result.correlations[0].correlation, 1);
  assert.equal(result.correlations[0].samples, 2);
  assert.equal(result.riskContributions.length, 2);
  assert.ok(Math.abs(result.riskContributions.reduce((sum, row) => sum + row.contributionPct, 0) - 100) < .001);
});
test('import retains account/cost provenance and rejects duplicate return dates', () => {
  const result = importPortfolioRows([{ ...row('AAPL', 'USD'), accountSource: 'manual', accountId: 'a', averageCost: 90, datedReturns: [{ date: '2026-01-01', value: .01 }] }]);
  assert.equal(result.accepted[0].averageCost, 90);
  assert.equal(result.accepted[0].accountId, 'a');
  assert.equal(importPortfolioRows([{ ...row('AAPL', 'USD'), datedReturns: [{ date: '2026-01-01', value: .01 }, { date: '2026-01-01', value: .02 }] }]).rejected.length, 1);
});
