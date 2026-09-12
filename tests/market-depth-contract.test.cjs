const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  marketDepthCapabilities,
  hasMarketDepthCapability,
  unavailableMarketDepthCapability,
} = require('../dist/features/market-depth-capabilities');
const serverSource = fs.readFileSync('src/web/server.ts', 'utf8');

test('market depth capabilities stay isolated by market scope', () => {
  assert.equal(hasMarketDepthCapability('stocks', 'insider'), true);
  assert.equal(hasMarketDepthCapability('stocks', 'funding-rate'), false);
  assert.equal(hasMarketDepthCapability('options', 'greeks'), true);
  assert.equal(hasMarketDepthCapability('options', 'insider'), false);
  assert.equal(hasMarketDepthCapability('crypto', 'funding-rate'), true);
  assert.equal(hasMarketDepthCapability('crypto', 'insider'), false);
  assert.equal(hasMarketDepthCapability('prediction', 'prediction-radar'), true);
  assert.equal(hasMarketDepthCapability('prediction', 'funding-rate'), false);
});

test('market depth exposes an explicit unavailable contract', () => {
  const result = unavailableMarketDepthCapability('options', 'greeks', '期权链数据源尚未配置');
  assert.deepEqual(result, {
    scope: 'options',
    capability: 'greeks',
    status: 'unavailable',
    reason: '期权链数据源尚未配置',
  });
});

test('market depth capability lists are immutable snapshots', () => {
  const first = marketDepthCapabilities('crypto');
  first.push('insider');
  assert.equal(hasMarketDepthCapability('crypto', 'insider'), false);
});

test('market depth capabilities are exposed through the scoped read-only API', () => {
  assert.match(serverSource, /app\.get\('\/api\/market-depth\/capabilities'/);
  assert.match(serverSource, /capabilities: marketDepthCapabilities\(scope\)/);
  assert.match(fs.readFileSync('src/web/auth.ts', 'utf8'), /'\/workspace'/);
});
