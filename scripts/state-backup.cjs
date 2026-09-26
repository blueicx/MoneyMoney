const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..');
const dataRoot = path.resolve(process.env.MONEYMONEY_DATA_DIR || path.join(root, 'data'));
const backupRoot = path.join(dataRoot, 'backups');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function walkFiles(directory, base = directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Backup source must not contain symlinks: ${absolute}`);
    return entry.isDirectory() ? walkFiles(absolute, base) : entry.isFile() ? [path.relative(base, absolute).split(path.sep).join('/')] : [];
  });
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

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

async function backup() {
  const primaryDb = path.join(dataRoot, 'moneymoney.sqlite');
  if (!fs.existsSync(primaryDb)) throw new Error('data/moneymoney.sqlite 不存在，请先启动一次服务');
  fs.mkdirSync(backupRoot, { recursive: true });
  const target = path.join(backupRoot, stamp());
  fs.mkdirSync(target, { recursive: false });
  const databases = {};
  for (const name of ['moneymoney.sqlite', 'research.db']) {
    const source = path.join(dataRoot, name);
    if (!fs.existsSync(source)) continue;
    const output = path.join(target, name);
    const db = new Database(source, { readonly: true, fileMustExist: true });
    try { await db.backup(output); } finally { db.close(); }
    databases[name] = sqliteSummary(output);
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
  const manifest = { format: 2, createdAt: new Date().toISOString(), files: Object.fromEntries(files.map(name => [name, sha256(path.join(target, name))])), databases };
  fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`State backup created: ${target}\n`);
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
