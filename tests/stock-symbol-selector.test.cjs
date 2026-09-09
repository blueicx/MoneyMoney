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
  assert.match(html, /function loadStockWatchlistShortcuts\(/);
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
