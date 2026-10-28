const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { DataLakeCatalog } = require('../dist/storage/data-lake');
const { createSavedEvidenceProofService } = require('../dist/features/research-evidence-governance');

test('observed-time reads reject later backfills while retaining existing publication-time reads', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-observed-asof-'));
  const catalog = new DataLakeCatalog({ lakeRoot: path.join(root, 'lake'), databasePath: path.join(root, 'catalog.sqlite') });
  try {
    const before = '2026-01-03T00:00:00.000Z';
    await catalog.stageBars({ market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'fixture',publishedAt:'2026-01-02T00:00:00.000Z',
      rows:[{timestamp:'2026-01-01T00:00:00.000Z',open:100,high:105,low:99,close:104,volume:1000}] });
    const input = {market:'stocks',instrument:'AAPL',timeframe:'1d',asOf:before};
    const legacy = await catalog.queryBarsAsOf(input);
    assert.equal(legacy.dataStatus,'historical');
    const strict = await catalog.queryBarsAsOf({...input,availability:'observed'});
    assert.equal(strict.dataStatus,'unavailable');
    assert.equal(strict.rows.length,0);
    assert.match(strict.reason,/抓取|获得/);
    const after = await catalog.queryBarsAsOf({...input,asOf:new Date(Date.now()+10000).toISOString(),availability:'observed'});
    assert.equal(after.dataStatus,'historical');
    assert.equal(after.rows.length,1);
  } finally {catalog.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('observed-time reads select the newest revision actually fetched by the cutoff', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-observed-revision-'));
  const catalog = new DataLakeCatalog({ lakeRoot: path.join(root, 'lake'), databasePath: path.join(root, 'catalog.sqlite') });
  try {
    const stage = (close, publishedAt) => catalog.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'fixture',publishedAt,
      rows:[{timestamp:'2026-01-01T00:00:00.000Z',open:100,high:110,low:90,close,volume:1000}]});
    const older = await stage(101,'2026-01-02T00:00:00.000Z');
    const newer = await stage(105,'2026-01-03T00:00:00.000Z');
    const db = new Database(path.join(root,'catalog.sqlite'));
    try {db.prepare('UPDATE dataset_partitions SET fetched_at=? WHERE id=?').run('2026-01-02T01:00:00.000Z',older.id);
      db.prepare('UPDATE dataset_partitions SET fetched_at=? WHERE id=?').run('2026-01-05T01:00:00.000Z',newer.id);} finally {db.close();}
    const base={market:'stocks',instrument:'AAPL',timeframe:'1d',asOf:'2026-01-04T00:00:00.000Z'};
    assert.equal((await catalog.queryBarsAsOf(base)).rows[0].close,105);
    assert.equal((await catalog.queryBarsAsOf({...base,availability:'observed'})).rows[0].close,101);
    await assert.rejects(catalog.queryBarsAsOf({...base,availability:'invalid'}),/availability/);
  } finally {catalog.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('observed snapshot freezes and verifies timing and file evidence independently of legacy snapshots', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mm-observed-proof-'));
  const dbPath=path.join(root,'catalog.sqlite'),catalog=new DataLakeCatalog({lakeRoot:path.join(root,'lake'),databasePath:dbPath});
  try {
    const part=await catalog.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'fixture',publishedAt:'2026-01-02T00:00:00Z',rows:[{timestamp:'2026-01-01T00:00:00Z',open:100,high:105,low:99,close:104,volume:1}]});
    const input={market:'stocks',instrument:'AAPL',timeframe:'1d',asOf:new Date(Date.now()+10000).toISOString()};
    const legacy=await catalog.queryBarsAsOf(input),observed=await catalog.queryBarsAsOf({...input,availability:'observed'});
    assert.notEqual(observed.snapshot.id,legacy.snapshot.id);
    assert.equal((await catalog.readSnapshotProofExact(legacy.snapshot)).availabilityProof,null);
    const proof=(await catalog.readSnapshotProofExact(observed.snapshot)).availabilityProof;
    assert.equal(proof.availability,'observed'); assert.equal(proof.version,2);
    assert.equal(proof.partitions[0].partitionId,part.id); assert.match(proof.partitions[0].fileHash,/^[a-f0-9]{64}$/);
    assert.ok(Date.parse(proof.partitions[0].fetchedAt)<=Date.parse(observed.snapshot.asOf));
    assert.equal(proof.rowEvidence.rule,'max(row-published-at,partition-fetched-at)');
    assert.equal(proof.rowEvidence.count,1);
    assert.match(proof.rowEvidence.rowsHash,/^[a-f0-9]{64}$/);
    assert.equal(observed.rows[0].availabilityObservedAt,new Date(Math.max(
      Date.parse(observed.rows[0].published_at),
      Date.parse(proof.partitions[0].fetchedAt),
    )).toISOString());
    const service=createSavedEvidenceProofService({catalog,projects:{read(){throw Error('not needed');}}});
    const exposed=await service.proof({market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',snapshotId:observed.snapshot.id});
    assert.equal(exposed.availabilityProof.contentHash,proof.contentHash);
    assert.equal((await service.proof({market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',snapshotId:legacy.snapshot.id})).availabilityProof,null);
    const db=new Database(dbPath);try{db.prepare('UPDATE dataset_partitions SET fetched_at=? WHERE id=?').run('2026-01-01T00:00:00.000Z',part.id);}finally{db.close();}
    await assert.rejects(catalog.readSnapshotProofExact(observed.snapshot),/evidence|proof|证据/i);
  } finally {catalog.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('invalid file evidence cannot publish an observed snapshot', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mm-observed-invalid-'));
  const dbPath=path.join(root,'catalog.sqlite'),catalog=new DataLakeCatalog({lakeRoot:path.join(root,'lake'),databasePath:dbPath});
  try {
    const part=await catalog.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'fixture',publishedAt:'2026-01-02T00:00:00Z',rows:[{timestamp:'2026-01-01T00:00:00Z',open:100,high:105,low:99,close:104,volume:1}]});
    const db=new Database(dbPath);try{db.prepare('UPDATE dataset_partition_files SET file_hash=? WHERE partition_id=?').run('a'.repeat(64),part.id);}finally{db.close();}
    await assert.rejects(catalog.queryBarsAsOf({market:'stocks',instrument:'AAPL',timeframe:'1d',asOf:new Date(Date.now()+10000).toISOString(),availability:'observed'}),/hash/i);
    assert.equal(catalog.listSnapshots({market:'stocks',instrument:'AAPL'}).length,0);
  } finally {catalog.close();fs.rmSync(root,{recursive:true,force:true});}
});
