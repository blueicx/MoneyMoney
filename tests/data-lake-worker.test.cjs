const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DataLakeCatalog } = require('../dist/storage/data-lake');
const { DataLakeBackfillWorker } = require('../dist/storage/data-lake-worker');

function tempCatalog() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-worker-'));
  return { root, catalog: new DataLakeCatalog({ lakeRoot: path.join(root, 'lake'), databasePath: path.join(root, 'catalog.sqlite') }) };
}

test('backfill worker writes real adapter bars by time partition and query merges them', async () => {
  const { root, catalog } = tempCatalog();
  try {
    let calls = 0;
    const worker = new DataLakeBackfillWorker(catalog, () => ({
      fetch: async () => {
        calls += 1;
        return {
          data: [
            { time: Date.parse('2026-01-30T00:00:00.000Z'), open: 100, high: 105, low: 99, close: 104, volume: 10 },
            { time: Date.parse('2026-02-02T00:00:00.000Z'), open: 104, high: 108, low: 103, close: 107, volume: 20 },
          ],
          source: 'test-yahoo', fetchedAt: '2026-02-03T00:00:00.000Z', expiresAt: '2026-02-04T00:00:00.000Z', latencyMs: 1, status: 'live',
        };
      },
    }));
    const job = catalog.createBackfill({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' });
    const result = await worker.runOnce();
    assert.equal(calls, 1);
    assert.equal(result.id, job.id);
    assert.equal(result.status, 'succeeded');
    assert.equal(catalog.listPartitions().length, 2);
    const snapshot = await catalog.queryBarsAsOf({ market: 'stocks', instrument: 'AAPL', timeframe: '1d', asOf: '2026-02-04T00:00:00.000Z' });
    assert.deepEqual(snapshot.rows.map(row => row.close), [104, 107]);
    assert.equal(snapshot.dataStatus, 'historical');
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('backfill worker records an explicit empty-source failure without publishing data', async () => {
  const { root, catalog } = tempCatalog();
  try {
    const worker = new DataLakeBackfillWorker(catalog, () => ({
      fetch: async () => ({ data: [], source: 'test-yahoo', fetchedAt: '2026-02-03T00:00:00.000Z', expiresAt: '2026-02-04T00:00:00.000Z', latencyMs: 1, status: 'live', error: 'no rows' }),
    }));
    const job = catalog.createBackfill({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' });
    const result = await worker.runOnce();
    assert.equal(result.id, job.id);
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /no rows|暂无|empty/i);
    assert.deepEqual(catalog.listPartitions(), []);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('backfill worker rejects unsupported markets before calling the provider', async () => {
  const { root, catalog } = tempCatalog();
  try {
    let calls = 0;
    const worker = new DataLakeBackfillWorker(catalog, () => ({ fetch: async () => { calls += 1; throw new Error('must not fetch'); } }));
    const job = catalog.createBackfill({ market: 'crypto', dataset: 'bars', instrument: 'BTCUSDT', timeframe: '1d', from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' });
    const result = await worker.runOnce();
    assert.equal(result.id, job.id);
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /stocks|unsupported|市场/i);
    assert.equal(calls, 0);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('backfill worker routes a crypto bars job through its market-scoped provider', async () => {
  const { root, catalog } = tempCatalog();
  try {
    let calls = 0;
    const worker = new DataLakeBackfillWorker(catalog, {
      providers: [{
        id: 'test-binance-bars',
        market: 'crypto',
        datasets: ['bars'],
        timeframes: ['1d'],
        createAdapter: () => ({
          id: 'test-binance-bars',
          group: 'test crypto',
          fetch: async () => {
            calls += 1;
            return {
              data: [{ time: Date.parse('2026-02-02T00:00:00.000Z'), open: 100, high: 105, low: 99, close: 103, volume: 20 }],
              source: 'test-binance-bars', fetchedAt: '2026-02-03T00:00:00.000Z', expiresAt: '2026-02-04T00:00:00.000Z', latencyMs: 1, status: 'live',
            };
          },
        }),
      }],
    });
    assert.equal(catalog.listProviderContracts('crypto').map(item => item.id).includes('test-binance-bars'), true);
    const job = catalog.createBackfill({ market: 'crypto', dataset: 'bars', instrument: 'BTCUSDT', timeframe: '1d', from: '2026-02-01T00:00:00.000Z', to: '2026-02-03T00:00:00.000Z' });
    const result = await worker.runOnce();
    assert.equal(result.id, job.id);
    assert.equal(result.status, 'succeeded');
    assert.equal(calls, 1);
    assert.equal(catalog.listPartitions()[0].market, 'crypto');
    const snapshot = await catalog.queryBarsAsOf({ market: 'crypto', instrument: 'BTCUSDT', timeframe: '1d', asOf: '2026-02-04T00:00:00.000Z' });
    assert.deepEqual(snapshot.rows.map(row => row.close), [103]);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('backfill worker reports unavailable provider without publishing options data', async () => {
  const { root, catalog } = tempCatalog();
  try {
    let calls = 0;
    const worker = new DataLakeBackfillWorker(catalog, {
      providers: [{
        id: 'test-stock-only',
        market: 'stocks',
        datasets: ['bars'],
        timeframes: ['1d'],
        createAdapter: () => ({ fetch: async () => { calls += 1; return { data: [] }; } }),
      }],
    });
    const job = catalog.createBackfill({ market: 'options', dataset: 'bars', instrument: 'option:AAPL:20270115:200:C', timeframe: '1d', from: '2026-02-01T00:00:00.000Z', to: '2026-02-03T00:00:00.000Z' });
    const result = await worker.runOnce();
    assert.equal(result.id, job.id);
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /Provider|来源|unavailable/i);
    assert.equal(calls, 0);
    assert.deepEqual(catalog.listPartitions(), []);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('backfill worker never runs two jobs concurrently', async () => {
  const { root, catalog } = tempCatalog();
  try {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const worker = new DataLakeBackfillWorker(catalog, () => ({ fetch: async () => { await gate; return { data: [], source: 'test', fetchedAt: '2026-02-03T00:00:00.000Z', expiresAt: '2026-02-04T00:00:00.000Z', latencyMs: 1, status: 'live' }; } }));
    catalog.createBackfill({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' });
    const first = worker.runOnce();
    const second = await worker.runOnce();
    assert.equal(second, null);
    release();
    await first;
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('backfill recovery requeues jobs left running after a worker interruption', async () => {
  const { root, catalog } = tempCatalog();
  try {
    const job = catalog.createBackfill({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' });
    assert.equal(catalog.claimNextBackfill().id, job.id);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(catalog.recoverStaleBackfills(1), 1);
    const recovered = catalog.getBackfill(job.id);
    assert.equal(recovered.status, 'queued');
    assert.match(recovered.reason, /重新排队/);
    assert.equal(catalog.claimNextBackfill().id, job.id);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('backfill lease records owner, heartbeat and checkpoint before recovery', async () => {
  const { root, catalog } = tempCatalog();
  try {
    const job = catalog.createBackfill({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' });
    const claimed = catalog.claimNextBackfill('worker-a', 60_000);
    assert.equal(claimed.id, job.id);
    assert.equal(claimed.leaseOwner, 'worker-a');
    assert.ok(claimed.leaseExpiresAt);
    const checkpointed = catalog.heartbeatBackfill(job.id, 'worker-a', { cursor: '2026-02-01T00:00:00.000Z', rowsWritten: 10 });
    assert.equal(checkpointed.checkpoint.cursor, '2026-02-01T00:00:00.000Z');
    assert.equal(checkpointed.checkpoint.rowsWritten, 10);
    assert.equal(catalog.heartbeatBackfill(job.id, 'worker-b'), null);
    assert.equal(catalog.recoverStaleBackfills(60_000), 0);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
