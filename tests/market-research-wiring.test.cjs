const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('src/web/server.ts', 'utf8');
const page = fs.readFileSync('src/web/public/index.html', 'utf8');

test('market research API is wired to scoped data and persistent templates', () => {
  assert.match(server, /app\.get\('\/api\/screener'/);
  assert.match(server, /stockDataService\.quote/);
  assert.match(server, /getEquityOptionsSnapshot/);
  assert.match(server, /binanceFeed\.getMultiplePrices/);
  assert.match(server, /getPredictionRadar/);
  assert.match(server, /withScreenerTimeout/);
  assert.match(server, /stateStore\.get.*screener-templates/s);
  assert.doesNotMatch(server, /let screenerTemplates: any\[\] = \[\]/);
});

test('compare API uses requested instrument ids and UI has a market-scoped entry', () => {
  assert.match(server, /app\.get\('\/api\/instruments\/compare'/);
  assert.match(server, /unifiedInstrumentService\.overview/);
  assert.match(server, /app\.post\('\/api\/instruments\/compare\/snapshots'/);
  assert.match(page, /id="market-screener"/);
  assert.match(page, /id="market-compare"/);
  assert.match(page, /function loadMarketResearch\(page = 1\)/);
  const filterStart = page.indexOf('async function loadMarketScreenerFilter');
  assert.ok(filterStart >= 0);
  const filterCode = page.slice(filterStart, page.indexOf('function loadMarketScreenerPage', filterStart));
  assert.match(filterCode, /signal: controller\.signal/);
  assert.match(filterCode, /isCurrentMarketScopeToken\(token\)/);
  assert.match(page, /marketResearchController\?\.abort\(\)/);
  assert.match(page, /isCurrentMarketScopeToken\(token\)/);
});
