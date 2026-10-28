const test = require('node:test');
const assert = require('node:assert/strict');

const { captureStockNewsEvidence } = require('../dist/features/stock-news-evidence');
const { verifyEvidenceSnapshotHash } = require('../dist/features/decision-intelligence');
const crypto = require('node:crypto');

const rawBody = Buffer.from(JSON.stringify({ news: [{ title: 'Apple publishes verified update' }] }));

function snapshot(overrides = {}) {
  return {
    items: [{
      title: 'Apple publishes verified update',
      source: 'Yahoo Finance',
      url: 'https://finance.yahoo.com/news/apple-update',
      publishedAt: '2026-01-02T10:00:00.000Z',
    }],
    status: 'live',
    updatedAt: '2026-01-02T10:00:00.000Z',
    retrievedAt: '2026-01-02T10:03:00.000Z',
    source: 'Yahoo Finance',
    contentHash: 'a'.repeat(64),
    rawResponseHash: crypto.createHash('sha256').update(rawBody).digest('hex'),
    rawResponseBytes: rawBody.byteLength,
    rawResponseBase64: rawBody.toString('base64'),
    ...overrides,
  };
}

test('stock news capture keeps publication and server retrieval times separate and hash-verifiable', () => {
  const captured = captureStockNewsEvidence({
    instrument: 'stock:us:AAPL',
    symbol: 'AAPL',
    snapshot: snapshot(),
  });
  assert.equal(captured.market, 'stocks');
  assert.equal(captured.instrument, 'stock:us:AAPL');
  assert.equal(captured.evidence.length, 1);
  assert.equal(captured.evidenceRefs[0], captured.responseEvidence.id);
  assert.equal(captured.evidenceRefs[1], captured.evidence[0].id);
  assert.equal(verifyEvidenceSnapshotHash(captured.responseEvidence), true);
  assert.equal(captured.responseEvidence.fields.rawResponseBase64, rawBody.toString('base64'));
  assert.equal(captured.evidence[0].fields.responseEvidenceId, captured.responseEvidence.id);
  assert.equal(captured.evidence[0].observedAt, '2026-01-02T10:00:00.000Z');
  assert.equal(captured.evidence[0].fetchedAt, '2026-01-02T10:03:00.000Z');
  assert.equal(captured.evidence[0].fields.responseContentHash, 'a'.repeat(64));
  assert.equal(captured.evidence[0].dataStatus, 'live');
  assert.equal(verifyEvidenceSnapshotHash(captured.evidence[0]), true);
});

test('stock news evidence versions change when a later server response is captured', () => {
  const first = captureStockNewsEvidence({ instrument: 'stock:us:AAPL', symbol: 'AAPL', snapshot: snapshot() });
  const same = captureStockNewsEvidence({ instrument: 'stock:us:AAPL', symbol: 'AAPL', snapshot: snapshot() });
  const laterRaw = Buffer.from(JSON.stringify({ news: [{ title: 'Apple publishes verified update', marker: 2 }] }));
  const later = captureStockNewsEvidence({
    instrument: 'stock:us:AAPL',
    symbol: 'AAPL',
    snapshot: snapshot({
      status: 'cached',
      retrievedAt: '2026-01-02T10:08:00.000Z',
      contentHash: 'b'.repeat(64),
      rawResponseHash: crypto.createHash('sha256').update(laterRaw).digest('hex'),
      rawResponseBytes: laterRaw.byteLength,
      rawResponseBase64: laterRaw.toString('base64'),
    }),
  });
  assert.equal(first.evidence[0].id, same.evidence[0].id, 'identical cached response capture is idempotent');
  assert.notEqual(first.evidence[0].id, later.evidence[0].id);
  assert.equal(later.evidence[0].dataStatus, 'cached');
});

test('stock news capture rejects identity mismatches, future capture times, and forged malformed items', () => {
  assert.throws(() => captureStockNewsEvidence({
    instrument: 'stock:us:MSFT',
    symbol: 'AAPL',
    snapshot: snapshot(),
  }), /身份|代码/);
  assert.throws(() => captureStockNewsEvidence({
    instrument: 'stock:us:AAPL',
    symbol: 'AAPL',
    snapshot: snapshot({ retrievedAt: new Date(Date.now() + 60_000).toISOString() }),
  }), /未来/);
  assert.throws(() => captureStockNewsEvidence({
    instrument: 'stock:us:AAPL',
    symbol: 'AAPL',
    snapshot: snapshot({ items: [{ ...snapshot().items[0], url: 'javascript:alert(1)' }] }),
  }), /来源/);
  assert.throws(() => captureStockNewsEvidence({
    instrument: 'stock:us:AAPL',
    symbol: 'AAPL',
    snapshot: snapshot({ rawResponseBase64: Buffer.from('{"tampered":true}').toString('base64') }),
  }), /字节数|Hash/);
});

test('successful empty stock news is explicit and does not fabricate evidence', () => {
  const captured = captureStockNewsEvidence({
    instrument: 'stock:us:AAPL',
    symbol: 'AAPL',
    snapshot: snapshot({ items: [], updatedAt: null }),
  });
  assert.deepEqual(captured.evidence, []);
  assert.deepEqual(captured.evidenceRefs, [captured.responseEvidence.id]);
  assert.equal(captured.responseEvidence.fields.responseStatus, 'live');
  assert.match(captured.reason, /空结果/);
});
