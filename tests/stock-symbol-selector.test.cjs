const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('src/web/public/index.html', 'utf8');

test('stock market exposes all Magnificent Seven shortcuts', () => {
  for (const symbol of ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']) {
    assert.match(html, new RegExp(`data-stock-symbol=["']${symbol}["']`));
  }
});

test('stock selector places watchlist and search beside shortcuts', () => {
  assert.match(html, /id="stock-symbol-quick"/);
  assert.match(html, /id="stock-watchlist-quick"/);
  assert.match(html, /id="stock-search-input"/);
  assert.match(html, /onclick="addCurrentStockToWatchlist\(\)"/);
  assert.match(html, /function loadStockWatchlistShortcuts\(/);
  assert.doesNotMatch(html, /class="stock-selector-actions"/);
  assert.doesNotMatch(html, /id="stock-watchlist-open"/);
  assert.doesNotMatch(html, /id="stock-watchlist-add"/);
});

test('stock radar sections each expose watchlist, add and search controls', () => {
  for (const key of ['insider', 'institutional', 'analyst', 'fundamentals', 'short-interest']) {
    assert.match(html, new RegExp(`data-stock-radar-toolbar=["']${key}["']`));
    assert.match(html, new RegExp(`id=["']stock-radar-search-${key}["']`));
    assert.match(html, new RegExp(`id=["']stock-radar-search-results-${key}["']`));
    assert.match(html, new RegExp(`searchStockFromRadar\\('stock-radar-search-${key}','${key}'\\)`));
  }
  assert.match(html, /function searchStockFromRadar\(/);
  assert.match(html, /function selectStockRadarResult\(/);
  assert.match(html, /setMarketScope\('watchlist'\)/);
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

test('stock shortcut, watchlist and search share the quote selection action', () => {
  assert.match(html, /function selectStockSymbol\(/);
  assert.match(html, /function selectStockSymbol\(symbol, name, apiSymbol, options = \{\}\)/);
  assert.match(html, /function selectStockSymbol\([\s\S]*?loadStockKline/);
  assert.match(html, /function selectStockSymbol\([\s\S]*?loadUnifiedStockData/);
});

test('stock quote request includes the Magnificent Seven', () => {
  assert.match(html, /usAAPL,usMSFT,usNVDA,usAMZN,usGOOGL,usMETA,usTSLA/);
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
  assert.match(html, /function selectStockLibraryItem\([\s\S]*?selectStockSymbol/);
  assert.match(html, /function applySidebarScope\(/);
  assert.match(html, /activeMarketScope === 'watchlist'[\s\S]*?showTab\('positions'/);
});

console.log('Stock symbol selector tests loaded');
