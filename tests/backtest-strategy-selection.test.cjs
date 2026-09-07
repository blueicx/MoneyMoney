const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('src/web/public/index.html', 'utf8');
const server = fs.readFileSync('src/web/server.ts', 'utf8');
const backtest = fs.readFileSync('src/features/kelly-backtest.ts', 'utf8');

assert.match(html, /id="bt-strategy"/);
assert.match(html, /id="bt-market-id"/);
assert.match(html, /均值回归/);
assert.match(html, /compareBacktests/);
assert.match(html, /id="backtest-compare"/);
assert.match(html, /strategy=\$\{encodeURIComponent\(strategy\)\}/);
assert.match(server, /req\.query\.strategy/);
assert.match(server, /req\.query\.marketId/);
assert.match(server, /marketId/);
assert.match(server, /runMeanReversionBacktest/);
assert.match(backtest, /runMeanReversionBacktest/);
assert.match(backtest, /marketId\?/);
assert.match(backtest, /'Mean Reversion'/);

console.log('Backtest strategy selection: all assertions passed');
