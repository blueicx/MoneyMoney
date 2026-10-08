const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const testsRoot = path.join(repoRoot, 'tests');
const requestedFiles = process.argv.slice(2);
const testFiles = (requestedFiles.length
  ? requestedFiles.map(file => path.resolve(repoRoot, file))
  : fs.readdirSync(testsRoot).filter(file => file.endsWith('.test.cjs')).map(file => path.join(testsRoot, file))
).sort();

if (!testFiles.length) throw new Error('No test files found');
for (const file of testFiles) {
  const relative = path.relative(testsRoot, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !file.endsWith('.test.cjs')) {
    throw new Error(`Refusing to run a non-test path: ${file}`);
  }
}

let exitCode = 0;
for (const file of testFiles) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-test-data-'));
  console.log(`\n=== isolated test file: ${path.relative(repoRoot, file)} ===`);
  try {
    const childEnv = { ...process.env, MONEYMONEY_DATA_DIR: dataRoot };
    // Node sets this marker inside node:test workers; carrying it to a nested
    // runner makes Node skip executing the requested test files.
    delete childEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', file], {
      cwd: repoRoot,
      env: childEnv,
      stdio: 'inherit',
    });
    if (result.error) {
      console.error(result.error);
      exitCode = 1;
    } else if (result.status !== 0) {
      exitCode = result.status ?? 1;
    }
  } finally {
    // This path is the exact fresh directory returned by mkdtempSync above.
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

process.exitCode = exitCode;
