const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('src/web/public/index.html', 'utf8');
const server = fs.readFileSync('src/web/server.ts', 'utf8');

test('macro workspace declares independent market sections', () => {
  assert.match(html, /data-collapse-key="stocks-macro" data-market-scopes="stocks crypto options overview"/);
  assert.match(html, /id="global-crypto-metrics" data-market-scopes="crypto overview"/);
  assert.match(html, /id="stablecoin-liquidity"/);
  assert.match(html, /data-market-scopes="crypto overview"><div[^>]*>😱 恐贪指数/);
  assert.match(html, /data-market-scopes="stocks overview"><div[^>]*>🏛️ CME 机构持仓雷达/);
});

test('generic function navigation preserves the selected market', () => {
  assert.match(html, /function marketScopeForTab\(\) \{ return null; \}/);
  assert.match(html, /function scopedUrl\(path\)/);
  assert.match(html, /if \(!isCurrentMarketScopeToken\(scopeToken\)\) return;/);
});

test('server exposes scoped advisor and paper contracts while keeping legacy URLs', () => {
  assert.match(server, /filterAssistantReport\(report, scope\)/);
  assert.match(server, /filterUnifiedPaperLedger\(ledger, scope\)/);
  assert.match(server, /app\.get\('\/api\/paper\/performance', \(req, res\)/);
  assert.match(server, /app\.get\('\/api\/events\/calendar', async \(req, res\)/);
});

console.log('Market scope integration tests loaded');
