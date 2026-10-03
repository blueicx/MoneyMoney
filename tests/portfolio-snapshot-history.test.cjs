const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  capturePortfolioSnapshots,
  comparePortfolioSnapshots,
  appendPortfolioSnapshots,
} = require('../dist/features/portfolio-snapshot-history');

const rows = [
  { market: 'stocks', instrument: 'stock:us:AAPL', quantity: 2, price: 100, currency: 'USD', accountSource: 'manual', accountId: 'acct-1' },
  { market: 'stocks', instrument: 'stock:us:MU', quantity: 1, price: 50, currency: 'USD', accountSource: 'manual', accountId: 'acct-1' },
  { market: 'stocks', instrument: 'stock:us:7203', quantity: 1, price: 2000, currency: 'JPY', accountSource: 'manual', accountId: 'acct-1' },
  { market: 'crypto', instrument: 'crypto:binance:BTCUSDT', quantity: 1, price: 60000, currency: 'USDT', accountSource: 'csv', accountId: 'acct-2' },
];

test('snapshots preserve market, account, currency, source, and deterministic content hash', () => {
  const first = capturePortfolioSnapshots(rows, '2026-10-03T10:00:00.000Z');
  const second = capturePortfolioSnapshots(rows, '2026-10-03T11:00:00.000Z');
  assert.equal(first.length, 2);
  const stock = first.find(item => item.market === 'stocks');
  assert.deepEqual(stock.currencyValues, { JPY: 2000, USD: 250 });
  assert.equal(stock.accountId, 'acct-1');
  assert.equal(stock.accountSource, 'manual');
  assert.equal(stock.contentHash, second.find(item => item.market === 'stocks').contentHash);
});

test('snapshot comparison reports currency valuation delta, never investment return', () => {
  const [before] = capturePortfolioSnapshots([rows[0]], '2026-10-01T00:00:00.000Z');
  const [after] = capturePortfolioSnapshots([{ ...rows[0], price: 110 }], '2026-10-03T00:00:00.000Z');
  const result = comparePortfolioSnapshots(before, after);
  assert.equal(result.dataStatus, 'historical');
  assert.equal(result.metric, 'valuation_change');
  assert.equal(result.currencies.USD.delta, 20);
  assert.equal(result.currencies.USD.deltaPct, 10);
  assert.equal(result.investmentReturnPct, null);
  assert.match(result.reason, /不等于投资收益/);
});

test('changed holdings and cash flows are surfaced as reasons not hidden in return math', () => {
  const [before] = capturePortfolioSnapshots([rows[0]], '2026-10-01T00:00:00.000Z');
  const [after] = capturePortfolioSnapshots([{ ...rows[0], quantity: 3, cashFlows: [{ at: '2026-10-02T00:00:00.000Z', amount: 100, currency: 'USD' }] }], '2026-10-03T00:00:00.000Z');
  const result = comparePortfolioSnapshots(before, after);
  assert.equal(result.holdingsChanged, true);
  assert.equal(result.cashFlowsBetweenSnapshots, 1);
  assert.equal(result.investmentReturnPct, null);
  assert.match(result.reason, /现金流|仓位/);
});

test('unlinked or unrelated accounts cannot be compared', () => {
  const [unlinked] = capturePortfolioSnapshots([{ ...rows[0], accountId: undefined }], '2026-10-01T00:00:00.000Z');
  const [alsoUnlinked] = capturePortfolioSnapshots([{ ...rows[0], accountId: undefined, price: 101 }], '2026-10-03T00:00:00.000Z');
  assert.equal(comparePortfolioSnapshots(unlinked, alsoUnlinked).dataStatus, 'unavailable');
  const [otherAccount] = capturePortfolioSnapshots([{ ...rows[0], accountId: 'acct-other' }], '2026-10-03T00:00:00.000Z');
  assert.throws(() => comparePortfolioSnapshots(capturePortfolioSnapshots([rows[0]], '2026-10-01T00:00:00.000Z')[0], otherAccount), /同一|account|账户/);
});

test('snapshot history append is bounded and retains newest records', () => {
  const result = appendPortfolioSnapshots([{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }], 3);
  assert.deepEqual(result.map(item => item.id), ['b', 'c', 'd']);
});

test('portfolio snapshot routes are private and only committed imports persist snapshots', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'server.ts'), 'utf8');
  for (const route of ["app.get('/api/portfolio/snapshots'", "app.get('/api/portfolio/snapshots/compare'"]) {
    const start = source.indexOf(route);
    assert.notEqual(start, -1);
    const body = source.slice(start, source.indexOf('\n});', start) + 4);
    assert.match(body, /adminOnly\(req, res\)/);
  }
  const start = source.indexOf("app.post('/api/portfolio/import'");
  const route = source.slice(start, source.indexOf('\n});', start) + 4);
  assert.match(route, /req\.body\?\.commit === true[\s\S]*capturePortfolioSnapshots/);
});
