const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

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
  fs.writeFileSync(path.join(dataRoot, 'lake', '.staging', 'partial-write.tmp'), 'must-not-be-published');
  const env = { ...process.env, MONEYMONEY_DATA_DIR: dataRoot };
  const backup = spawnSync(process.execPath, ['scripts/state-backup.cjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(backup.status, 0, backup.stderr || backup.stdout);
  const backupPath = backup.stdout.match(/State backup created: (.+)\s*$/m)?.[1];
  assert.ok(backupPath, backup.stdout);
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
