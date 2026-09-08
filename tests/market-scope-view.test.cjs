const assert = require('node:assert/strict');
const test = require('node:test');

const {
  filterAssistantReport,
  filterByMarketScope,
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

console.log('Market scoped view tests loaded');
