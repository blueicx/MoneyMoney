const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Worker } = require('node:worker_threads');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-startup-migration-'));
process.env.MONEYMONEY_DATA_DIR = root;
const { SQLiteStateStore, stateStore } = require('../dist/storage/sqlite-state');
test.after(() => stateStore.close());

test('legacy migration cannot overwrite a document committed by another connection after the initial check', () => {
  const dir = fs.mkdtempSync(path.join(root, 'race-'));
  const dbPath = path.join(dir, 'state.sqlite');
  const first = new SQLiteStateStore(dbPath, dir);
  const legacyPath = path.join(dir, 'settings.json');
  fs.writeFileSync(legacyPath, JSON.stringify({ revision: 'legacy' }));
  const originalRead = fs.readFileSync;
  let interleaved = false, second;
  // Force the exact interleaving at the file-I/O boundary; both writes use real SQLite connections.
  fs.readFileSync = function(filename, ...args) {
    const bytes = originalRead.call(fs, filename, ...args);
    if (filename === legacyPath && !interleaved) {
      interleaved = true;
      first.set('settings', { revision: 'newly-committed', privatePreference: true }, 9);
    }
    return bytes;
  };
  try {
    second = new SQLiteStateStore(dbPath, dir);
    assert.equal(interleaved, true);
    assert.deepEqual(second.get('settings'), { revision: 'newly-committed', privatePreference: true });
    assert.equal(second.health.migratedDocuments, 0);
    assert.equal(second.health.ok, true);
  } finally {
    fs.readFileSync = originalRead;
    second?.close();
    first.close();
  }
  const restarted = new SQLiteStateStore(dbPath, dir);
  try { assert.equal(restarted.get('settings').revision, 'newly-committed'); }
  finally { restarted.close(); }
});

test('custom database health reports the actual isolated file instead of the default database', () => {
  const dir = fs.mkdtempSync(path.join(root, 'health-'));
  const dbPath = path.join(dir, 'state.sqlite');
  const store = new SQLiteStateStore(dbPath, dir);
  try { assert.equal(store.health.databasePath, dbPath); }
  finally { store.close(); }
});

test('same-millisecond migration backups stay unique and never overwrite an earlier backup', () => {
  const dir = fs.mkdtempSync(path.join(root, 'backup-'));
  const backupDir = path.join(dir, 'migration-backups');
  fs.mkdirSync(backupDir);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ revision: 'legacy' }));
  const oldPath = path.join(backupDir, 'settings-2026-10-08T00-00-00-000Z.json');
  fs.writeFileSync(oldPath, 'existing immutable backup');
  const originalIso = Date.prototype.toISOString;
  Date.prototype.toISOString = () => '2026-10-08T00:00:00.000Z';
  let store;
  try {
    store = new SQLiteStateStore(path.join(dir, 'state.sqlite'), dir);
    assert.equal(store.health.ok, true);
    assert.deepEqual(store.get('settings'), { revision: 'legacy' });
    assert.equal(fs.readFileSync(oldPath, 'utf8'), 'existing immutable backup');
    assert.equal(fs.readdirSync(backupDir).length, 2);
  } finally { Date.prototype.toISOString = originalIso; store?.close(); }
});

test('non-lock startup errors fail closed without replacing the database contents', () => {
  const dir = fs.mkdtempSync(path.join(root, 'corrupt-'));
  const dbPath = path.join(dir, 'state.sqlite');
  const bytes = Buffer.alloc(512, 65);
  fs.writeFileSync(dbPath, bytes);
  assert.throws(() => new SQLiteStateStore(dbPath, dir), error => error.code === 'SQLITE_NOTADB');
  assert.deepEqual(fs.readFileSync(dbPath), bytes);
});

test('simultaneous first startup on an empty database elects exactly one lease owner', { timeout: 30000 }, async () => {
  for (let round = 0; round < 8; round++) {
    const dir = fs.mkdtempSync(path.join(root, 'empty-'));
    const barrier = new SharedArrayBuffer(4);
    const workers = [];
    const code = `const {parentPort,workerData}=require('node:worker_threads');
      process.env.MONEYMONEY_DATA_DIR=workerData.dir;
      const gate=new Int32Array(workerData.barrier);parentPort.postMessage({ready:true});Atomics.wait(gate,0,0);
      try { const {stateStore}=require(workerData.module);const acquired=stateStore.acquireLease('first-run',workerData.owner,1000,30000);stateStore.close();parentPort.postMessage({acquired}); }
      catch(e){parentPort.postMessage({error:e.code||e.message,stack:e.stack});}`;
    const ready = [], results = [];
    for (let index = 0; index < 4; index++) {
      const worker = new Worker(code, { eval: true, workerData: { dir, barrier, owner: `worker-${index}`, module: require.resolve('../dist/storage/sqlite-state') } });
      workers.push(worker);
      ready.push(new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }));
      results.push(new Promise((resolve, reject) => { worker.on('message', msg => { if (!msg.ready) resolve(msg); });worker.once('error', reject); }));
    }
    try {
      await Promise.all(ready);
      Atomics.store(new Int32Array(barrier), 0, 1); Atomics.notify(new Int32Array(barrier), 0);
      const rows = await Promise.all(results);
      assert.deepEqual(rows.filter(row => row.error), [], `first-startup failure in round ${round}: ${JSON.stringify(rows)}`);
      assert.equal(rows.filter(row => row.acquired).length, 1);
    } finally { await Promise.all(workers.map(worker => worker.terminate())); }
  }
});
