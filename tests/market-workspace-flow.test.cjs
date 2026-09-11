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

test('自选页提供表格和卡片视图，并从当前标的进入对应市场', () => {
  assert.match(html, /id="workspace-watchlist-panel"/);
  assert.match(html, /data-watchlist-view="table"/);
  assert.match(html, /data-watchlist-view="cards"/);
  assert.match(html, /workspace-watchlist-groups/);
  assert.match(html, /openWatchlistInstrument/);
  assert.match(html, /setMarketScope\(scope, \{ openTab: false \}\)/);
});

test('自选库支持分组、列配置和移出操作', () => {
  assert.match(html, /data-watchlist-group="watchlist"/);
  assert.match(html, /data-watchlist-group="paper"/);
  assert.match(html, /mm-watchlist-columns/);
  assert.match(html, /removeWorkspaceWatchlistInstrument/);
  assert.match(html, /watchlistGroup/);
});

test('回测结果可按当前市场保存候选并跳转提醒', () => {
  assert.match(html, /mm-backtest-candidates-v1/);
  assert.match(html, /lastBacktestResult\.scope !== activeMarketScope/);
  assert.match(html, /saveBacktestCandidate/);
  assert.match(html, /openCandidateMonitor/);
});
