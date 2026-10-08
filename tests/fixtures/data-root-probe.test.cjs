const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('isolated runner gives each test file a temporary MoneyMoney data root', () => {
  const root = process.env.MONEYMONEY_DATA_DIR;
  assert.ok(root, 'MONEYMONEY_DATA_DIR should be set');
  assert.notEqual(root, process.env.MONEYMONEY_TEST_UNSAFE_SENTINEL);
  const relative = path.relative(os.tmpdir(), root);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'data root must be inside OS temp');
  fs.writeFileSync(path.join(root, 'probe.txt'), 'isolated');
  console.log(`PROBE_DATA_ROOT=${root}`);
});
