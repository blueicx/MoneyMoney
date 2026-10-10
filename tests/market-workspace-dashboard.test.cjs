const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveMarketDashboardCards, collectDashboardResults } = require('../dist/features/market-workspace-dashboard.js');
const fs = require('node:fs');
const path = require('node:path');

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
      assert.ok(['live', 'delayed', 'cached', 'partial', 'empty', 'unavailable', 'unsupported', 'failed', 'historical'].includes(card.status));
      assert.ok(Array.isArray(card.fields));
      assert.equal(typeof card.workspace, 'string');
      assert.ok(Array.isArray(card.metrics));
      assert.ok(Array.isArray(card.evidenceRefs));
    }
  }
});

test('看板卡片保留各自真实结果、原因、时间和证据', () => {
  const cards = resolveMarketDashboardCards('stocks', {
    'stock-indices': {
      status: 'live', source: 'Tencent Finance', updatedAt: '2026-09-30T01:00:00.000Z',
      metrics: [{ label: '标普500', value: '6,700', changePct: 0.4 }],
      evidenceRefs: ['https://example.com/indices'],
    },
    'stock-events': { status: 'empty', source: 'SEC EDGAR', reason: '来源成功，但该周期无事件', updatedAt: '2026-09-30T01:00:00.000Z' },
  });
  const indices = cards.find(card => card.id === 'stock-indices');
  const events = cards.find(card => card.id === 'stock-events');
  assert.equal(indices.status, 'live');
  assert.equal(indices.updatedAt, '2026-09-30T01:00:00.000Z');
  assert.equal(indices.metrics[0].value, '6,700');
  assert.deepEqual(indices.evidenceRefs, ['https://example.com/indices']);
  assert.equal(indices.workspace, 'stock-quotes');
  assert.equal(events.status, 'empty');
  assert.equal(events.reason, '来源成功，但该周期无事件');
});

test('访客不读取私人自选卡片，单卡来源失败不污染其他卡片', async () => {
  const results = await collectDashboardResults({
    'stock-indices': async () => ({ status: 'live', source: 'Tencent Finance', metrics: [{ label: '指数', value: '真实值' }] }),
    'stock-events': async () => { throw new Error('SEC timeout'); },
  });
  const cards = resolveMarketDashboardCards('stocks', results, { guest: true });
  assert.equal(cards.find(card => card.id === 'stock-indices').status, 'live');
  assert.equal(cards.find(card => card.id === 'stock-events').status, 'failed');
  assert.match(cards.find(card => card.id === 'stock-events').reason, /SEC timeout/);
  const privateCard = cards.find(card => card.private);
  assert.equal(privateCard.status, 'unavailable');
  assert.deepEqual(privateCard.metrics, []);
  assert.match(privateCard.reason, /访客/);
});

test('看板页面显示数据明细并将卡片点击跳到对应工作区', () => {
  const html = require('./helpers/dashboard-source.cjs').readDashboardSource();
  assert.match(html, /workspace-dashboard-status-label/);
  assert.match(html, /workspace-dashboard-card-metrics/);
  assert.match(html, /function openDashboardWorkspace\(/);
  assert.match(html, /data-dashboard-workspace/);
});
