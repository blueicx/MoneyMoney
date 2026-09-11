const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('src/web/public/index.html', 'utf8');
const server = fs.readFileSync('src/web/server.ts', 'utf8');

test('market result controls use the active theme', () => {
  assert.match(html, /\.market-research-row\s*\{/);
  assert.match(html, /\.backtest-loading-skeleton\s*\{/);
  assert.match(html, /\.backtest-error-state\s*\{/);
  assert.match(html, /\.backtest-result-card\s*\{/);
  assert.match(html, /background:\s*var\(--bg-card\)/);
  assert.doesNotMatch(html, /class="backtest-panel theme-scoped-backtest-panel" style="display:none"/);
});

test('backtest route dispatches by scope and does not silently reuse prediction data', () => {
  assert.match(server, /req\.query\.scope/);
  assert.match(server, /runStockBacktest/);
  assert.match(server, /runCryptoBacktest/);
  assert.match(server, /期权历史数据暂不可用/);
  assert.match(server, /availability:\s*'unavailable'/);
  assert.match(html, /backtestInput\.value\s*=\s*''/);
});
