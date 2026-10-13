const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStockKlineProviderTelemetry } = require('../dist/features/stock-kline-telemetry.js');

test('stock K-line telemetry preserves source/capture times and does not call cached timing a fresh provider request', () => {
  const telemetry = buildStockKlineProviderTelemetry({
    provider: 'Yahoo Finance', cacheMode: 'cache', providerLatencyMs: 218, providerLatencyAt: 1_792_000_000_000,
    sourceTime: '2026-10-12T14:30:00.000Z', dataStatus: 'cached', reason: '缓存快照', retrievedAt: 1_792_000_100_000, cacheAgeMs: 100_000,
  });
  assert.equal(telemetry.provider, 'Yahoo Finance');
  assert.equal(telemetry.cacheMode, 'cache');
  assert.equal(telemetry.providerLatencyMs, 218);
  assert.equal(telemetry.providerLatencyAt, new Date(1_792_000_000_000).toISOString());
  assert.equal(telemetry.sourceTime, '2026-10-12T14:30:00.000Z');
  assert.equal(telemetry.retrievedAt, new Date(1_792_000_100_000).toISOString());
  assert.equal(telemetry.cacheAgeMs, 100_000);
  assert.equal(telemetry.dataStatus, 'cached');
  assert.equal(telemetry.reason, '缓存快照');
});

test('stock K-line telemetry represents unavailable values as null instead of fabricated zero latency or timestamps', () => {
  const telemetry = buildStockKlineProviderTelemetry({ provider: 'Yahoo Finance', cacheMode: 'error', providerLatencyMs: null, providerLatencyAt: null, sourceTime: null, dataStatus: 'unavailable', reason: '连接失败', retrievedAt: 0 });
  assert.equal(telemetry.providerLatencyMs, null);
  assert.equal(telemetry.providerLatencyAt, null);
  assert.equal(telemetry.sourceTime, null);
  assert.equal(telemetry.retrievedAt, new Date(0).toISOString());
  assert.equal(telemetry.reason, '连接失败');
});
