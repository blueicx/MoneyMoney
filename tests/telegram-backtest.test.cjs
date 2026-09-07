const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('Telegram backtest command covers default, aliases, market ID, and read-only output', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');

  assert.match(server, /backtest:\s*\(\{\s*args\s*\}\)/);
  assert.match(server, /const first = String\(args\[0\] \|\| ''\)/);
  assert.match(server, /const aliases: Record<string, 'momentum' \| 'meanReversion'>/);
  assert.match(server, /const firstIsMarketId = \/\^\\d\+\$\/\.test\(first\)/);
  assert.match(server, /const marketId = \/\^\\d\+\$\/\.test\(marketIdInput\)/);
  assert.match(server, /backtester\.runMeanReversionBacktest\(/);
  assert.match(server, /backtester\.runMomentumBacktest\(/);
  assert.match(server, /stats\.totalTrades/);
  assert.match(server, /stats\.totalReturnPct/);
  assert.match(server, /stats\.winRate/);
  assert.match(server, /stats\.maxDrawdownPct/);
  assert.match(server, /stats\.sharpeRatio/);
  assert.match(server, /只读策略回测/);
  assert.match(server, /不会创建交易/);
  assert.match(server, /firstKey === 'compare'/);
  assert.match(server, /策略对比回测/);
  assert.match(server, /\/backtest compare 1234/);
});
