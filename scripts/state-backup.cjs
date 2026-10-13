const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const runtimeRoot = path.resolve(__dirname, '..');
const root = path.basename(runtimeRoot).toLowerCase() === 'dist' ? path.resolve(runtimeRoot, '..') : runtimeRoot;
const dataRoot = path.resolve(process.env.MONEYMONEY_DATA_DIR || path.join(root, 'data'));
const backupRoot = path.join(dataRoot, 'backups');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

function retentionCount() {
  const configured = Number(process.env.MONEYMONEY_BACKUP_RETENTION);
  return Number.isInteger(configured) && configured >= 1 && configured <= 90 ? configured : 7;
}

function walkFiles(directory, base = directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Backup source must not contain symlinks: ${absolute}`);
    return entry.isDirectory() ? walkFiles(absolute, base) : entry.isFile() ? [path.relative(base, absolute).split(path.sep).join('/')] : [];
  });
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest('hex');
  } finally { fs.closeSync(descriptor); }
}

function sqliteSummary(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check').map(row => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new Error(`SQLite integrity check failed: ${file}`);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    const counts = {};
    for (const table of tables) {
      if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error(`Unexpected SQLite table name: ${table}`);
      counts[table] = Number(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count);
    }
    return { integrity: 'ok', tables: counts };
  } finally { db.close(); }
}

function inspectSqliteSidecars(name) {
  const file = path.join(dataRoot, name);
  const inspect = suffix => {
    const sidecar = `${file}${suffix}`;
    try {
      const stat = fs.statSync(sidecar);
      return { present: stat.isFile(), bytes: stat.isFile() ? stat.size : null, observedAt: new Date().toISOString() };
    } catch (error) {
      if (error && error.code === 'ENOENT') return { present: false, bytes: 0, observedAt: new Date().toISOString() };
      throw error;
    }
  };
  return { wal: inspect('-wal'), shm: inspect('-shm') };
}

function validateJson(contents, relativeName) {
  try { JSON.parse(contents); }
  catch { throw new Error(`Invalid JSON: ${relativeName}`); }
}

// A damaged, catalogued options snapshot may be preserved as opaque evidence,
// never interpreted as market data. No other JSON receives this exemption.
function optionsEvidence(sourceRoot, relativeName) {
  const match = /^lake\/options-chain\/\d{4}\/\d{2}\/(option_(?:deribit_(?:BTC|ETH)|cboe_[A-Z0-9.]+))\/(option_snapshot_[a-f0-9]{24})-([a-f0-9]{12})\.json$/i.exec(relativeName);
  if (!match) return null;
  const matches = [];
  for (const databaseName of ['moneymoney.sqlite', 'research.db']) {
    const file = path.join(sourceRoot, databaseName);
    if (!fs.existsSync(file)) continue;
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='options_chain_partitions'").get()) continue;
      const row = db.prepare('SELECT id,market,instrument,source,path,content_hash FROM options_chain_partitions WHERE id=?').get(match[2]);
      if (!row || row.market !== 'options' || !/^[a-f0-9]{64}$/i.test(row.content_hash) || row.content_hash.slice(0,12) !== match[3]) continue;
      const directory = row.instrument.replace(/[^A-Za-z0-9._-]/g,'_');
      if (directory !== match[1] || !['Deribit Public API','CBOE Delayed Quotes'].includes(row.source)
        || (row.instrument.startsWith('option:deribit:') !== (row.source === 'Deribit Public API'))
        || !String(row.path).replace(/\\/g,'/').endsWith('/'+relativeName)) continue;
      matches.push({ snapshotId:row.id, instrument:row.instrument, source:row.source, contentHash:row.content_hash, reason:'invalid-json' });
    } finally { db.close(); }
  }
  return matches.length === 1 ? matches[0] : null;
}

function jsonIsInvalid(file) {
  try { JSON.parse(fs.readFileSync(file,'utf8')); return false; }
  catch (error) { if (error instanceof SyntaxError) return true; throw error; }
}

async function backup() {
  const primaryDb = path.join(dataRoot, 'moneymoney.sqlite');
  if (!fs.existsSync(primaryDb)) throw new Error('data/moneymoney.sqlite 不存在，请先启动一次服务');
  fs.mkdirSync(backupRoot, { recursive: true });
  const target = path.join(backupRoot, stamp());
  fs.mkdirSync(target, { recursive: false });
  let verified = false;
  try {
  const databases = {};
  const sourceSqliteSidecars = {};
  for (const name of ['moneymoney.sqlite', 'research.db']) {
    const source = path.join(dataRoot, name);
    if (!fs.existsSync(source)) continue;
    const output = path.join(target, name);
    const db = new Database(source, { readonly: true, fileMustExist: true });
    try { await db.backup(output); } finally { db.close(); }
    databases[name] = sqliteSummary(output);
    sourceSqliteSidecars[name] = inspectSqliteSidecars(name);
  }
  for (const name of fs.readdirSync(dataRoot)) {
    const source = path.join(dataRoot, name);
    if (name.endsWith('.json') && fs.statSync(source).isFile()) {
      const contents = fs.readFileSync(source, 'utf8');
      validateJson(contents, name);
      fs.writeFileSync(path.join(target, name), contents, 'utf8');
    }
  }
  const lakeSource = path.join(dataRoot, 'lake');
  if (fs.existsSync(lakeSource)) fs.cpSync(lakeSource, path.join(target, 'lake'), {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    filter: source => path.resolve(source) === path.resolve(lakeSource) || path.basename(source) !== '.staging',
  });
  const files = walkFiles(target).filter(name => name !== 'manifest.json').sort();
  const quarantinedFiles = {};
  for (const name of files.filter(name => name.endsWith('.json'))) {
    if (!jsonIsInvalid(path.join(target,name))) continue;
    const evidence = optionsEvidence(target,name);
    if (!evidence) throw new Error(`Invalid JSON: ${name}`);
    quarantinedFiles[name] = { ...evidence, rawHash:sha256(path.join(target,name)) };
  }
  const manifest = { format: 2, createdAt: new Date().toISOString(), files: Object.fromEntries(files.map(name => [name, sha256(path.join(target, name))])), databases, sourceSqliteSidecars, quarantinedFiles };
  fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  verifyBackupForRetention(target);
  verified = true;
  pruneVerifiedBackups(retentionCount());
  const databaseBytes = Object.fromEntries(Object.keys(databases).map(name => [name, fs.statSync(path.join(target, name)).size]));
  const snapshotBytes = files.reduce((sum, name) => sum + fs.statSync(path.join(target, name)).size, 0);
  const summary = {
    format: 1,
    status: 'verified',
    snapshot: path.basename(target),
    databaseBytes,
    snapshotBytes,
    fileCount: files.length,
    lakeFileCount: files.filter(name => name.startsWith('lake/')).length,
    quarantinedFileCount: Object.keys(quarantinedFiles).length,
    dataStatus: Object.keys(quarantinedFiles).length ? 'partial' : 'historical',
  };
  process.stdout.write(`State backup verified: ${JSON.stringify(summary)}\n`);
  } finally {
    // Only this invocation's exact newly created directory is removable.
    // Never delete an older failed backup or the original runtime data.
    if (!verified && path.dirname(target) === path.resolve(backupRoot) && BACKUP_NAME_PATTERN.test(path.basename(target)) && !fs.lstatSync(target).isSymbolicLink()) {
      fs.rmSync(target, { recursive: true, force: false });
    }
  }
}

function verifyBackupForRetention(sourceRoot) {
  const manifestPath = path.join(sourceRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  verifyFiles(sourceRoot, manifest);
  for (const [name, expected] of Object.entries(manifest.databases || {})) {
    if (!['moneymoney.sqlite', 'research.db'].includes(name)) throw new Error(`Unexpected database in backup manifest: ${name}`);
    verifyDatabaseCounts(path.join(sourceRoot, name), expected);
  }
}

function pruneVerifiedBackups(retention) {
  const backupRootResolved = path.resolve(backupRoot);
  const valid = [];
  for (const entry of fs.readdirSync(backupRootResolved, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !BACKUP_NAME_PATTERN.test(entry.name)) continue;
    const directory = path.resolve(backupRootResolved, entry.name);
    const relative = path.relative(backupRootResolved, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.dirname(directory) !== backupRootResolved) continue;
    try {
      verifyBackupForRetention(directory);
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
      valid.push({ directory, createdAt: Date.parse(manifest.createdAt), name: entry.name });
    } catch {
      // An incomplete or corrupt backup is preserved for diagnosis, never pruned as valid retention.
    }
  }
  valid.sort((a, b) => {
    const left = Number.isFinite(a.createdAt) ? a.createdAt : -Infinity;
    const right = Number.isFinite(b.createdAt) ? b.createdAt : -Infinity;
    return right - left || b.name.localeCompare(a.name);
  });
  for (const item of valid.slice(retention)) {
    if (path.dirname(item.directory) !== backupRootResolved || !BACKUP_NAME_PATTERN.test(path.basename(item.directory))) continue;
    fs.rmSync(item.directory, { recursive: true, force: false });
  }
}

function safeBackupPath(input) {
  const sourceRoot = path.resolve(String(input || ''));
  const relative = path.relative(backupRoot, sourceRoot);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('verify/restore 只允许使用 data/backups 下的备份目录');
  return sourceRoot;
}

function verifyFiles(sourceRoot, manifest) {
  if (manifest.format !== 2 || !manifest.files || !manifest.databases) throw new Error('不支持或缺少备份 manifest');
  if (Object.keys(manifest.quarantinedFiles || {}).some(name=>!Object.hasOwn(manifest.files,name))) throw new Error('Invalid quarantine manifest');
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = path.resolve(sourceRoot, name);
    const relative = path.relative(sourceRoot, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`备份文件缺失或路径无效: ${name}`);
    if (sha256(file) !== expected) throw new Error(`备份文件 Hash 不匹配: ${name}`);
    const quarantine = manifest.quarantinedFiles?.[name];
    if (name.toLowerCase().endsWith('.json')) {
      const invalid = jsonIsInvalid(file);
      if (invalid) {
        const evidence = optionsEvidence(sourceRoot,name);
        if (!quarantine || !evidence || quarantine.rawHash !== expected || Object.keys(evidence).some(key=>quarantine[key]!==evidence[key])) throw new Error(`Invalid JSON: ${name}`);
      } else if (quarantine) throw new Error(`Invalid quarantine claim: ${name}`);
    } else if (quarantine) throw new Error('Invalid quarantine file type');
  }
}

function verifyDatabaseCounts(file, expected) {
  const actual = sqliteSummary(file);
  if (JSON.stringify(actual.tables) !== JSON.stringify(expected.tables)) throw new Error(`SQLite 表记录数不匹配: ${path.basename(file)}`);
}

function recordDrill(result) {
  const reportPath = path.join(dataRoot, 'recovery-drill-last.json');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function verify(input) {
  const sourceRoot = safeBackupPath(input);
  const manifestPath = path.join(sourceRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('备份目录中缺少 manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const startedAt = new Date().toISOString();
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-recovery-drill-'));
  try {
    verifyFiles(sourceRoot, manifest);
    fs.cpSync(sourceRoot, isolatedRoot, { recursive: true, dereference: false });
    for (const [name, expected] of Object.entries(manifest.databases)) verifyDatabaseCounts(path.join(isolatedRoot, name), expected);
    const quarantinedFileCount = Object.keys(manifest.quarantinedFiles || {}).length;
    const result = { status: 'passed', startedAt, completedAt: new Date().toISOString(), backup: path.basename(sourceRoot), databases: Object.keys(manifest.databases), verifiedFiles: Object.keys(manifest.files).length, lakeFiles: Object.keys(manifest.files).filter(name => name.startsWith('lake/')).length, isolated: true, quarantinedFileCount, dataStatus:quarantinedFileCount?'partial':'historical' };
    recordDrill(result);
    process.stdout.write(`Isolated recovery drill passed: ${result.databases.length} SQLite DB(s), ${result.verifiedFiles} file(s), live state untouched\n`);
  } catch (error) {
    recordDrill({ status: 'failed', startedAt, completedAt: new Date().toISOString(), backup: path.basename(sourceRoot), reason: error.message, isolated: true });
    throw error;
  } finally { fs.rmSync(isolatedRoot, { recursive: true, force: true }); }
}

function restore(input) {
  const sourceRoot = safeBackupPath(input);
  const source = path.join(sourceRoot, 'moneymoney.sqlite');
  if (!fs.existsSync(source)) throw new Error('备份目录中缺少 moneymoney.sqlite');
  const target = path.join(dataRoot, 'moneymoney.sqlite.restore.tmp');
  fs.copyFileSync(source, target);
  fs.renameSync(target, path.join(dataRoot, 'moneymoney.sqlite'));
  process.stdout.write(`Legacy primary database restore completed from: ${sourceRoot}\n`);
}

(async () => {
  try {
    const action = process.argv[2];
    if (action === 'restore') restore(process.argv[3]);
    else if (action === 'verify') verify(process.argv[3]);
    else await backup();
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  }
})();
