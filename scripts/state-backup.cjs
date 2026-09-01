const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dataRoot = path.join(root, 'data');
const backupRoot = path.join(dataRoot, 'backups');
const database = path.join(dataRoot, 'moneymoney.sqlite');

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function copyFile(source, target) { fs.copyFileSync(source, target); }

function backup() {
  if (!fs.existsSync(database)) throw new Error('data/moneymoney.sqlite 不存在，请先启动一次服务');
  const target = path.join(backupRoot, stamp());
  fs.mkdirSync(target, { recursive: true });
  copyFile(database, path.join(target, 'moneymoney.sqlite'));
  for (const name of fs.readdirSync(dataRoot)) {
    if (name.endsWith('.json')) copyFile(path.join(dataRoot, name), path.join(target, name));
  }
  console.log(`State backup created: ${target}`);
}

function restore(input) {
  const sourceRoot = path.resolve(input || '');
  const relative = path.relative(backupRoot, sourceRoot);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('restore 只允许使用 data/backups 下的备份目录');
  const source = path.join(sourceRoot, 'moneymoney.sqlite');
  if (!fs.existsSync(source)) throw new Error('备份目录中缺少 moneymoney.sqlite');
  const target = `${database}.restore.tmp`;
  copyFile(source, target);
  fs.renameSync(target, database);
  console.log(`State restored from: ${sourceRoot}`);
}

try {
  if (process.argv[2] === 'restore') restore(process.argv[3]);
  else backup();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
