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
  assert.match(html, /id="stock-watchlist-open"/);
  assert.match(html, /id="stock-watchlist-add"/);
  assert.match(html, /id="stock-search-input"/);
  assert.match(html, /function loadStockWatchlistShortcuts\(/);
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

console.log('Stock symbol selector tests loaded');
