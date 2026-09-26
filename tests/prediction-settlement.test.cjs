const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { buildSettlementEndpoint, buildPolymarketResolutionEndpoint, settlementPayloadMatches, normalizeSettlementEvidence, PredictionSettlementRepository } = require('../dist/features/prediction-settlement');

test('settlement source payload must identify the exact requested venue market', () => {
  assert.equal(settlementPayloadMatches('Kalshi', 'KXTEST-26', { ticker: 'KXTEST-26' }), true);
  assert.equal(settlementPayloadMatches('Kalshi', 'KXTEST-26', { ticker: 'OTHER-26' }), false);
  assert.equal(settlementPayloadMatches('Kalshi', 'KXTEST-26', {}), false);
  assert.equal(settlementPayloadMatches('Polymarket', '12345', { id: '12345' }), true);
  assert.equal(settlementPayloadMatches('Polymarket', '12345', { id: '54321' }), false);
  assert.equal(settlementPayloadMatches('Polymarket', '12345', {}), false);
});

test('Kalshi settlement keeps official rules, explicit outcome and settlement timestamps', () => {
  const evidence = normalizeSettlementEvidence({ platform: 'Kalshi', marketId: 'KXTEST-26', capturedAt: '2026-09-26T12:00:00.000Z', payload: {
    status: 'settled', result: 'yes', rules_primary: 'If the agency publishes X by date Y.', rules_secondary: 'See linked bulletin.', close_time: '2026-09-25T20:00:00Z', settlement_ts: '2026-09-26T11:00:00Z',
  } });
  assert.equal(evidence.market, 'prediction');
  assert.equal(evidence.status, 'settled');
  assert.equal(evidence.result, 'YES');
  assert.equal(evidence.rulesText, 'If the agency publishes X by date Y.\n\nSee linked bulletin.');
  assert.equal(evidence.determinationAt, null);
  assert.equal(evidence.settlementAt, '2026-09-26T11:00:00.000Z');
  assert.ok(evidence.rulesHash);
  assert.ok(evidence.evidenceHash);
});

test('Polymarket closing prices are never treated as a settlement result', () => {
  const evidence = normalizeSettlementEvidence({ platform: 'Polymarket', marketId: '12345', capturedAt: '2026-09-26T12:00:00.000Z', payload: {
    closed: true, outcomePrices: '["1","0"]', description: 'Resolution rules.', resolutionSource: 'https://example.org/official', closedTime: '2026-09-26T10:00:00Z',
  } });
  assert.equal(evidence.status, 'closed');
  assert.equal(evidence.result, null);
  assert.equal(evidence.resolutionSourceUrl, 'https://example.org/official');
  assert.match(evidence.reason, /未提供可核实的最终结果/);
});

test('Polymarket official resolution payout evidence determines binary outcome without reading market prices', () => {
  const conditionId = `0x${'a'.repeat(64)}`;
  const evidence = normalizeSettlementEvidence({
    platform: 'Polymarket', marketId: '12345', capturedAt: '2026-09-26T12:00:00.000Z',
    payload: { id: '12345', conditionId, closed: true, outcomes: '["Yes","No"]', outcomePrices: '["0.01","0.99"]', description: 'Official rules.' },
    resolutionPayload: { data: [{
      condition_id: conditionId, status: 'resolved', payouts: [1, 0], resolved_at: '2026-09-26T11:00:00Z',
      transaction_hash: '0xsettled', resolution_source: 'https://example.org/final-bulletin', was_disputed: false,
    }] },
  });
  assert.equal(evidence.status, 'settled');
  assert.equal(evidence.result, 'YES');
  assert.equal(evidence.determinationAt, '2026-09-26T11:00:00.000Z');
  assert.equal(evidence.settlementAt, null);
  assert.equal(evidence.resolutionEvidence.status, 'resolved');
  assert.deepEqual(evidence.resolutionEvidence.payouts, [1, 0]);
  assert.equal(evidence.resolutionEvidence.transactionHash, '0xsettled');
  assert.match(evidence.determinationSourceUrl, /data-api\.polymarket\.com\/v2\/resolutions/);
  assert.equal(evidence.resolutionSourceUrl, 'https://example.org/final-bulletin');
});

test('Polymarket payout evidence is not final unless official resolution status and binary outcome labels agree', () => {
  const conditionId = `0x${'b'.repeat(64)}`;
  const pending = normalizeSettlementEvidence({ platform: 'Polymarket', marketId: '12345', payload: { closed: true, outcomes: '["Yes","No"]', outcomePrices: '["1","0"]' }, resolutionPayload: { data: [{ condition_id: conditionId, status: 'proposed', payouts: [1, 0] }] } });
  const ambiguous = normalizeSettlementEvidence({ platform: 'Polymarket', marketId: '12345', payload: { closed: true, outcomes: '["A","B"]' }, resolutionPayload: { data: [{ condition_id: conditionId, status: 'resolved', payouts: [1, 0] }] } });
  assert.equal(pending.result, null);
  assert.equal(ambiguous.result, null);
  assert.notEqual(pending.status, 'settled');
  assert.notEqual(ambiguous.status, 'settled');
});

test('explicit result is accepted but venue, id and endpoint are fixed and validated', () => {
  const evidence = normalizeSettlementEvidence({ platform: 'Polymarket', marketId: '12345', payload: { closed: true, resolved: true, result: 'NO' } });
  assert.equal(evidence.status, 'settled');
  assert.equal(evidence.result, 'NO');
  assert.equal(buildSettlementEndpoint('Kalshi', 'KXTEST-26'), 'https://external-api.kalshi.com/trade-api/v2/markets/KXTEST-26');
  assert.equal(buildSettlementEndpoint('Polymarket', '12345'), 'https://gamma-api.polymarket.com/markets/12345');
  assert.equal(buildPolymarketResolutionEndpoint(`0x${'a'.repeat(64)}`), `https://data-api.polymarket.com/v2/resolutions?condition=0x${'a'.repeat(64)}`);
  assert.throws(() => buildSettlementEndpoint('Kalshi', 'https://evil.test'), /invalid/i);
  assert.throws(() => buildPolymarketResolutionEndpoint('https://evil.test'), /invalid/i);
  assert.throws(() => buildSettlementEndpoint('Manifold', '123'), /unsupported/i);
});

test('settlement repository records rules revisions and keeps venue identities isolated', () => {
  const documents = new Map();
  const store = { get: key => documents.get(key) || null, set: (key, value) => documents.set(key, value) };
  const repository = new PredictionSettlementRepository(store);
  const first = repository.save(normalizeSettlementEvidence({ platform: 'Kalshi', marketId: 'KXTEST-26', payload: { status: 'open', rules_primary: 'Rule A' } }));
  const updated = repository.save(normalizeSettlementEvidence({ platform: 'Kalshi', marketId: 'KXTEST-26', payload: { status: 'open', rules_primary: 'Rule B' } }));
  repository.save(normalizeSettlementEvidence({ platform: 'Polymarket', marketId: '987', payload: { closed: true } }));
  assert.notEqual(first.rulesHash, updated.rulesHash);
  assert.equal(repository.history('Kalshi', 'KXTEST-26').length, 2);
  assert.equal(repository.latest('Polymarket', '987').platform, 'Polymarket');
});

test('settlement API and prediction cards expose rules, evidence and explicit unknown state', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  const html = fs.readFileSync('src/web/public/index.html', 'utf8');
  const feature = fs.readFileSync('src/features/prediction-settlement.ts', 'utf8');
  assert.match(server, /\/api\/prediction\/settlement\/:platform\/:marketId/);
  assert.match(server, /PredictionSettlementRepository/);
  assert.match(server, /buildPolymarketResolutionEndpoint/);
  assert.match(server, /settlementPayloadMatches\(platform, marketId, payload\)/);
  assert.match(server, /resolutionPayload/);
  assert.match(html, /togglePredictionSettlement\(/);
  assert.match(html, /结算规则与证据/);
  assert.match(feature, /未提供可核实的最终结果/);
});
