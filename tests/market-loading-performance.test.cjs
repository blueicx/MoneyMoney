const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('Market loading performance is wired to scoped server caches', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/web/server.ts'), 'utf8');
  assert.match(server, /globalCache\.fetch\(`scope:\$\{scope\}:screener:rows`/);
  assert.match(server, /globalCache\.fetch\(`scope:\$\{scope\}:market-ticker`/);
  assert.match(server, /createCacheEtag/);
  assert.match(server, /if-none-match/);
});
