const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { validatePublicBaseUrl, containsInstrumentIdentity } = require('../scripts/production-readonly-canary.cjs');

test('production canary accepts only public HTTPS targets', () => {
  assert.equal(validatePublicBaseUrl('https://54.211.146.2/'), 'https://54.211.146.2');
  assert.equal(validatePublicBaseUrl('https://example.org/app/'), 'https://example.org/app');
  for (const url of ['http://example.org', 'http://127.0.0.1', 'https://localhost', 'https://192.168.1.4', 'https://10.0.0.1', 'https://[::1]', 'https://[fc00::1]', 'https://[fe80::1]']) {
    assert.throws(() => validatePublicBaseUrl(url), /public|HTTPS/i, url);
  }
});

test('production canary is read-only and exercises four markets, selected instruments and recovery layout', () => {
  const script = fs.readFileSync('scripts/production-readonly-canary.cjs', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/production-canary.yml', 'utf8');
  assert.match(script, /\['stocks', 'options', 'crypto', 'prediction'\]/);
  assert.match(script, /SNDK/);
  assert.match(script, /toggleRightLibrary/);
  assert.match(script, /production-canary-failure\.png/);
  assert.match(script, /production-canary-trace\.zip/);
  assert.match(script, /await loadPredictionRadar\(true\)/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /PUBLIC_WEB_BASE_URL/);
  assert.doesNotMatch(script, /POST \/api\/paper\/orders|\/api\/paper\/orders/);
});

test('selected crypto identity matches chart labels with market separators but not ordinary words', () => {
  assert.equal(containsInstrumentIdentity('BTC/USDT · 15M', 'BTCUSDT'), true);
  assert.equal(containsInstrumentIdentity('SPY · 1D', 'SPY'), true);
  assert.equal(containsInstrumentIdentity('whether the source is unavailable', 'ETH'), false);
});
