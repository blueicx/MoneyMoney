const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  TelegramInteractionBot,
  parseAllowedChatIds,
  parseTelegramCommand,
  splitTelegramMessage,
} = require('../dist/features/telegram-bot');

test('parses allowed chat IDs from common separators and falls back safely', () => {
  assert.deepEqual([...parseAllowedChatIds('123, -456\n789')], ['123', '-456', '789']);
  assert.deepEqual([...parseAllowedChatIds('', 'fallback')], ['fallback']);
  assert.deepEqual([...parseAllowedChatIds(' ,  \n', 'fallback')], ['fallback']);
});

test('parses bot commands with optional username and arguments', () => {
  assert.deepEqual(parseTelegramCommand('/risk@Money_bluebot now'), {
    command: 'risk',
    args: ['now'],
  });
  assert.deepEqual(parseTelegramCommand('/paper'), { command: 'paper', args: [] });
  assert.equal(parseTelegramCommand('hello'), null);
});

test('splits messages at Telegram safe length', () => {
  const parts = splitTelegramMessage('x'.repeat(9000));
  assert.equal(parts.length, 3);
  assert.ok(parts.every((part) => part.length <= 4096));
  assert.equal(parts.join(''), 'x'.repeat(9000));
});

test('ignores unauthorized chats without sending a reply', async () => {
  const sent = [];
  const bot = new TelegramInteractionBot({
    allowedChatIds: ['allowed'],
    stateFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-bot-')), 'state.json'),
    transport: {
      async getUpdates() { return []; },
      async sendMessage(chatId, text) { sent.push({ chatId, text }); },
    },
    handlers: { help: async () => 'help' },
  });

  const result = await bot.handleUpdate({
    update_id: 10,
    message: { chat: { id: 'blocked', type: 'private' }, text: '/help' },
  });

  assert.equal(result.handled, false);
  assert.equal(result.reason, 'unauthorized_chat');
  assert.deepEqual(sent, []);
});

test('replies to an authorized command, persists offset, and deduplicates updates', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-bot-'));
  const sent = [];
  const bot = new TelegramInteractionBot({
    allowedChatIds: ['allowed'],
    stateFile: path.join(tempDir, 'state.json'),
    transport: {
      async getUpdates() { return []; },
      async sendMessage(chatId, text) { sent.push({ chatId, text }); },
    },
    handlers: { help: async ({ args }) => `help:${args.join('|')}` },
  });
  const update = {
    update_id: 11,
    message: { chat: { id: 'allowed', type: 'private' }, text: '/help now' },
  };

  const first = await bot.handleUpdate(update);
  const duplicate = await bot.handleUpdate(update);

  assert.equal(first.handled, true);
  assert.equal(duplicate.handled, false);
  assert.equal(duplicate.reason, 'duplicate_update');
  assert.deepEqual(sent, [{ chatId: 'allowed', text: 'help:now' }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tempDir, 'state.json'), 'utf8')), { nextOffset: 12 });
});

test('confirms an authorized callback and sends an inline keyboard response', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-bot-'));
  const sent = [];
  const answered = [];
  const bot = new TelegramInteractionBot({
    allowedChatIds: ['allowed'],
    stateFile: path.join(tempDir, 'state.json'),
    transport: {
      async getUpdates() { return []; },
      async sendMessage(chatId, text, replyMarkup) { sent.push({ chatId, text, replyMarkup }); },
      async answerCallbackQuery(callbackQueryId, text) { answered.push({ callbackQueryId, text }); },
    },
    handlers: {},
    callbackHandlers: {
      'view:risk': async () => ({
        text: 'risk',
        replyMarkup: { inline_keyboard: [[{ text: '返回', callback_data: 'menu:home' }]] },
      }),
    },
  });

  const result = await bot.handleUpdate({
    update_id: 12,
    callback_query: {
      id: 'callback-1',
      data: 'view:risk',
      message: { chat: { id: 'allowed', type: 'private' } },
    },
  });

  assert.equal(result.handled, true);
  assert.deepEqual(answered, [{ callbackQueryId: 'callback-1', text: undefined }]);
  assert.equal(sent[0].replyMarkup.inline_keyboard.at(-1)[0].callback_data, 'menu:home');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tempDir, 'state.json'), 'utf8')), { nextOffset: 13 });
});

test('ignores unauthorized callbacks and answers unknown callbacks safely', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-bot-'));
  const sent = [];
  const answered = [];
  const bot = new TelegramInteractionBot({
    allowedChatIds: ['allowed'],
    stateFile: path.join(tempDir, 'state.json'),
    transport: {
      async getUpdates() { return []; },
      async sendMessage(chatId, text, replyMarkup) { sent.push({ chatId, text, replyMarkup }); },
      async answerCallbackQuery(callbackQueryId, text) { answered.push({ callbackQueryId, text }); },
    },
    handlers: {},
    callbackHandlers: {},
    unknownCallbackHandler: async () => ({ text: '按钮已过期' }),
  });

  const unauthorized = await bot.handleUpdate({
    update_id: 20,
    callback_query: {
      id: 'callback-blocked',
      data: 'view:risk',
      message: { chat: { id: 'blocked', type: 'private' } },
    },
  });
  const unknown = await bot.handleUpdate({
    update_id: 21,
    callback_query: {
      id: 'callback-unknown',
      data: 'unknown:action',
      message: { chat: { id: 'allowed', type: 'private' } },
    },
  });

  assert.equal(unauthorized.reason, 'unauthorized_chat');
  assert.equal(unknown.handled, true);
  assert.deepEqual(answered, [{ callbackQueryId: 'callback-unknown', text: '无法识别的按钮' }]);
  assert.deepEqual(sent, [{ chatId: 'allowed', text: '按钮已过期', replyMarkup: undefined }]);
});
