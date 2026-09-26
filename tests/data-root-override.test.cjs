const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('DATA_ROOT honors an explicit MONEYMONEY_DATA_DIR for isolated runs', () => {
  const expected = path.resolve('test-runtime-data');
  const script = "process.stdout.write(require('./dist/utils/paths.js').DATA_ROOT)";
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, MONEYMONEY_DATA_DIR: expected },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
});
