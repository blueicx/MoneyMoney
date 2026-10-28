const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { buildEvidenceGapMap, renderEvidenceGapCsv } = require('../src/features/evidence-gap-map');

const now = Date.parse('2026-10-28T00:00:00Z');
const rows = [
  { id: 'a', market: 'stocks', instrument: 'stock:us:AAPL', source: 'lake', kind: 'partition', coverage: 'partial', reason: '3 unreadable partitions', observedAt: '2026-10-27T00:00:00Z' },
  { id: 'b', market: 'crypto', instrument: 'crypto:binance:BTCUSDT', source: 'binance', kind: 'history', coverage: 'unknown', reason: 'no gap evidence yet', observedAt: null },
  { id: 'c', market: 'options', instrument: 'option:fixture', source: 'cboe', kind: 'chain', coverage: 'unavailable', reason: 'snapshot unreadable', observedAt: '2026-10-26T00:00:00Z', detail: 'quote, "adjusted"' },
];

test('gap map aggregates non-complete evidence and keeps unknown reasons', () => {
  const map = buildEvidenceGapMap(rows, now);
  assert.equal(map.total, 3);
  assert.equal(map.byCoverage.partial, 1);
  assert.equal(map.byCoverage.unknown, 1);
  assert.equal(map.byCoverage.unavailable, 1);
  assert.equal(map.byCoverage.complete, 0);
  assert.equal(map.dataStatus, 'partial');
  assert.equal(map.rows[0].id, 'a', 'rows are newest-first');
  assert.match(map.contentHash, /^[a-f0-9]{64}$/);
});

test('gap map rejects complete rows and future timestamps without dropping valid rows', () => {
  const map = buildEvidenceGapMap([
    ...rows,
    { id: 'd', market: 'stocks', instrument: 'stock:us:MSFT', source: 'lake', kind: 'quote', coverage: 'complete', reason: 'ok' },
    { id: 'e', market: 'stocks', instrument: 'stock:us:TSLA', source: 'lake', kind: 'quote', coverage: 'unknown', reason: 'x', observedAt: '2026-10-29T00:00:00Z' },
  ], now);
  assert.equal(map.total, 3);
  assert.equal(map.rejected.length, 2);
});

test('gap map csv escapes commas and quotes', () => {
  const csv = renderEvidenceGapCsv(buildEvidenceGapMap(rows, now));
  assert.match(csv, /"quote, ""adjusted"""/);
  assert.equal(csv.split('\n').length, 4);
});

test('empty input is empty, invalid input is unavailable', () => {
  assert.equal(buildEvidenceGapMap([], now).dataStatus, 'empty');
  assert.equal(buildEvidenceGapMap([{ bogus: true }], now).dataStatus, 'unavailable');
});
