const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('src/web/server.ts', 'utf8');

assert.match(server, /^\s*backtest:\s*\(/m);
assert.match(server, /runMomentumBacktest/);
assert.match(server, /runMeanReversionBacktest/);
assert.match(server, /marketId/);
assert.match(server, /策略回测/);

console.log('Telegram backtest command: all assertions passed');
