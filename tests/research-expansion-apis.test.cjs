const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const serverSource = fs.readFileSync('src/web/server.ts', 'utf8');
const factorSource = fs.readFileSync('src/features/factor-lab.ts', 'utf8');
const candidateSource = fs.readFileSync('src/features/strategy-candidates.ts', 'utf8');
const repositorySource = fs.readFileSync('src/features/research-repository.ts', 'utf8');

test('research expansion routes expose factor and candidate workflows', () => {
  for (const route of [
    "app.get('/api/research/factors/catalog'",
    "app.post('/api/research/factors/analyze'",
    "app.get('/api/research/candidates'",
    "app.post('/api/research/candidates'",
    "app.post('/api/research/candidates/:id/evaluate'",
    "app.post('/api/research/candidates/:id/approve'",
  ]) assert.ok(serverSource.includes(route), `missing ${route}`);
});

test('factor catalog remains market-specific and reports explainable metadata', () => {
  assert.match(factorSource, /getFactorCatalog/);
  assert.match(factorSource, /stocks/);
  assert.match(factorSource, /options/);
  assert.match(factorSource, /crypto/);
  assert.match(factorSource, /prediction/);
  assert.match(factorSource, /description/);
  assert.match(factorSource, /source/);
});

test('candidate registry exposes persisted market-scoped listing', () => {
  assert.match(candidateSource, /list\(/);
  assert.match(candidateSource, /market/);
  assert.match(repositorySource, /getAllCandidates\(/);
});

test('alert outbox exposes durable retry semantics', () => {
  assert.ok(serverSource.includes("app.post('/api/alerts/deliveries/:id/retry'"));
  assert.match(repositorySource, /retryAlertDelivery\(/);
  assert.match(repositorySource, /attempts/);
});

