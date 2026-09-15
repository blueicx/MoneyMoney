const test = require('node:test');
const { strict: assert } = require('node:assert');
const { filterRows, serializeTemplate, sortRows, paginateRows, actionsForScreener, validateScreenerAction, ResearchLedger } = require('../dist/features/market-screener.js');

test('prediction screener rejects stock-only fields', () => {
  assert.throws(() => filterRows('prediction', [], { marketCap: { gte: 100 } }), /不属于/);
});

test('stock screener rejects prediction-only fields', () => {
  assert.throws(() => filterRows('stocks', [], { yesPrice: { lte: 50 } }), /不属于/);
});

test('screener templates keep scope and conditions without quote data', () => {
  const template = serializeTemplate({ name: 'Test', scope: 'stocks', filters: { changePct: { gte: 5 } } });
  assert.equal(template.name, 'Test');
  assert.equal(template.scope, 'stocks');
  assert.deepEqual(template.filters, { changePct: { gte: 5 } });
  assert.ok(!('quote' in template));
  assert.ok(!('rows' in template));
});

test('screener sorts stably and paginates', () => {
  const rows = [{ id: '1', changePct: 5 }, { id: '2', changePct: 10 }, { id: '3', changePct: 2 }];
  const sorted = sortRows('stocks', rows, { field: 'changePct', direction: 'desc' });
  assert.equal(sorted[0].id, '2');
  const paginated = paginateRows(sorted, 2, 1);
  assert.equal(paginated.rows.length, 2);
  assert.equal(paginated.page, 1);
  assert.equal(paginated.totalPages, 2);
});

test('screener exposes only actions supported by the selected market', () => {
  assert.deepEqual(actionsForScreener('stocks').map(action => action.id), ['detail', 'compare', 'watchlist', 'candidate', 'alert', 'backtest']);
  assert.deepEqual(actionsForScreener('options').map(action => action.id), ['detail', 'compare', 'watchlist', 'candidate', 'alert']);
  assert.equal(validateScreenerAction('crypto', 'backtest'), true);
  assert.throws(() => validateScreenerAction('prediction', 'backtest'), /不支持/);
});

test('Research ledger supports candidate promotion with scope and threshold', () => {
    const ledger = new ResearchLedger(90);

    // Test failing threshold
    assert.throws(() => ledger.promote('crypto', 'BTC', 70, ['trend']), /Score below promotion threshold/);

    // Test passing threshold
    const candidate = ledger.promote('crypto', 'ETH', 95, ['trend', 'volume']);
    assert.deepEqual(candidate.gate, { minScore: 90, passed: true });
    ledger.updateStatus('crypto', 'ETH', 'approved');

    const candidates = ledger.getCandidates('crypto');
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].marketId, 'ETH');
    assert.equal(candidates[0].status, 'approved');
    assert.equal(candidates[0].scope, 'crypto');
    assert.equal(ledger.get('stocks', 'ETH'), undefined);
    assert.equal(ledger.updateStatus('stocks', 'ETH', 'rejected'), false);
});
