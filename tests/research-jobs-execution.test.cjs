const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routerSource = fs.readFileSync(path.join(__dirname, '../src/features/research-jobs-router.ts'), 'utf8');

test('research jobs do not use UNKNOWN or fixed arrays', () => {
  assert.doesNotMatch(routerSource, /req\.body\.instrument\s*\|\|\s*'UNKNOWN'/);
  assert.doesNotMatch(routerSource, /signals\s*=\s*\[\s*\{\s*timeIndex:\s*0,\s*direction:\s*'buy'/);
});

test('research jobs return clear reason for missing instrument or data', () => {
  assert.match(routerSource, /reason:.*(unavailable|missing|insufficient|not found|invalid)/i);
  assert.match(routerSource, /updateJobStatus.*'failed'/i);
});

test('research jobs validate the requested instrument against its market context', () => {
  assert.match(routerSource, /assertMarketContext\(\{[\s\S]*instrument:\s*reqInstrument/);
  assert.match(routerSource, /Instrument does not belong to the requested market|Market mismatch/);
});

test('server exposes capabilities endpoint', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../src/web/server.ts'), 'utf8');
  // OR the router might contain it
  const combined = serverSource + routerSource;
  assert.match(combined, /\/capabilities/);
  assert.match(combined, /req\.query\.market/);
  assert.match(serverSource, /MARKET_IDS|Invalid market context/);
  assert.match(serverSource, /status\(400\).*market/i);
  assert.match(serverSource, /scopedSourceIds|marketSourceIds|sourceIdsByMarket/);
});

test('research jobs router has stable APIs', () => {
  assert.match(routerSource, /\/jobs\/:id/);
  assert.match(routerSource, /\/jobs\/:id\/events/);
  assert.match(routerSource, /\/:id\/cancel/);
  assert.match(routerSource, /\/:id\/resume/);
  assert.match(routerSource, /\/artifacts\/:id/);
  assert.match(routerSource, /researchRepository\.saveArtifact\(/);
});
