const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { buildWorkspaceSearchIndex, searchWorkspaceIndex } = require('../src/features/workspace-search');

const docs = [
  { id: 'p1', type: 'project', market: 'stocks', title: 'AAPL 动量研究', text: '测试 12 个月动量与盈利修正', updatedAt: '2026-10-27T00:00:00Z', projectId: 'p1', ownerAdmin: true },
  { id: 'w1', type: 'workspace', market: 'crypto', title: 'BTC 回放工作区', text: '固定快照与回放度量', updatedAt: '2026-10-26T00:00:00Z', ownerAdmin: true },
  { id: 'e1', type: 'evidence', market: 'stocks', title: 'AAPL 行情快照', text: '收盘价与成交量为已保存证据', updatedAt: '2026-10-20T00:00:00Z', ownerAdmin: true },
];

test('search requires every term and scores titles higher', () => {
  const index = buildWorkspaceSearchIndex(docs);
  const result = searchWorkspaceIndex(index, 'aapl 动量', () => true, { now: Date.parse('2026-10-28T00:00:00Z') });
  assert.equal(result.total, 1);
  assert.equal(result.hits[0].id, 'p1');
  assert.match(result.hits[0].snippet, /动量/);
  assert.match(result.indexDigest, /^[a-f0-9]{64}$/);
});

test('permission filter runs before scoring and hides denied documents', () => {
  const index = buildWorkspaceSearchIndex(docs);
  const result = searchWorkspaceIndex(index, '回放', doc => doc.id !== 'w1', {});
  assert.equal(result.total, 0);
  const allowed = searchWorkspaceIndex(index, '回放', () => true, {});
  assert.equal(allowed.hits[0].id, 'w1');
});

test('market, type, date filters and limit truncation', () => {
  const index = buildWorkspaceSearchIndex(docs);
  const stocks = searchWorkspaceIndex(index, 'aapl', () => true, { market: 'stocks' });
  assert.equal(stocks.total, 2);
  const projects = searchWorkspaceIndex(index, 'aapl', () => true, { types: ['project'] });
  assert.equal(projects.total, 1);
  const recent = searchWorkspaceIndex(index, 'aapl', () => true, { from: '2026-10-25T00:00:00Z' });
  assert.equal(recent.total, 1);
  const limited = searchWorkspaceIndex(index, 'aapl', () => true, { limit: 1 });
  assert.equal(limited.hits.length, 1);
  assert.equal(limited.truncated, true);
});

test('index rejects duplicates and malformed rows', () => {
  assert.throws(() => buildWorkspaceSearchIndex([...docs, docs[0]]), /重复/);
  assert.throws(() => buildWorkspaceSearchIndex([{ ...docs[0], type: 'bogus' }]), /类型/);
  assert.throws(() => buildWorkspaceSearchIndex([{ ...docs[0], ownerAdmin: false }]), /管理员/);
});
