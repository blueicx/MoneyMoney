const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('isolated test runner overrides a caller data path and removes its generated root', () => {
  const repo = path.resolve(__dirname, '..');
  const runner = path.join(repo, 'scripts', 'run-isolated-tests.cjs');
  const probe = path.join(__dirname, 'fixtures', 'data-root-probe.test.cjs');
  const unsafeSentinel = path.join(repo, 'data', 'do-not-touch-test-probe');
  const result = spawnSync(process.execPath, [runner, probe, probe], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, MONEYMONEY_DATA_DIR: unsafeSentinel, MONEYMONEY_TEST_UNSAFE_SENTINEL: unsafeSentinel },
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(unsafeSentinel), false, 'runner must not use the caller-provided data path');
  const roots = [...result.stdout.matchAll(/PROBE_DATA_ROOT=(.+)/g)].map(match => match[1].trim());
  assert.equal(roots.length, 2, `each test file should execute once; stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`);
  assert.equal(new Set(roots).size, 2, 'each test file should get a distinct data root');
  for (const root of roots) {
    assert.ok(path.isAbsolute(root));
    assert.equal(fs.existsSync(root), false, 'runner must remove only the temporary data root it created');
  }
});
