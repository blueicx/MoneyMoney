const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');

const server = fs.readFileSync('src/web/server.ts', 'utf8');
const search = fs.readFileSync('src/web/telegram-search.ts', 'utf8');

test('quick command table groups the existing Telegram commands', () => {
  assert.match(server, /快捷指令表/);
  for (const command of ['/status', '/positions', '/export', '/ask', '/chart', '/audit', '/whoami', '/web']) {
    assert.match(server, new RegExp(command.slice(1) + '\\s'));
  }
});

test('combined market search exposes a watchlist action for stock results', () => {
  assert.match(server, /buildTelegramStockSearchRows/);
  assert.match(search, /callback_data: `watch:add:\$\{scope\}:\$\{encodeURIComponent\(item\.code\)\}`/);
  assert.match(search, /callback_data: `stock:view:\$\{item\.code\}`/);
  assert.match(server, /isTelegramWatchableStockId/);
});

test('stock search rows contain both watchlist and quote actions', () => {
  const { buildTelegramStockSearchRows, isTelegramWatchableStockId } = require('../dist/web/telegram-search');
  assert.equal(isTelegramWatchableStockId('usAAPL'), true);
  assert.equal(isTelegramWatchableStockId('not-a-stock'), false);
  assert.deepEqual(buildTelegramStockSearchRows([{ code: 'usAAPL', name: 'Apple Inc.' }]), [[
    { text: '加入自选 Apple In', callback_data: 'watch:add:stocks:usAAPL' },
    { text: 'Apple In 行情', callback_data: 'stock:view:usAAPL' },
  ]]);
});

test('unified search fallbacks contain detail buttons', () => {
  assert.match(server, /telegramScopedCallback\('unified:show', scope, `prediction:predictfun:\$\{item\.id\}`, chatId\)/);
  assert.match(server, /telegramScopedCallback\('unified:show', scope === 'watchlist' \? 'watchlist' : 'stocks', 'stock:us:' \+ ticker, chatId\)/);
  assert.match(server, /const ticker = String\(tList\[i\]\.exchangeSymbol \|\| tList\[i\]\.code\)/);
});

test('context callbacks are signed, chat-bound, and one-time', () => {
  assert.match(server, /crypto\.createHmac\('sha256', config\.jwtSecret\)/);
  assert.match(server, /crypto\.timingSafeEqual/);
  assert.match(server, /TELEGRAM_CALLBACK_STATE_KEY/);
  assert.match(server, /activeRecords\.filter\(item => item\.token !== token\)/);
  assert.match(server, /parseScopedTelegramCallback\(data, 'watch:add', ctx\.chatId\)/);
  assert.match(server, /parseTelegramContextCallback\(data, 'quick:select', ctx\.chatId\)/);
});
