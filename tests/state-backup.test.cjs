const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

for(const scenario of ['root','lake'])test(`malformed ${scenario} JSON aborts backup without leaving another snapshot or revealing payload`,t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mm-bad-json-backup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const db=new Database(path.join(root,'moneymoney.sqlite'));db.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY)');db.close();
 const invalid=scenario==='root'?path.join(root,'private-cache.json'):path.join(root,'lake','options-chain','broken.json');
 fs.mkdirSync(path.dirname(invalid),{recursive:true});const bytes=Buffer.from('{"privateValue":undefined,"secret":"do-not-log-this-payload"}');fs.writeFileSync(invalid,bytes);
 const result=spawnSync(process.execPath,['scripts/state-backup.cjs'],{cwd:process.cwd(),env:{...process.env,MONEYMONEY_DATA_DIR:root},encoding:'utf8'});
 assert.notEqual(result.status,0);assert.match(result.stderr,/invalid JSON/i);assert.match(result.stderr,new RegExp(path.basename(invalid).replace('.','\\.')));
 assert.equal(result.stderr.includes('do-not-log-this-payload'),false);assert.equal(result.stderr.includes(root),false);
 assert.deepEqual(fs.readFileSync(invalid),bytes);
 const snapshots=fs.existsSync(path.join(root,'backups'))?fs.readdirSync(path.join(root,'backups')):[];assert.deepEqual(snapshots,[]);
});

test('large data-lake file hashing uses bounded-memory streaming', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/state-backup.cjs'), 'utf8');
  const start = source.indexOf('function sha256(file)');
  const end = source.indexOf('function sqliteSummary', start);
  const implementation = source.slice(start, end);
  assert.match(implementation, /readSync/);
  assert.doesNotMatch(implementation, /readFileSync/);
});

test('production build packages the isolated state-backup worker outside public assets', () => {
  const worker = path.join(process.cwd(), 'dist', 'scripts', 'state-backup.cjs');
  assert.ok(fs.existsSync(worker), 'daily scheduler worker must ship with the production dist');
  assert.equal(worker.includes(`${path.sep}public${path.sep}`), false);
});

test('packaged worker defaults to the application data directory rather than dist/data', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-packaged-backup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appRoot = path.join(root, 'app');
  const packagedScripts = path.join(appRoot, 'dist', 'scripts');
  const dataRoot = path.join(appRoot, 'data');
  fs.mkdirSync(packagedScripts, { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'dist', 'scripts', 'state-backup.cjs'), path.join(packagedScripts, 'state-backup.cjs'));
  const db = new Database(path.join(dataRoot, 'moneymoney.sqlite'));
  db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY);');
  db.close();

  const env = { ...process.env, NODE_PATH: [path.join(process.cwd(), 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter) };
  delete env.MONEYMONEY_DATA_DIR;
  const result = spawnSync(process.execPath, [path.join(packagedScripts, 'state-backup.cjs')], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(dataRoot, 'backups')), true, 'default backup must be written beside application data');
  assert.equal(fs.existsSync(path.join(appRoot, 'dist', 'data', 'backups')), false, 'packaged worker must not create a parallel dist/data tree');
});

test('backup includes consistent SQLite databases, runtime JSON and lake files; verify restores only into isolation', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-backup-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, 'runtime-data');
  fs.mkdirSync(path.join(dataRoot, 'lake', 'stocks'), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'lake', '.staging'), { recursive: true });
  for (const name of ['moneymoney.sqlite', 'research.db']) {
    const db = new Database(path.join(dataRoot, name));
    db.exec("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sample(value) VALUES ('preserve');");
    db.close();
  }
  fs.writeFileSync(path.join(dataRoot, 'telegram-state.json'), '{"ok":true}\n');
  fs.writeFileSync(path.join(dataRoot, 'lake', 'stocks', 'bars.parquet'), 'lake-data-for-hash');
  const largeLakeFile = Buffer.alloc(2 * 1024 * 1024 + 137, 0xa7);
  fs.writeFileSync(path.join(dataRoot, 'lake', 'stocks', 'large-bars.parquet'), largeLakeFile);
  fs.writeFileSync(path.join(dataRoot, 'lake', '.staging', 'partial-write.tmp'), 'must-not-be-published');
  const env = { ...process.env, MONEYMONEY_DATA_DIR: dataRoot };
  const backup = spawnSync(process.execPath, ['scripts/state-backup.cjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(backup.status, 0, backup.stderr || backup.stdout);
  const summaryMatch = backup.stdout.match(/^State backup verified: (.+)$/m);
  assert.ok(summaryMatch, backup.stdout);
  const summary = JSON.parse(summaryMatch[1]);
  assert.equal(summary.status, 'verified');
  assert.equal(summary.databaseBytes['moneymoney.sqlite'], fs.statSync(path.join(dataRoot, 'backups', summary.snapshot, 'moneymoney.sqlite')).size);
  assert.equal(summary.databaseBytes['research.db'], fs.statSync(path.join(dataRoot, 'backups', summary.snapshot, 'research.db')).size);
  assert.ok(summary.snapshotBytes > summary.databaseBytes['moneymoney.sqlite']);
  assert.equal(summary.lakeFileCount, 2);
  assert.equal(backup.stdout.includes(dataRoot), false, 'worker output must not expose an absolute data path');
  const backupPath = path.join(dataRoot, 'backups', summary.snapshot);
  const manifest = JSON.parse(fs.readFileSync(path.join(backupPath, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files['lake/stocks/large-bars.parquet'], crypto.createHash('sha256').update(largeLakeFile).digest('hex'));
  for (const name of ['moneymoney.sqlite', 'research.db', 'telegram-state.json', 'lake/stocks/bars.parquet', 'manifest.json']) {
    assert.ok(fs.existsSync(path.join(backupPath, name)), `missing backup ${name}`);
  }
  assert.equal(fs.existsSync(path.join(backupPath, 'lake', '.staging')), false, 'uncommitted Parquet staging data must not enter a backup');
  const beforeLive = fs.readFileSync(path.join(dataRoot, 'moneymoney.sqlite'));
  const verify = spawnSync(process.execPath, ['scripts/state-backup.cjs', 'verify', backupPath], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  assert.match(verify.stdout, /Isolated recovery drill passed/);
  assert.deepEqual(fs.readFileSync(path.join(dataRoot, 'moneymoney.sqlite')), beforeLive, 'verification must not modify live SQLite data');
});

test('backup retention prunes only verified timestamped backups below the configured data root', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-backup-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, 'runtime-data');
  fs.mkdirSync(dataRoot, { recursive: true });
  const db = new Database(path.join(dataRoot, 'moneymoney.sqlite'));
  db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY); INSERT INTO sample DEFAULT VALUES;');
  db.close();
  const env = { ...process.env, MONEYMONEY_DATA_DIR: dataRoot, MONEYMONEY_BACKUP_RETENTION: '2' };
  for (let index = 0; index < 3; index += 1) {
    const backup = spawnSync(process.execPath, ['scripts/state-backup.cjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
    assert.equal(backup.status, 0, backup.stderr || backup.stdout);
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  const backupRoot = path.join(dataRoot, 'backups');
  const names = fs.readdirSync(backupRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
  assert.equal(names.length, 2, 'retention counts only verified backup snapshots');
  for (const name of names) assert.ok(fs.existsSync(path.join(backupRoot, name, 'manifest.json')));
  assert.ok(names.every(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(name)));
});

test('backup observes SQLite WAL sidecars without checkpointing or deleting the live sidecars', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-backup-wal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, 'runtime-data');
  fs.mkdirSync(dataRoot, { recursive: true });
  const sourcePath = path.join(dataRoot, 'moneymoney.sqlite');
  const db = new Database(sourcePath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY); INSERT INTO sample DEFAULT VALUES;');
  const walPath = `${sourcePath}-wal`;
  assert.ok(fs.existsSync(walPath), 'fixture must keep an active WAL while its connection stays open');
  const before = fs.statSync(walPath).size;
  const result = spawnSync(process.execPath, ['scripts/state-backup.cjs'], {
    cwd: process.cwd(), env: { ...process.env, MONEYMONEY_DATA_DIR: dataRoot }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(walPath), 'backup must not remove the live WAL sidecar');
  assert.equal(fs.statSync(walPath).size, before, 'backup inspection must not checkpoint or rewrite the live WAL');
  const backupName = fs.readdirSync(path.join(dataRoot, 'backups'))[0];
  const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, 'backups', backupName, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sourceSqliteSidecars['moneymoney.sqlite'].wal.present, true);
  assert.equal(manifest.sourceSqliteSidecars['moneymoney.sqlite'].wal.bytes, before);
  db.close();
});
