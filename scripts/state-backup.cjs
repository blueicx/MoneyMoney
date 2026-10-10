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

async function backup() {
  const primaryDb = path.join(dataRoot, 'moneymoney.sqlite');
  if (!fs.existsSync(primaryDb)) throw new Error('data/moneymoney.sqlite 不存在，请先启动一次服务');
  fs.mkdirSync(backupRoot, { recursive: true });
  const target = path.join(backupRoot, stamp());
  fs.mkdirSync(target, { recursive: false });
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
      JSON.parse(contents);
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
  const manifest = { format: 2, createdAt: new Date().toISOString(), files: Object.fromEntries(files.map(name => [name, sha256(path.join(target, name))])), databases, sourceSqliteSidecars };
  fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  verifyBackupForRetention(target);
  pruneVerifiedBackups(retentionCount());
  process.stdout.write(`State backup created: ${target}\n`);
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
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = path.resolve(sourceRoot, name);
    const relative = path.relative(sourceRoot, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`备份文件缺失或路径无效: ${name}`);
    if (sha256(file) !== expected) throw new Error(`备份文件 Hash 不匹配: ${name}`);
    if (name.toLowerCase().endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
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
    const result = { status: 'passed', startedAt, completedAt: new Date().toISOString(), backup: path.basename(sourceRoot), databases: Object.keys(manifest.databases), verifiedFiles: Object.keys(manifest.files).length, lakeFiles: Object.keys(manifest.files).filter(name => name.startsWith('lake/')).length, isolated: true };
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
