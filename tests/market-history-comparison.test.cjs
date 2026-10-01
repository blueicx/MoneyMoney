const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareOptionSnapshots, summarizeMarketHistory } = require('../dist/features/market-history-comparison');
const snap = (id, rows, extra = {}) => ({ id, market: 'options', instrument: 'option:cboe:AAPL', source: 'CBOE Delayed Quotes', fetchedAt: `2026-01-0${id}T00:00:00Z`, snapshot: { expiries: [{ expiryMs: 1800000000000, rows }] }, ...extra });
test('options compare exact contract identity and do not invent missing IV', () => {
  const a = { instrumentName: 'AAPL-C-100', strike: 100, optionType: 'call', bidPrice: 2, openInterest: 10 };
  const result = compareOptionSnapshots([snap('1', [a]), snap('2', [{ ...a, bidPrice: 3, openInterest: 15 }, { ...a, instrumentName: 'AAPL-C-110', strike: 110 }])]);
  assert.equal(result.changes[0].contracts.length, 1);
  assert.equal(result.changes[0].contracts[0].fields.bidPrice.delta, 1);
  assert.equal(result.changes[0].contracts[0].fields.impliedVolPct.delta, null);
  assert.equal(result.changes[0].contracts[0].fields.impliedVolPct.reason, '字段缺失');
  assert.throws(() => compareOptionSnapshots([snap('1', [a]), snap('2', [a], { source: 'Deribit Public API' })]), /同一标的和来源/);
});
test('history comparison is scoped to venue and source; settlement requires official evidence', () => {
  const entries = [
    { id: 'a', market: 'prediction', instrument: 'prediction:kalshi:abc', source: { id: 'kalshi', name: 'Kalshi' }, observedAt: '2026-01-01T00:00:00Z', fields: { probability: .4, settlementStatus: 'settled' } },
    { id: 'b', market: 'prediction', instrument: 'prediction:kalshi:abc', source: { id: 'kalshi', name: 'Kalshi' }, observedAt: '2026-01-02T00:00:00Z', fields: { probability: .6, settlementStatus: 'settled', settlementEvidenceUrl: 'https://kalshi.com/markets/abc', settlementEvidenceOfficial: true } },
    { id: 'c', market: 'crypto', instrument: 'crypto:binance:BTCUSDT', source: { id: 'binance', name: 'Binance' }, observedAt: '2026-01-02T00:00:00Z', fields: { probability: .1 } },
  ];
  const result = summarizeMarketHistory(entries, 'prediction', 'prediction:kalshi:abc');
  assert.equal(result.series.length, 2);
  assert.equal(result.series[0].fields.settlementStatus, 'unknown');
  assert.equal(result.series[1].fields.settlementStatus, 'settled');
  assert.equal(result.changes[0].deltas.probability, .2);
});
