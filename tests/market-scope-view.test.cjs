const assert = require('node:assert/strict');
const test = require('node:test');

const {
  filterAssistantReport,
  filterByMarketScope,
  filterUnifiedPaperLedger,
  scopeAllowsSection,
  scopeQuery,
  scopeForInstrument,
} = require('../dist/features/market-scope-view');

test('market sections are visible only in their declared scope', () => {
  assert.equal(scopeAllowsSection('crypto', 'stocks'), false);
  assert.equal(scopeAllowsSection('crypto', 'crypto'), true);
  assert.equal(scopeAllowsSection('stocks', 'overview'), true);
  assert.equal(scopeAllowsSection('common', 'prediction'), true);
});

test('scope query is stable and preserves legacy no-scope calls', () => {
  assert.equal(scopeQuery('stocks'), 'scope=stocks');
  assert.equal(scopeQuery('overview'), 'scope=overview');
  assert.equal(scopeQuery('invalid'), '');
  assert.equal(scopeQuery(undefined), '');
});

test('instrument references resolve to their market scope', () => {
  assert.equal(scopeForInstrument({ type: 'stock', id: 'stock:us:AAPL' }), 'stocks');
  assert.equal(scopeForInstrument({ type: 'crypto', id: 'crypto:binance:BTCUSDT' }), 'crypto');
  assert.equal(scopeForInstrument({ type: 'prediction', id: 'prediction:predictfun:42' }), 'prediction');
});

test('assistant report keeps only the selected market actions', () => {
  const report = {
    stockActions: [{ id: 's' }],
    cryptoActions: [{ id: 'c' }],
    predictionPicks: [{ id: 'p' }],
    optionActions: [{ id: 'o' }],
    sectorActions: [{ id: 'sector' }],
    macroActions: [{ id: 'macro' }],
    reminders: [{ id: 's', venue: 'Stocks' }, { id: 'c', venue: 'Binance' }],
  };
  assert.deepEqual(filterAssistantReport(report, 'stocks'), {
    ...report,
    stockActions: [{ id: 's' }],
    cryptoActions: [],
    predictionPicks: [],
    optionActions: [],
    sectorActions: [{ id: 'sector' }],
    macroActions: [{ id: 'macro' }],
    reminders: [{ id: 's', venue: 'Stocks' }],
  });
  assert.deepEqual(filterAssistantReport(report, 'crypto').cryptoActions, [{ id: 'c' }]);
  assert.deepEqual(filterAssistantReport(report, 'overview'), report);
});

test('generic records filter by explicit instrument type or market scope', () => {
  const rows = [
    { id: 'stock:us:AAPL', instrumentType: 'stock' },
    { id: 'crypto:binance:BTCUSDT', instrumentType: 'crypto' },
    { id: 'prediction:predictfun:42', instrumentType: 'prediction' },
  ];
  assert.equal(filterByMarketScope(rows, 'stocks').length, 1);
  assert.equal(filterByMarketScope(rows, 'crypto')[0].instrumentType, 'crypto');
  assert.equal(filterByMarketScope(rows, 'overview').length, 3);
});

test('unified paper ledger is isolated to the selected market', () => {
  const ledger = {
    startingCash: 1000,
    cash: 650,
    positions: [
      { instrumentId: 'stock:us:AAPL', instrumentType: 'stock' },
      { instrumentId: 'crypto:binance:BTCUSDT', instrumentType: 'crypto' },
    ],
    orders: [
      { instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side: 'BUY', price: 100, quantity: 2 },
      { instrumentId: 'crypto:binance:BTCUSDT', instrumentType: 'crypto', side: 'BUY', price: 200, quantity: 1 },
      { instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side: 'SELL', price: 110, quantity: 1, pnlUsd: 10 },
    ],
    realizedPnl: 10,
    peakEquity: 1000,
    maxDrawdownPct: 2,
  };
  const stocks = filterUnifiedPaperLedger(ledger, 'stocks');
  assert.deepEqual(stocks.positions.map(item => item.instrumentId), ['stock:us:AAPL']);
  assert.equal(stocks.orders.length, 2);
  assert.equal(stocks.cash, 910);
  assert.equal(stocks.realizedPnl, 10);
  assert.equal(filterUnifiedPaperLedger(ledger, 'overview'), ledger);
});

console.log('Market scoped view tests loaded');
