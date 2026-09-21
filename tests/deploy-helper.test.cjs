const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-vps-dist.sh'), 'utf8');

test('atomic VPS deploy helper validates and installs an optional runtime package before cutover', () => {
  assert.match(script, /runtime_package="\$\{6:-\}"/);
  assert.match(script, /invalid runtime package spec/);
  assert.match(script, /npm install --prefix \"\$app_root\" --no-save --package-lock=false \"\$runtime_package\"/);
  assert.match(script, /systemctl stop moneymoney\.service/);
});
