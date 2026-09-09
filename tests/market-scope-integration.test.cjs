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

test('analysis and risk markup declares market-specific sections', () => {
  assert.match(html, /data-analysis-scopes="prediction"/);
  assert.match(html, /data-analysis-scopes="crypto"/);
  assert.match(html, /data-analysis-scopes="stocks"/);
  assert.match(html, /data-analysis-scopes="options"/);
  assert.match(html, /scopedUrl\('\/api\/risk\/history\?limit=72'\)/);
  assert.match(html, /fetch\(scopedUrl\('\/api\/calibration'\)/);
});

test('ticker loads after scope initialization and uses market-specific data', () => {
  assert.match(html, /activeMarketScope = readInitialMarketScope\(\);[\s\S]*loadNewsTicker\(/);
  assert.match(html, /scopedUrl\('\/api\/market-ticker'\)/);
  assert.match(html, /data-market-scopes="overview stocks options crypto prediction watchlist"/);
  assert.match(server, /app\.get\('\/api\/market-ticker'/);
  assert.match(server, /if \(scope === 'stocks'\)/);
  assert.match(server, /stockDataService\.overview/);
  assert.match(server, /if \(scope === 'options'\)/);
  assert.match(server, /getEquityOptionsSnapshot/);
});

test('macro is a common utility entry rather than the stock market entry', () => {
  assert.match(html, /\['macro', '[^']*宏观'\]/);
  assert.doesNotMatch(html, /CORE_NAV_ITEMS[\s\S]*\['stocks', '[^']*宏观'\]/);
  assert.match(html, /id="macro-tab"/);
});

test('server scopes risk history and risk exports', () => {
  assert.match(server, /filterRiskOverview\(rawOverview, scope\)/);
  assert.match(server, /getRiskHistory\(Number\.isFinite\(limit\) \? limit : 72, scope\)/);
  assert.match(server, /app\.get\('\/api\/export\/journal', \(req, res\)/);
  assert.match(server, /app\.get\('\/api\/export\/calibration', \(req, res\)/);
});

console.log('Market scope integration tests loaded');
