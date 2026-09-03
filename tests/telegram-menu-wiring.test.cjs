const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');

const server = fs.readFileSync('src/web/server.ts', 'utf8');
const bot = fs.readFileSync('src/features/telegram-bot.ts', 'utf8');

test('server registers paginated menu navigation and dynamic menu replies', () => {
  assert.match(server, /⬅ 上一页/);
  assert.match(server, /下一页 ➡/);
  assert.match(server, /moveTelegramMenuPage/);
  assert.match(server, /replyKeyboard:\s*'menu'/);
  assert.doesNotMatch(server, /const TELEGRAM_BOTTOM_MENU\s*:/);
});

test('Telegram transport resolves dynamic menu replies using the destination chat', () => {
  assert.match(bot, /replyKeyboard\?:\s*'menu'/);
  assert.match(bot, /buildTelegramBottomMenu/);
  assert.match(bot, /sendReply\(chatId/);
});
