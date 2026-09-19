const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routerSource = fs.readFileSync(path.join(__dirname, '../src/features/research-jobs-router.ts'), 'utf8');

test('research jobs router uses heartbeat and lock lease mechanism', () => {
  assert.match(routerSource, /owner/);
  assert.match(routerSource, /leaseTimeMs/);
  assert.match(routerSource, /expiresAt/);
  assert.match(routerSource, /setInterval/);
  assert.match(routerSource, /clearInterval/);
});

test('research jobs router parses JSON inputSummary', () => {
  assert.match(routerSource, /JSON\.parse.*inputSummary/);
  assert.match(routerSource, /timeframe/);
  assert.match(routerSource, /strategy/);
});

test('research jobs router does not generate pseudo signals', () => {
  assert.doesNotMatch(routerSource, /const diff = prices/);
  assert.doesNotMatch(routerSource, /signals\.push/);
});
