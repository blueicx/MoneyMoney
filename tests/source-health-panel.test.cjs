const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');

test('source health panel exposes capability and freshness details', () => {
  assert.match(html, /<th[^>]*>能力<\/th>/);
  assert.match(html, /item\.capabilities/);
  assert.match(html, /item\.status/);
  assert.match(html, /实时|延迟|缓存/);
});
