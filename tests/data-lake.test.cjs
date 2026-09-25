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
    const revised = await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows.map(row => ({ ...row, close: row.close + 1, high: row.high + 1 })) });
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

test('data lake rejects impossible OHLC and negative volume before publishing', async () => {
  const { root, catalog } = tempCatalog();
  try {
    for (const badRow of [
      { ...stockRows[0], high: 98 },
      { ...stockRows[0], low: 106 },
      { ...stockRows[0], volume: -1 },
      { ...stockRows[0], open: -1 },
      { ...stockRows[0], timestamp: '2026-09-01T00:00:00' },
    ]) {
      await assert.rejects(() => catalog.stageBars({
        market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d',
        source: 'test-source', publishedAt: '2026-09-03T00:00:00.000Z', rows: [badRow, stockRows[1]],
      }), /quality gate/i);
    }
    assert.deepEqual(catalog.listPartitions(), []);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('corporate actions reject impossible split factors and missing symbol-change mapping', () => {
  const { root, catalog } = tempCatalog();
  try {
    assert.throws(() => catalog.saveCorporateAction({ id: 'bad-split', market: 'stocks', instrument: 'AAPL', kind: 'split', effectiveAt: '2026-09-01T00:00:00.000Z', factor: 0, source: 'official' }), /factor/i);
    assert.throws(() => catalog.saveCorporateAction({ id: 'bad-rename', market: 'stocks', instrument: 'AAPL', kind: 'symbol-change', effectiveAt: '2026-09-01T00:00:00.000Z', source: 'official' }), /symbol/i);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('declared provider units and timezone must match incoming historical bars', async () => {
  const { root, catalog } = tempCatalog();
  try {
    catalog.registerProviderContract({ id: 'stock-provider', provider: 'trusted-provider', market: 'stocks', datasets: ['bars'], timezone: 'UTC', units: { price: 'USD', volume: 'shares' }, revisionPolicy: 'point-in-time' });
    await assert.rejects(() => catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'trusted-provider', publishedAt: '2026-09-03T00:00:00.000Z', timezone: 'America/New_York', rows: stockRows }), /timezone/i);
    await assert.rejects(() => catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'trusted-provider', publishedAt: '2026-09-03T00:00:00.000Z', units: { price: 'EUR', volume: 'shares' }, rows: stockRows }), /unit/i);
    assert.equal(catalog.listPartitions().length, 0);
    await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'trusted-provider', publishedAt: '2026-09-03T00:00:00.000Z', units: { price: 'USD', volume: 'shares' }, rows: stockRows });
    await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'SNDK', timeframe: '1d', source: 'other-provider', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows });
    assert.equal(catalog.listQuality('stocks', 'AAPL').length, 1);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('registered exchange instrument permits new crypto pairs without a fixed coin whitelist', async () => {
  const { root, catalog } = tempCatalog();
  try {
    catalog.registerInstrument({ type: 'crypto', venue: 'binance', symbol: 'ATOMUSDT', title: 'Cosmos', aliases: [] });
    const saved = await catalog.stageBars({
      market: 'crypto', dataset: 'bars', instrument: 'ATOMUSDT', timeframe: '1d',
      source: 'test-source', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows,
    });
    assert.equal(saved.status, 'committed');
    assert.equal(catalog.resolveInstrument('crypto', 'ATOMUSDT').id, 'crypto:binance:ATOMUSDT');
    assert.throws(() => catalog.resolveInstrument(undefined, 'ATOMUSDT'), /market|ambiguous/i);
    assert.equal(catalog.resolveInstrument('stocks', 'ATOMUSDT'), null);
    catalog.registerInstrument({ type: 'crypto', venue: 'kraken', symbol: 'ATOMUSDT', title: 'Cosmos Kraken', aliases: [] });
    assert.throws(() => catalog.resolveInstrument('crypto', 'ATOMUSDT'), /ambiguous/i);
    assert.equal(catalog.resolveInstrument('crypto', 'crypto:binance:ATOMUSDT').venue, 'binance');
    await assert.rejects(() => catalog.stageBars({ market: 'crypto', dataset: 'bars', instrument: 'ATOMUSDT', timeframe: '1d', source: 'test-source', publishedAt: '2026-09-04T00:00:00.000Z', rows: stockRows }), /ambiguous/i);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('legacy partitions migrate only identities with a known venue and quarantine unknown sources', async () => {
  const { root, catalog } = tempCatalog();
  const lakeRoot = path.join(root, 'lake');
  const databasePath = path.join(root, 'catalog.sqlite');
  try {
    await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'legacy-stock', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows });
    await catalog.stageBars({ market: 'crypto', dataset: 'bars', instrument: 'ATOMUSDT', timeframe: '1d', source: 'mystery-source', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows });
    catalog.close();
    const reopened = new DataLakeCatalog({ lakeRoot, databasePath });
    try {
      assert.equal(reopened.resolveInstrument('stocks', 'AAPL').id, 'stock:us:AAPL');
      assert.equal(reopened.resolveInstrument('crypto', 'ATOMUSDT'), null);
      assert.equal(reopened.listInstrumentQuarantine('crypto').length, 1);
      assert.equal(reopened.listInstrumentQuarantine('crypto')[0].instrument, 'ATOMUSDT');
      reopened.registerInstrument({ type: 'crypto', venue: 'kraken', symbol: 'ATOMUSDT', title: 'Cosmos', aliases: [] });
      assert.equal(reopened.listInstrumentQuarantine('crypto').length, 0);
      assert.equal(reopened.resolveInstrument('crypto', 'ATOMUSDT').venue, 'kraken');
    } finally { reopened.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('conflicting provider bars are quarantined with both source prices', async () => {
  const { root, catalog } = tempCatalog();
  try {
    await catalog.stageBars({ market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'provider-a', publishedAt: '2026-09-03T00:00:00.000Z', rows: stockRows });
    await assert.rejects(() => catalog.stageBars({
      market: 'stocks', dataset: 'bars', instrument: 'AAPL', timeframe: '1d', source: 'provider-b',
      publishedAt: '2026-09-03T01:00:00.000Z',
      rows: stockRows.map(row => ({ ...row, high: row.high + 20, close: row.close + 20 })),
    }), /provider conflict/i);
    assert.equal(catalog.listPartitions().length, 1);
    const disputes = catalog.listDiscrepancies('stocks', 'AAPL');
    assert.equal(disputes.length, 1);
    assert.equal(disputes[0].sourceA, 'provider-a');
    assert.equal(disputes[0].sourceB, 'provider-b');
    assert.equal(disputes[0].status, 'partial');
    assert.equal(disputes[0].evidence[0].closeA, 104);
    assert.equal(disputes[0].evidence[0].closeB, 124);
  } finally { catalog.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('data discrepancy API keeps market and instrument scope and reports partial state', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/web/server.ts'), 'utf8');
  assert.match(server, /app\.get\('\/api\/data\/discrepancies'/);
  assert.match(server, /listDiscrepancies\(market, instrument\)/);
  assert.match(server, /dataStatus: data\.length \? 'partial' : 'empty'/);
  assert.match(server, /app\.get\('\/api\/data\/instruments\/resolve'/);
  assert.match(server, /app\.post\('\/api\/data\/instruments\/confirm'/);
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
