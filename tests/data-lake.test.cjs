const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DataLakeCatalog } = require('../dist/storage/data-lake');

function tempCatalog() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-lake-'));
  return { root, catalog: new DataLakeCatalog({ lakeRoot: path.join(root, 'lake'), databasePath: path.join(root, 'catalog.sqlite') }) };
}

const stockRows = [
  { timestamp: '2026-09-01T00:00:00.000Z', open: 100, high: 105, low: 99, close: 104, volume: 1000 },
  { timestamp: '2026-09-02T00:00:00.000Z', open: 104, high: 108, low: 103, close: 107, volume: 1200 },
];

test('data lake writes atomic Parquet partitions and restores the latest revision at asOf', async () => {
  const { root, catalog } = tempCatalog();
  try {
    const first = await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows });
    const second = await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-04T00:00:00.000Z', rows: stockRows.map(row => ({ ...row, close: row.close + 1 })) });
    assert.equal(first.status, 'committed');
    assert.equal(second.status, 'committed');
    assert.ok(fs.existsSync(first.path));
    assert.equal(fs.readdirSync(path.join(root, 'lake', '.staging')).length, 0);
    const beforeRevision = await catalog.queryBarsAsOf({ market: 'stocks', instrument: 'AAPL', timeframe: '1d', asOf: '2026-09-03T12:00:00.000Z' });
    const afterRevision = await catalog.queryBarsAsOf({ market: 'stocks', instrument: 'AAPL', timeframe: '1d', asOf: '2026-09-05T00:00:00.000Z' });
    assert.equal(beforeRevision.rows[0].close, 104);
    assert.equal(afterRevision.rows[0].close, 105);
    assert.equal(afterRevision.dataStatus, 'historical');
    assert.equal(afterRevision.source, 'test-source');
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('data lake content hashes include nested bar values', async () => {
  const { root, catalog } = tempCatalog();
  try {
    const first = await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows });
    const revised = await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows.map(row => ({ ...row, close: row.close + 10 })) });
    assert.notEqual(first.contentHash, revised.contentHash);
    assert.notEqual(first.path, revised.path);
    assert.equal(catalog.listPartitions().length, 2);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('data lake quality gate rejects duplicate and out-of-order rows before publishing', async () => {
  const { root, catalog } = tempCatalog();
  try {
    await assert.rejects(() => catalog.stageBars({
      market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-03T00:00:00.000Z',
      rows: [stockRows[1], stockRows[0], stockRows[0]],
    }), /quality gate/i);
    assert.deepEqual(catalog.listPartitions(), []);
    assert.equal(fs.existsSync(path.join(root, 'lake', 'stocks')), false);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('data lake rejects cross-market instrument identity before any provider write', async () => {
  const { root, catalog } = tempCatalog();
  try {
    await assert.rejects(() => catalog.stageBars({
      market: 'stocks', dataset: 'bars', instrument: 'BTCUSDT', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows,
    }), /market|instrument/i);
    await assert.rejects(() => catalog.stageBars({
      market: 'crypto', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows,
    }), /market|instrument/i);
    assert.deepEqual(catalog.listPartitions(), []);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('data lake diagnostics reports partition coverage and quota state', async () => {
  const { root, catalog } = tempCatalog();
  try {
    await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows });
    fs.writeFileSync(path.join(root, 'lake', '.staging', 'unfinished.tmp'), 'unfinished');
    const diagnostics = catalog.getDiagnostics({ quotaBytes: 1, warningPercent: 70, stopPercent: 90 });
    assert.equal(diagnostics.partitionCount, 1);
    assert.equal(diagnostics.byMarket.stocks, 1);
    assert.equal(diagnostics.stagingFileCount, 1);
    assert.equal(diagnostics.quotaState, 'blocked');
    assert.ok(diagnostics.usagePercent >= 90);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
