const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveMarketDashboardCards } = require('../dist/features/market-workspace-dashboard.js');

function cards(scope) {
  return resolveMarketDashboardCards(scope);
}

function fieldIds(scope) {
  return cards(scope).flatMap(card => card.fields);
}

test('股票看板只声明股票市场字段', () => {
  const ids = fieldIds('stocks');
  assert.ok(ids.includes('market-indices'));
  assert.ok(ids.includes('breadth'));
  assert.ok(ids.includes('sectors'));
  assert.equal(ids.includes('funding-rate'), false);
  assert.equal(ids.includes('prediction-probability'), false);
});

test('虚拟币看板声明资金费率和未平仓量，但不声明股票内部人字段', () => {
  const ids = fieldIds('crypto');
  assert.ok(ids.includes('funding-rate'));
  assert.ok(ids.includes('open-interest'));
  assert.equal(ids.includes('insider'), false);
  assert.equal(ids.includes('sec-filings'), false);
});

test('期权和预测市场看板使用各自字段集合', () => {
  assert.ok(fieldIds('options').includes('implied-volatility'));
  assert.ok(fieldIds('options').includes('greeks'));
  assert.ok(fieldIds('prediction').includes('prediction-probability'));
  assert.equal(fieldIds('prediction').includes('funding-rate'), false);
});

test('看板卡片都带有可序列化的数据源状态', () => {
  for (const scope of ['overview', 'stocks', 'options', 'crypto', 'prediction', 'watchlist']) {
    for (const card of cards(scope)) {
      assert.match(card.id, /^[a-z0-9-]+$/);
      assert.equal(typeof card.title, 'string');
      assert.equal(typeof card.source, 'string');
      assert.ok(['live', 'stale', 'degraded', 'unavailable'].includes(card.status));
      assert.ok(Array.isArray(card.fields));
    }
  }
});
