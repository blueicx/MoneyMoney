const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  defaultWorkspace,
  isWorkspaceAllowed,
  resolveWorkspaceNavigation,
} = require('../dist/features/market-workspace.js');
const html = fs.readFileSync('src/web/public/index.html', 'utf8');
const server = fs.readFileSync('src/web/server.ts', 'utf8');

test('默认工作区稳定且属于当前市场菜单', () => {
  for (const scope of ['overview', 'stocks', 'options', 'crypto', 'prediction', 'watchlist']) {
    const workspace = defaultWorkspace(scope);
    const items = resolveWorkspaceNavigation(scope).flatMap(group => group.items);
    if (workspace === 'watchlist') {
      assert.equal(isWorkspaceAllowed(scope, workspace), true, `${scope} default workspace should remain accessible`);
    } else {
      assert.ok(items.some(item => item.id === workspace), `${scope} default workspace should be visible`);
    }
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

test('筛选结果提供同市场详情、候选和回测动作', () => {
  assert.match(html, /openScreenerDetail\(\$\{index\}\)/);
  assert.match(html, /saveScreenerCandidate\(\$\{index\}\)/);
  assert.match(html, /runScreenerBacktest\(\$\{index\}\)/);
  assert.match(html, /screenerInstrumentRef/);
  assert.match(html, /setWorkspaceInstrument\(instrument\.symbol\)/);
});

test('事件时间线区分无事件和事件数据源不可用', () => {
  assert.match(html, /payload\.sourceStatus/);
  assert.match(html, /数据源暂未接入或暂时不可用/);
});

test('具体工作区只显示当前正文模块，并在总览时恢复市场模块', () => {
  assert.match(html, /data-workspace-id="insider"/);
  assert.match(html, /data-workspace-id="institutional"/);
  assert.match(html, /data-workspace-id="order-flow"/);
  assert.match(html, /data-workspace-ids="option-chain volatility greeks radar"/);
  assert.match(html, /data-workspace-ids="prediction-radar radar"/);
  assert.match(html, /function workspaceAllowsView\(/);
  assert.match(html, /function applyWorkspaceView\(/);
  assert.match(html, /node\?\.dataset\?\.workspaceId/);
  assert.match(html, /if \(!visible && node\.tagName === 'DETAILS'\) node\.open = false/);
  assert.match(html, /applyWorkspaceView\(\);/);
});

test('独立功能面板在选中后扁平展示并保持展开', () => {
  assert.match(html, /\.dash-collapse\.workspace-panel-flat[\s\S]*border:\s*0/);
  assert.match(html, /\.dash-collapse\.workspace-panel-flat[^}]*background:\s*transparent/);
  assert.match(html, /\.dash-collapse\.workspace-panel-flat > summary[^}]*display:\s*none/);
  assert.match(html, /\.workspace-panel-flat > summary[^}]*pointer-events:\s*none/);
  assert.match(html, /workspace-panel-flat[^}]*collapse-chevron[^}]*display:\s*none/);
  assert.match(html, /\.workspace-signal-header[^}]*align-items:\s*center\s*!important/);
  assert.ok((html.match(/workspace-signal-badge/g) || []).length >= 7, 'workspace signal badges should remain available in the card header');
  assert.ok((html.match(/workspaceInlineRefresh\(/g) || []).length >= 8, 'workspace refresh controls should be rendered inside each data card');
  assert.match(html, /workspace-inline-refresh[\s\S]*workspace-signal-badge/);
  assert.match(html, /classList\.toggle\(['"]workspace-panel-flat['"],\s*flatPanel\)/);
  assert.match(html, /if \(flatPanel\) node\.open = true/);
  assert.match(html, /!section\.classList\.contains\(['"]workspace-panel-flat['"]\)/);
  assert.match(html, /section\.classList\.contains\(['"]workspace-panel-flat['"]\) && !section\.open/);
  for (const id of ['breadth', 'insider', 'institutional', 'analyst', 'fundamentals', 'short-interest', 'funding-rate', 'open-interest', 'on-chain', 'order-flow']) {
    assert.match(html, new RegExp(`data-workspace-id="${id}"`));
  }
  assert.match(html, /data-workspace-ids="option-chain volatility greeks radar"/);
  assert.match(html, /data-workspace-ids="prediction-radar radar"/);
});

test('股票选择入口集中在右侧标的库并保持当前功能工作区', () => {
  assert.match(html, /id="stock-library-quick"/);
  assert.match(html, /id="stock-library-search-input"/);
  assert.match(html, /id="stock-library-search-results"/);
  assert.match(html, /selectStockFromInstrumentLibrary/);
  assert.match(html, /activeWorkspaceId === 'insider'/);
  assert.match(html, /activeWorkspaceId === 'institutional'/);
  assert.doesNotMatch(html, /id="stock-search-input"/);
  assert.doesNotMatch(html, /data-stock-radar-toolbar=/);
});

test('右侧标的选择按当前股票工作区刷新对应数据', () => {
  assert.match(html, /function selectStockFromInstrumentLibrary\(/);
  for (const key of ['insider', 'institutional', 'analyst', 'fundamentals', 'short-interest']) {
    assert.match(html, new RegExp(`activeWorkspaceId === '${key}'`));
  }
  assert.match(html, /loadUnifiedStockData\(normalized\)/);
  assert.match(html, /setWorkspaceInstrument\(normalized\)/);
  assert.match(html, /stock-library-search-results/);
});

test('分析师工作区展示具体分析师动态、目标区间和历史趋势', () => {
  assert.match(html, /analyst-actions/);
  assert.match(html, /analyst-price-target-range/);
  assert.match(html, /analyst-history-trend/);
  assert.match(html, /sourceExcerpt/);
  assert.match(html, /summaryZh/);
  assert.match(html, /sourceUrl/);
});

test('基本面工作区展示历史趋势、支持因素和风险因素', () => {
  assert.match(html, /fundamental-history-trend/);
  assert.match(html, /fundamental-supporting-factors/);
  assert.match(html, /fundamental-risk-factors/);
  assert.match(html, /supportingFactors/);
  assert.match(html, /riskFactors/);
  assert.match(html, /missingFields/);
});

test('左侧不再提供重复的标的搜索，保留顶部全局搜索', () => {
  assert.doesNotMatch(html, /search: \['⌕', '搜索标的'\]/);
  assert.match(html, /WORKSPACE_BASE_GROUPS[\s\S]*\['backtest', 'risk'\]/);
  assert.match(html, /id="global-search-input"/);
});

test('主题切换只保留顶部入口，移除内容区右上角重复按钮', () => {
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /id="theme-toggle"[\s\S]*?onclick="refresh\(\)"/);
  assert.doesNotMatch(html, /id="theme-toggle-btn"/);
  assert.doesNotMatch(html, /getElementById\('theme-toggle-btn'\)/);
});

test('行情与事件成为左侧工作区，中心不再提供重复的虚拟币选择器和价格卡片', () => {
  assert.match(html, /stock-quotes/);
  assert.match(html, /crypto-quotes/);
  assert.match(html, /data-workspace-id="events"/);
  assert.doesNotMatch(html, /<input[^>]*id="bn-search"/);
  assert.doesNotMatch(html, /<select[^>]*id="bn-symbol"/);
  assert.doesNotMatch(html, /<div id="binance-prices"/);
});

test('总体页不加载虚拟币专属指标，且股票筛选不再属于总体页', () => {
  assert.doesNotMatch(html, /id="global-crypto-metrics"[^>]*data-market-scopes="crypto overview"/);
  assert.doesNotMatch(html, /id="market-research-tools"[^>]*data-market-scopes="overview"/);
  assert.doesNotMatch(html, /else if \(scope === 'overview'\)[\s\S]*?\/api\/binance\/price\/BTCUSDT/);
  assert.match(html, /market-screener-results/);
  assert.match(html, /binance-prices/);
});
