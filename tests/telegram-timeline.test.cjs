const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('Telegram timeline command exists and calls unifiedInstrumentService.timeline', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');

  assert.match(server, /timeline:\s*async\s*\(\{\s*args,\s*chatId\s*\}\)/);
  assert.match(server, /const id = String\(args\[0\] \|\| ''\)/);
  assert.match(server, /const \[type, venue, \.\.\.symbolParts\] = id\.split\(':'\)/);
  assert.match(server, /unifiedInstrumentService\.timeline/);
  // Invalid path check
  assert.match(server, /'用法：\/timeline <InstrumentRef>\\n支持 stock:us:AAPL、option:cboe:SPY、crypto:binance:BTCUSDT、prediction:predictfun:<marketId>'/);
  // Empty data check
  assert.match(server, /时间线数据暂不可用/);
  // Empty items check
  assert.match(server, /来源状态：\$\{escapeTelegramHtml\(JSON.stringify\(data.sourceStatus\)\)\}/);
  assert.match(server, /Object.values\(data.sectionReasons \|\| \{\}\)/);
  assert.match(server, /该标的不属于当前市场，请先 \/market 切换市场/);
  // Valid path check
  assert.match(server, /const time = \(String\(item\.at \|\| ''\)\)\.slice\(0, 10\)/);
  assert.match(server, /const source = String\(item\.source \|\| item\.kind \|\| ''\)/);
  assert.match(server, /\\n\$\{lines\.join\('\\n'\)\}/);

  // Check help text
  assert.match(server, /\/timeline\s+查看统一标的时间线/);
});
