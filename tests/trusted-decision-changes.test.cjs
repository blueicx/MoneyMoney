const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  createEvidenceSnapshot,
  getEvidenceChanges,
} = require('../dist/features/decision-intelligence.js');

function snapshot(input) {
  return createEvidenceSnapshot({
    market: 'stocks',
    instrument: 'AAPL',
    workspace: 'evidence',
    dataStatus: 'live',
    source: { id: 'nasdaq-public', name: 'Nasdaq' },
    observedAt: input.fetchedAt,
    fetchedAt: input.fetchedAt,
    fields: input.fields,
    id: input.id,
  });
}

test('evidence changes compares the latest post-since snapshot with its previous snapshot', () => {
  const previous = snapshot({ id: 'ev_previous', fetchedAt: '2026-09-19T01:00:00Z', fields: { price: 200, volume: 100 } });
  const latest = snapshot({ id: 'ev_latest', fetchedAt: '2026-09-19T02:00:00Z', fields: { price: 205, close: 205 } });

  const result = getEvidenceChanges([previous, latest], 'stocks', 'AAPL', '2026-09-19T01:30:00Z');

  assert.equal(result.dataStatus, 'cached');
  assert.deepEqual(result.changed, ['price']);
  assert.deepEqual(result.added, ['close']);
  assert.deepEqual(result.removed, ['volume']);
  assert.deepEqual(result.fieldChanges, [
    { field: 'price', before: 200, after: 205, status: 'changed' },
    { field: 'volume', before: 100, status: 'removed' },
    { field: 'close', after: 205, status: 'added' },
  ]);
  assert.deepEqual(result.evidenceRefs, ['ev_previous', 'ev_latest']);
  assert.equal(result.reason, null);
});

test('evidence changes reports an explicit empty reason when no snapshot is after since', () => {
  const result = getEvidenceChanges([
    snapshot({ id: 'ev_old', fetchedAt: '2026-09-19T01:00:00Z', fields: { price: 200 } }),
  ], 'stocks', 'AAPL', '2026-09-19T02:00:00Z');

  assert.equal(result.dataStatus, 'empty');
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.evidenceRefs, []);
  assert.match(result.reason, /since|变化|快照/i);
});

test('evidence changes rejects invalid since and never mixes market or instrument snapshots', () => {
  const crypto = createEvidenceSnapshot({
    market: 'crypto', instrument: 'BTCUSDT', workspace: 'evidence', dataStatus: 'live',
    source: { id: 'binance-public', name: 'Binance' }, observedAt: '2026-09-19T01:00:00Z',
    fetchedAt: '2026-09-19T01:00:00Z', fields: { price: 60000 }, id: 'ev_crypto',
  });
  const stock = snapshot({ id: 'ev_stock', fetchedAt: '2026-09-19T02:00:00Z', fields: { price: 205 } });

  const result = getEvidenceChanges([crypto, stock], 'stocks', 'AAPL', 'not-a-date');
  assert.equal(result.dataStatus, 'unavailable');
  assert.deepEqual(result.evidenceRefs, []);
  assert.match(result.reason, /since|日期|时间/i);

  const empty = getEvidenceChanges([crypto], 'stocks', 'AAPL', '2026-09-19T00:00:00Z');
  assert.equal(empty.dataStatus, 'empty');
  assert.deepEqual(empty.evidenceRefs, []);
});

test('market-level evidence changes remain scoped when no instrument is selected', () => {
  const stockA = snapshot({ id: 'ev_a', fetchedAt: '2026-09-19T01:00:00Z', fields: { price: 200 } });
  const stockB = createEvidenceSnapshot({
    market: 'stocks', instrument: 'MSFT', workspace: 'evidence', dataStatus: 'live',
    source: { id: 'nasdaq-public', name: 'Nasdaq' }, observedAt: '2026-09-19T01:00:00Z',
    fetchedAt: '2026-09-19T02:00:00Z', fields: { price: 410 }, id: 'ev_b',
  });
  const crypto = createEvidenceSnapshot({
    market: 'crypto', instrument: 'BTCUSDT', workspace: 'evidence', dataStatus: 'live',
    source: { id: 'binance-public', name: 'Binance' }, observedAt: '2026-09-19T01:00:00Z',
    fetchedAt: '2026-09-19T03:00:00Z', fields: { price: 60000 }, id: 'ev_crypto',
  });

  const result = getEvidenceChanges([stockA, stockB, crypto], 'stocks', undefined, '2026-09-19T00:00:00Z');

  assert.equal(result.dataStatus, 'cached');
  assert.deepEqual(result.evidenceRefs, ['ev_a', 'ev_b']);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.added, ['price']);
  assert.equal(result.reason, null);
});

test('evidence changes endpoint is registered with the shared envelope', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  assert.match(server, /app\.get\('\/api\/evidence\/changes'/);
  assert.match(server, /decisionEnvelope\(\{ market, instrument/);
  assert.match(server, /decisionIntelligenceStore\.listEvidence\(market, instrument\)/);
});
