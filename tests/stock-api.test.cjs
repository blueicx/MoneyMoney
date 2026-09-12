const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('src/web/server.ts', 'utf8');
const sourceHealth = fs.readFileSync('src/features/source-health.ts', 'utf8');
const analyst = fs.readFileSync('src/features/analyst-consensus.ts', 'utf8');
const fundamentals = fs.readFileSync('src/features/fundamental-quality.ts', 'utf8');

test('server exposes unified stock endpoints while keeping legacy endpoints', () => {
  assert.match(server, /app\.get\('\/api\/stocks\/:symbol\/overview'/);
  assert.match(server, /app\.get\('\/api\/stocks\/:symbol\/filings'/);
  assert.match(server, /app\.get\('\/api\/stocks\/:symbol\/fundamentals'/);
  assert.match(server, /app\.get\('\/api\/stocks\/:symbol\/source-health'/);
  assert.match(server, /app\.get\('\/api\/stock\/fundamentals\/:symbol'/);
});

test('source health exposes stock source groups without prediction-only items', () => {
  assert.match(sourceHealth, /nasdaq-public-quote/);
  assert.match(sourceHealth, /sec-edgar/);
  assert.match(sourceHealth, /requestedMarketScope|scope/);
});

const html = fs.readFileSync('src/web/public/index.html', 'utf8');
test('stock UI requests unified stock data and renders source freshness', () => {
  assert.match(html, /\/api\/stocks\//);
  assert.match(html, /数据来源|来源状态/);
  assert.match(html, /nasdaq-public|sec-edgar/);
  assert.match(html, /activeMarketScope.*stocks|data-market-scopes="stocks/);
});

test('stock source status treats live and fallback data as usable', () => {
  assert.match(sourceHealth, /snapshot\.status === 'live'[\s\S]*snapshot\.status === 'fallback'/);
  assert.match(html, /source\.status === 'live'[\s\S]*source\.status === 'fallback'/);
});

test('common US ticker searches have a local fast path before remote sources', () => {
  assert.match(server, /function fastStockSearch\(/);
  assert.match(server, /const fastResults = fastStockSearch\(q\)/);
  assert.match(server, /if \(fastResults\.length\) \{[\s\S]*res\.json\(\{ success: true, data: fastResults \}\)/);
});

test('分析师和基本面 API 返回可扩展的研究字段', () => {
  assert.match(server, /app\.get\('\/api\/stock\/analyst\/:symbol'/);
  assert.match(server, /app\.get\('\/api\/stock\/fundamentals\/:symbol'/);
  assert.match(analyst, /sourceExcerpt/);
  assert.match(analyst, /summaryZh/);
  assert.match(analyst, /sourceUrl/);
  assert.match(analyst, /history/);
  assert.match(fundamentals, /supportingFactors/);
  assert.match(fundamentals, /riskFactors/);
  assert.match(fundamentals, /missingFields/);
});
