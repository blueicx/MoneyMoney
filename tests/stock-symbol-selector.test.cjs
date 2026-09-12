const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('src/web/public/index.html', 'utf8');
const serviceWorker = fs.readFileSync('src/web/public/sw.js', 'utf8');

test('stock market exposes all Magnificent Seven shortcuts', () => {
  for (const symbol of ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']) {
    assert.match(html, new RegExp(`\\['${symbol}',`));
  }
  assert.match(html, /const STOCK_QUICK_SYMBOLS = Object\.freeze\(\[/);
});

test('stock instrument selection is concentrated in the right library', () => {
  assert.match(html, /id="stock-instrument-library"/);
  assert.match(html, /id="stock-library-quick"/);
  assert.match(html, /id="stock-library-search-input"/);
  assert.match(html, /id="stock-library-search-results"/);
  assert.match(html, /function renderStockLibraryQuick\(/);
  assert.match(html, /function loadStockLibrarySearch\(/);
  assert.match(html, /function selectStockFromInstrumentLibrary\(/);
  assert.doesNotMatch(html, /id="stock-symbol-quick"/);
  assert.doesNotMatch(html, /id="stock-watchlist-quick"/);
  assert.doesNotMatch(html, /id="stock-search-input"/);
  assert.doesNotMatch(html, /class="stock-selector-actions"/);
});

test('stock market does not render popular stock cards in the center', () => {
  assert.doesNotMatch(html, /\.stock-quote-card/);
  assert.doesNotMatch(html, /function loadPopularStocks\(/);
  assert.doesNotMatch(html, /loadPopularStocks\(signal\)/);
});

test('all market instrument libraries stay at the top while the center scrolls', () => {
  assert.match(html, /#right-instrument-library\s*\{[^}]*position:\s*sticky;[^}]*top:\s*61px;[^}]*align-self:\s*start;/s);
  assert.match(html, /#right-instrument-library\s*\{[^}]*height:\s*calc\(100vh - 61px\);[^}]*overflow:\s*hidden;/s);
  assert.match(html, /#right-instrument-library \.sidebar-content\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  for (const scope of ['stocks', 'options', 'crypto', 'prediction']) {
    assert.match(html, new RegExp(`data-market-library="${scope}"`));
  }
});

test('layout changes invalidate the cached service worker shell', () => {
  assert.match(serviceWorker, /const CACHE_NAME = "moneymoney-v55"/);
  assert.match(html, /serviceWorker\.register\('\/sw\.js\?v=39'\)/);
});

test('stock exclusive workspaces keep the shared market bar and scope selection tools', () => {
  assert.match(html, /id="market-overview"[^>]*data-market-scopes="overview stocks options crypto prediction watchlist"/);
  assert.match(html, /id="workspace-dashboard-cards"[^>]*data-workspace-ids="overview"/);
  assert.match(html, /id="market-research-tools"[^>]*data-market-scopes="stocks"[^>]*data-workspace-ids="stock-quotes"/);
  assert.match(html, /const visible = \(!node\.dataset\.marketScopes \|\| scopeAllowsView\(node\.dataset\.marketScopes\)\) && workspaceAllowsView\(node\);/);
  assert.match(html, /if \(node\.classList\?\.contains\(['"]workspace-item['"]\)\) return true;/);
  assert.match(html, /function workspaceAllowsView\(node\) \{[\s\S]*?const ids = workspaceIdsForNode\(node\);[\s\S]*?ids\.length === 0 \|\| ids\.includes\(activeWorkspaceId\);/);
  assert.match(html, /function applyWorkspaceView\(\)[\s\S]*querySelectorAll\('\[data-workspace-id\], \[data-workspace-ids\]'\)/);
});

test('stock feature panels keep only their feature content', () => {
  for (const key of ['insider', 'institutional', 'analyst', 'fundamentals', 'short-interest']) {
    assert.doesNotMatch(html, new RegExp(`data-stock-radar-toolbar=["']${key}["']`));
    assert.doesNotMatch(html, new RegExp(`id=["']stock-radar-search-${key}["']`));
    assert.doesNotMatch(html, new RegExp(`id=["']stock-radar-search-results-${key}["']`));
  }
  assert.match(html, /function selectStockFromInstrumentLibrary\([\s\S]*?loadInsiderRadar/);
  assert.match(html, /function selectStockFromInstrumentLibrary\([\s\S]*?loadInstitutionalOwnership/);
  assert.match(html, /function selectStockFromInstrumentLibrary\([\s\S]*?loadAnalystConsensus/);
  assert.match(html, /function selectStockFromInstrumentLibrary\([\s\S]*?loadFundamentalQuality/);
  assert.match(html, /function selectStockFromInstrumentLibrary\([\s\S]*?loadShortInterest/);
});

test('stock workspace hides redundant helper and source-status lines', () => {
  assert.doesNotMatch(html, /分区展示，点击标题可展开/);
  assert.doesNotMatch(html, /id="stocks-tab"[\s\S]*?class="collapse-toolbar"/);
  assert.doesNotMatch(html, /id="stock-data-freshness"/);
});

test('market breadth sits between quotes and insider radar', () => {
  const quotes = html.indexOf('data-collapse-key="stocks-market"');
  const breadth = html.indexOf('data-collapse-key="stocks-breadth"');
  const insider = html.indexOf('data-collapse-key="stocks-insider"');
  assert.ok(quotes >= 0 && breadth >= 0 && insider >= 0);
  assert.ok(quotes < breadth && breadth < insider);
});

test('fundamental radar exposes the backend error instead of masking every failure', () => {
  assert.match(html, /payload\.error/);
  assert.match(html, /数据源暂时不可用/);
});

test('stock library shortcuts and search share the scoped selection action', () => {
  assert.match(html, /function selectStockSymbol\(/);
  assert.match(html, /function selectStockSymbol\(symbol, name, apiSymbol, options = \{\}\)/);
  assert.match(html, /function selectStockSymbol\([\s\S]*?loadStockKline/);
  assert.match(html, /function selectStockSymbol\([\s\S]*?loadUnifiedStockData/);
  assert.match(html, /function selectStockFromInstrumentLibrary\([\s\S]*?setWorkspaceInstrument/);
  assert.match(html, /function selectStockFromInstrumentLibrary\([\s\S]*?activeWorkspaceId === 'insider'/);
});

test('stock library keeps the Magnificent Seven without a center quote request', () => {
  assert.match(html, /const STOCK_QUICK_SYMBOLS = Object\.freeze\(\[/);
  assert.match(html, /\['AAPL', 'Apple'\][\s\S]*\['TSLA', 'Tesla'\]/);
  assert.doesNotMatch(html, /stock\/quotes\?symbols=usAAPL,usMSFT,usNVDA,usAMZN,usGOOGL,usMETA,usTSLA/);
});

test('watchlist page exposes the actual stock favorites above holdings', () => {
  const watchlistLibrary = html.indexOf('id="watchlist-stock-library"');
  const holdings = html.indexOf('id="positions-list"');
  assert.ok(watchlistLibrary >= 0);
  assert.ok(holdings >= 0);
  assert.ok(watchlistLibrary < holdings);
  assert.match(html, /function loadStockWatchlistLibrary\(/);
  assert.match(html, /data-stock-library-item/);
});

test('stock market replaces the event sidebar with a scoped stock library', () => {
  assert.match(html, /id="stock-instrument-library"/);
  assert.match(html, /data-stock-library-scope="stocks"/);
  assert.match(html, /我的自选/);
  assert.match(html, /模拟持仓/);
  assert.match(html, /真实持仓（暂未接入）/);
  assert.match(html, /function loadStockInstrumentLibrary\(/);
  assert.match(html, /function selectStockLibraryItem\(/);
  assert.match(html, /\/api\/paper\/positions\?scope=stocks/);
  assert.match(html, /function selectStockLibraryItem\([\s\S]*?selectStockFromInstrumentLibrary/);
  assert.match(html, /function applySidebarScope\(/);
  assert.match(html, /activeMarketScope === 'watchlist'[\s\S]*?showTab\('positions'/);
});

console.log('Stock symbol selector tests loaded');
