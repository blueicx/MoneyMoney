const test = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultWorkspace,
  resolveWorkspaceNavigation,
} = require('../dist/features/market-workspace.js');

test('默认工作区稳定且属于当前市场菜单', () => {
  for (const scope of ['overview', 'stocks', 'options', 'crypto', 'prediction', 'watchlist']) {
    const workspace = defaultWorkspace(scope);
    const items = resolveWorkspaceNavigation(scope).flatMap(group => group.items);
    assert.ok(items.some(item => item.id === workspace), `${scope} default workspace should be visible`);
  }
});

test('导航返回新对象，调用方不能污染其他市场菜单', () => {
  const stocks = resolveWorkspaceNavigation('stocks');
  const secondStocks = resolveWorkspaceNavigation('stocks');
  stocks[0].items.pop();

  assert.notEqual(stocks[0].items.length, secondStocks[0].items.length);
  assert.ok(resolveWorkspaceNavigation('crypto').flatMap(group => group.items).some(item => item.id === 'funding-rate'));
});
