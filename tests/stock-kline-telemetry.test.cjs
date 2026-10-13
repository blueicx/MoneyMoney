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

test('K-line route does not substitute retrieval time when the provider did not declare source time',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),source=fs.readFileSync('src/web/server.ts','utf8');
  const start=source.indexOf('    const providerTelemetry = (dataStatus:'),end=source.indexOf('\n    });',start)+8;
  assert.ok(start>0 && end>start);
  const code=ts.transpile(source.slice(start,end)+'\nglobalThis.observed=providerTelemetry("delayed",null);',{target:ts.ScriptTarget.ES2022});
  const context=vm.createContext({snapshot:{source:'fixture',fetchedAt:'2026-10-13T00:00:00Z'},observedCacheMode:'origin',observedProviderLatencyMs:1,observedProviderLatencyAt:1,displayCacheEntry:null,buildStockKlineProviderTelemetry});
  vm.runInContext(code,context);assert.equal(context.observed.sourceTime,null);assert.ok(context.observed.retrievedAt);
});
