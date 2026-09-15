const test = require('node:test');
const { strict: assert } = require('node:assert');
const {
  MARKET_IDS,
  assertMarketContext,
  createSourceEvidence,
  createExperimentRecord,
  transitionSignal,
} = require('../dist/features/research-contracts.js');

test('research contracts validate market context and preserve scoped identity', () => {
  assert.deepEqual(MARKET_IDS, ['stocks', 'options', 'crypto', 'prediction']);
  const context = assertMarketContext({
    market: 'stocks', workspace: 'chart', instrument: 'usMSFT', timeframe: '1h',
    dataStatus: 'live', updatedAt: 1700000000000,
  });
  assert.equal(context.market, 'stocks');
  assert.throws(() => assertMarketContext({ market: 'stocks', workspace: 'chart', instrument: 'crypto:BTCUSDT' }), /scope|market|标的/i);
  assert.throws(() => assertMarketContext({ market: 'crypto', workspace: 'chart', instrument: 'usMSFT' }), /scope|market|标的/i);
});

test('source evidence requires safe provenance and normalizes timestamps', () => {
  const evidence = createSourceEvidence({
    sourceName: 'Federal Reserve', sourceType: 'official',
    url: 'https://www.federalreserve.gov/releases/h10/current/',
    publishedAt: '2026-09-15T08:00:00Z', fetchedAt: 1700000000000,
  });
  assert.equal(evidence.sourceName, 'Federal Reserve');
  assert.equal(evidence.urlStatus, 'valid');
  assert.equal(typeof evidence.publishedAt, 'string');
  assert.throws(() => createSourceEvidence({ sourceName: 'bad', sourceType: 'unknown', url: 'javascript:alert(1)' }), /URL|source|来源/i);
});

test('experiment records are reproducible and reject invalid time ranges', () => {
  const record = createExperimentRecord({
    market: 'crypto', instrument: 'BTCUSDT', timeframe: '15m', strategyId: 'mean-v1', strategyVersion: '1.0.0',
    dataSource: 'binance-public', dataFrom: '2026-01-01', dataTo: '2026-02-01', feeRate: 0.001, slippage: 0.0005, seed: 7,
  });
  assert.equal(record.market, 'crypto');
  assert.equal(record.seed, 7);
  assert.match(record.id, /^exp_/);
  assert.throws(() => createExperimentRecord({ market: 'stocks', dataFrom: '2026-02-01', dataTo: '2026-01-01' }), /range|区间|时间/i);
});

test('signal lifecycle only permits safe forward transitions', () => {
  assert.equal(transitionSignal('generated', 'confirm'), 'confirmed');
  assert.equal(transitionSignal('confirmed', 'paper-fill'), 'paper-filled');
  assert.equal(transitionSignal('paper-filled', 'track'), 'tracking');
  assert.equal(transitionSignal('tracking', 'invalidate'), 'invalidated');
  assert.equal(transitionSignal('tracking', 'close'), 'closed');
  assert.equal(transitionSignal('closed', 'review'), 'reviewed');
  assert.throws(() => transitionSignal('generated', 'close'), /transition|状态/i);
  assert.throws(() => transitionSignal('reviewed', 'confirm'), /transition|状态/i);
});
