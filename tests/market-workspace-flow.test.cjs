const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  defaultWorkspace,
  resolveWorkspaceNavigation,
} = require('../dist/features/market-workspace.js');
const html = fs.readFileSync('src/web/public/index.html', 'utf8');
const server = fs.readFileSync('src/web/server.ts', 'utf8');

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

test('工作区上下文写入 URL，并保留旧请求失效令牌', () => {
  assert.match(html, /params\.set\('workspace', workspaceContext\.workspace\)/);
  assert.match(html, /params\.set\('instrument', workspaceContext\.instrument\)/);
  assert.match(html, /AbortController/);
  assert.match(html, /marketScopeRequestEpoch/);
  assert.match(server, /isWorkspaceAllowed/);
});
