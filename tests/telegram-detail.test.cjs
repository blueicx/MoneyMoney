const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('Telegram detail command exists and calls unifiedInstrumentService.overview', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');

  assert.match(server, /detail:\s*async\s*\(\{\s*args\s*\}\)/);
  assert.match(server, /const id = String\(args\[0\] \|\| ''\)/);
  assert.match(server, /const \[type, venue, \.\.\.symbolParts\] = id\.split\(':'\)/);
  assert.match(server, /unifiedInstrumentService\.overview/);
  assert.match(server, /'用法：\/detail <InstrumentRef>\\n支持 stock:us:AAPL、option:cboe:SPY、crypto:binance:BTCUSDT、prediction:predictfun:<marketId>'/);
  assert.match(server, /标的详情暂不可用/);
  assert.match(server, /<b>标的详情<\/b>\\n\$\{escapeTelegramHtml\(detailInfo\.instrument\.title\)\}\\n\$\{escapeTelegramHtml\(detailInfo\.instrument\.id\)\}\\n价格\/概率：\$\{escapeTelegramHtml\(String\(\(q as any\)\.price \?\? \(q as any\)\.yesPrice \?\? '暂无'\)\)\}\\nAI：\$\{escapeTelegramHtml\(detailInfo\.analysis\.text\.slice\(0, 500\)\)\}/);
});
