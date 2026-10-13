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

test('unreadable catalogued snapshots are not usable history even when source canary succeeds', () => {
  const partitions=[{status:'committed',partitionCount:2,rowCount:20,availablePartitionCount:0,availableRowCount:0,unavailablePartitionCount:2,reason:'2 份历史快照未通过内容校验'}];
  const result=summarizePublishedCoverage({partitions,now});
  assert.equal(result.partitionStatus,'unavailable');assert.equal(result.dataStatus,'unavailable');
  assert.match(result.reason,/校验/);
  const live=summarizePublishedCoverage({partitions,observations:[canary()],now});
  assert.equal(live.sourceStatus,'live');assert.equal(live.partitionStatus,'unavailable');assert.equal(live.dataStatus,'partial');
});

test('mixed valid and damaged snapshots retain partial history separately from current source status', () => {
  const result=summarizePublishedCoverage({partitions:[{status:'committed',partitionCount:2,rowCount:20,availablePartitionCount:1,availableRowCount:10,unavailablePartitionCount:1,reason:'1 份历史快照未通过内容校验'}],observations:[canary({status:'empty'})],now});
  assert.equal(result.partitionStatus,'partial');assert.equal(result.sourceStatus,'empty');assert.equal(result.dataStatus,'partial');assert.match(result.reason,/校验/);
});

test('dashboard options card reports only verified history and keeps catalogue failures visible',()=>{
  const {buildOptionsCoverageCard}=require('../dist/features/data-coverage-status');
  assert.equal(typeof buildOptionsCoverageCard,'function');
  const row={market:'options',dataset:'options-chain-snapshots',instrument:'option:cboe:AAPL',timeframe:'snapshot',partitionCount:2,rowCount:20,availablePartitionCount:1,availableRowCount:10,unavailablePartitionCount:1,availableLatestPublishedAt:'2026-09-26T14:00:00.000Z'};
  const partial=buildOptionsCoverageCard([row]);
  assert.equal(partial.status,'partial');assert.equal(partial.updatedAt,row.availableLatestPublishedAt);
  assert.equal(partial.metrics.find(item=>item.label==='可用合约行').value,10);
  assert.equal(partial.metrics.find(item=>item.label==='隔离分区').value,1);
  assert.match(partial.reason,/校验|损坏/);
  const unavailable=buildOptionsCoverageCard([{...row,availablePartitionCount:0,availableRowCount:0,unavailablePartitionCount:2,availableLatestPublishedAt:null}]);
  assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.updatedAt,null);
  assert.equal(unavailable.metrics.find(item=>item.label==='可用合约行').value,0);
  assert.equal(buildOptionsCoverageCard([]).status,'empty');
  assert.equal(buildOptionsCoverageCard([{...row,market:'stocks'}]).status,'empty');
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
