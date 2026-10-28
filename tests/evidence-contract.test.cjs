const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { createEvidenceRef, verifyEvidenceRef, evidenceRefDigest } = require('../src/features/evidence-contract');

const hash = 'a'.repeat(64);
const base = { market: 'stocks', instrument: 'stock:us:AAPL', kind: 'quote', source: 'fixture', publishedAt: '2026-01-01T00:00:00Z', observedAt: '2026-01-01T00:00:01Z', fetchedAt: '2026-01-01T00:00:02Z', contentHash: hash, coverage: 'complete', unknownReason: null };

test('evidence contract normalizes and verifies complete refs', () => {
  const ref = createEvidenceRef(base);
  assert.equal(ref.fetchedAt, '2026-01-01T00:00:02.000Z');
  assert.equal(verifyEvidenceRef(ref), true);
  assert.match(evidenceRefDigest(ref), /^[a-f0-9]{64}$/);
});

test('evidence contract refuses unproven or malformed refs', () => {
  assert.throws(() => createEvidenceRef({ ...base, fetchedAt: '2026-01-01 00:00:02' }), /时区/);
  assert.throws(() => createEvidenceRef({ ...base, contentHash: null }), /完整证据/);
  assert.throws(() => createEvidenceRef({ ...base, coverage: 'unknown', unknownReason: null }), /原因/);
  assert.throws(() => createEvidenceRef({ ...base, publishedAt: '2026-01-02T00:00:00Z' }), /倒置/);
  const tampered = { ...createEvidenceRef(base), contentHash: 'b'.repeat(64) };
  assert.equal(verifyEvidenceRef(tampered), true, 're-serialized refs are still structurally valid');
  assert.equal(verifyEvidenceRef({ ...tampered, coverage: 'nonsense' }), false);
});

test('partial coverage may omit a reason but unknown may not', () => {
  const partial = createEvidenceRef({ ...base, coverage: 'partial', unknownReason: null });
  assert.equal(partial.coverage, 'partial');
  assert.throws(() => createEvidenceRef({ ...base, coverage: 'unavailable', unknownReason: '' }), /原因/);
});
