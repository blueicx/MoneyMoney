const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('dashboard exposes bounded local page, workspace and chart render performance samples', () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  assert.match(source, /window\.MoneyMoneyPerformance\s*=\s*\{/);
  assert.match(source, /navigationTiming/);
  assert.match(source, /recordMmPerformance\('chart'/);
  assert.match(source, /recordMmPerformance\('workspace'/);
  assert.match(source, /maxSamples/);
});
