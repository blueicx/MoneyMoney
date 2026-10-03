const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { summarizePublishedCoverage } = require('../dist/features/data-coverage-status');

const now = '2026-10-03T12:00:00.000Z';
const canary = (overrides = {}) => ({
  market: 'stocks', instrument: 'stock:us:AAPL', checkedAt: now,
  status: 'live', reason: null, ...overrides,
});

test('recent provider failure cannot be hidden by an older published partition', () => {
  const result = summarizePublishedCoverage({
    partitions: [{ status: 'published', rowCount: 120 }],
    observations: [canary({ status: 'failed', reason: 'provider timeout' })],
    now,
  });
  assert.equal(result.partitionStatus, 'historical');
  assert.equal(result.sourceStatus, 'failed');
  assert.equal(result.dataStatus, 'partial');
  assert.match(result.reason, /provider timeout/);
});

test('successful empty provider result remains distinct from source failure', () => {
  const result = summarizePublishedCoverage({
    partitions: [], observations: [canary({ status: 'empty', reason: 'source responded with no rows' })], now,
  });
  assert.equal(result.sourceStatus, 'empty');
  assert.equal(result.dataStatus, 'empty');
  assert.match(result.reason, /no rows|没有|暂无/i);
});

test('stale canary does not imply current provider availability', () => {
  const result = summarizePublishedCoverage({
    market: 'stocks', instrument: 'stock:us:AAPL',
    partitions: [{ status: 'published', rowCount: 8 }],
    observations: [canary({ checkedAt: '2026-10-01T12:00:00.000Z', status: 'live' })],
    now,
    maxCanaryAgeMs: 24 * 60 * 60 * 1000,
  });
  assert.equal(result.sourceStatus, 'historical');
  assert.equal(result.dataStatus, 'historical');
  assert.match(result.reason, /过期|stale/i);
});

test('unrelated market/instrument observations are ignored and discrepancies remain partial', () => {
  const result = summarizePublishedCoverage({
    market: 'stocks', instrument: 'stock:us:AAPL',
    partitions: [{ status: 'published', rowCount: 8 }],
    observations: [canary({ market: 'crypto', instrument: 'crypto:binance:BTCUSDT', status: 'failed' })],
    discrepancyCount: 1,
    now,
  });
  assert.equal(result.sourceStatus, 'unavailable');
  assert.equal(result.dataStatus, 'partial');
  assert.match(result.reason, /差异|discrepanc/i);
});

test('coverage route preserves partition and source evidence while selecting exact canary scope', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'server.ts'), 'utf8');
  const start = source.indexOf("app.get('/api/data/coverage'");
  const route = source.slice(start, source.indexOf('\n});', start) + 4);
  assert.match(route, /summarizePublishedCoverage/);
  assert.match(route, /item\.market === rawMarket/);
  assert.match(route, /item\.instrument === instrument/);
  assert.match(route, /partitionStatus/);
  assert.match(route, /sourceStatus/);
});
