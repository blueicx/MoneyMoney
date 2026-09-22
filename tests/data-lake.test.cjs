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

test('data lake persists revisions and point-in-time snapshots for reproducible reads', async () => {
  const { root, catalog } = tempCatalog();
  try {
    const first = await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows });
    const second = await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-04T00:00:00.000Z', rows: stockRows.map(row => ({ ...row, close: row.close + 1 })) });
    const revisions = catalog.listRevisions('stocks');
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0].market, 'stocks');
    assert.equal(revisions[1].supersedes, revisions[0].id);
    assert.equal(revisions[1].contentHash, second.contentHash);
    const result = await catalog.queryBarsAsOf({ market: 'stocks', instrument: 'AAPL', timeframe: '1d', asOf: '2026-09-05T00:00:00.000Z' });
    assert.ok(result.snapshot?.id);
    const saved = catalog.getSnapshot(result.snapshot.id);
    assert.deepEqual(saved, result.snapshot);
    assert.equal(saved.contentHash, result.snapshot.contentHash);
    assert.equal(catalog.listPartitions()[0].id, first.id);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('asOf reads clip observations after the requested historical moment', async () => {
  const { root, catalog } = tempCatalog();
  try {
    await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'test-source', publishedAt: '2026-08-31T00:00:00.000Z', rows: stockRows });
    const result = await catalog.queryBarsAsOf({ market: 'stocks', instrument: 'AAPL', timeframe: '1d', asOf: '2026-09-01T12:00:00.000Z' });
    assert.equal(result.rows.length, 1);
    assert.equal(new Date(String(result.rows[0].timestamp)).toISOString(), '2026-09-01T00:00:00.000Z');
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('data lake persists stock corporate actions and provider contracts with market scope', async () => {
  const { root, catalog } = tempCatalog();
  try {
    catalog.saveCorporateAction({ id: 'ca-aapl-split', market: 'stocks', instrument: 'AAPL', kind: 'split', effectiveAt: '2026-08-01T00:00:00.000Z', factor: 4, source: 'official-test' });
    catalog.registerProviderContract({ id: 'provider-yahoo-bars', provider: 'Yahoo', market: 'stocks', datasets: ['bars', 'quote'], timezone: 'UTC', units: { price: 'USD', volume: 'shares' }, revisionPolicy: 'point-in-time' });
    assert.deepEqual(catalog.listCorporateActions('stocks', 'AAPL').map(item => item.id), ['ca-aapl-split']);
    assert.deepEqual(catalog.listCorporateActions('crypto'), []);
    assert.deepEqual(catalog.listProviderContracts('stocks').map(item => item.id), ['provider-yahoo-bars']);
    assert.deepEqual(catalog.listProviderContracts('crypto'), []);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('data lake reports coverage by market, instrument and timeframe', async () => {
  const { root, catalog } = tempCatalog();
  try {
    await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows });
    const coverage = catalog.listCoverage('stocks', 'AAPL', '1d');
    assert.equal(coverage.length, 1);
    assert.deepEqual(coverage[0], {
      market: 'stocks', instrument: 'AAPL', dataset: 'bars', timeframe: '1d', partitionCount: 1, rowCount: 2,
      periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-09-02T00:00:00.000Z', latestPublishedAt: '2026-09-03T00:00:00.000Z', status: 'committed',
    });
    assert.deepEqual(catalog.listCoverage('crypto'), []);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
