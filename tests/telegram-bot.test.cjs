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

test('routes a bottom keyboard label as a menu action and preserves the keyboard', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-bot-'));
  const sent = [];
  const menu = { keyboard: [[{ text: '📊 风险中心' }]], is_persistent: true, resize_keyboard: true };
  const bot = new TelegramInteractionBot({
    allowedChatIds: ['allowed'],
    stateFile: path.join(tempDir, 'state.json'),
    transport: {
      async getUpdates() { return []; },
      async sendMessage(chatId, text, replyMarkup) { sent.push({ chatId, text, replyMarkup }); },
    },
    handlers: {},
    textHandlers: {
      '📊 风险中心': async () => ({ text: 'risk', replyMarkup: menu }),
    },
  });

  const result = await bot.handleUpdate({
    update_id: 30,
    message: { chat: { id: 'allowed', type: 'private' }, text: '📊 风险中心' },
  });

  assert.equal(result.handled, true);
  assert.deepEqual(sent, [{ chatId: 'allowed', text: 'risk', replyMarkup: menu }]);
});

test('does not poll when another instance owns the SQLite lease', async () => {
  let pollCalls = 0;
  const leaseCalls = [];
  const bot = new TelegramInteractionBot({
    allowedChatIds: ['allowed'],
    stateFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-lease-')), 'state.json'),
    pollLease: {
      acquireLease(key, owner) { leaseCalls.push(['acquire', key, owner]); return false; },
      refreshLease() { return false; },
      releaseLease() { leaseCalls.push(['release']); return true; },
    },
    transport: {
      async getUpdates() { pollCalls += 1; return []; },
      async sendMessage() {},
    },
    handlers: { help: async () => 'help' },
  });

  assert.equal(await bot.pollOnce(), 0);
  assert.equal(pollCalls, 0);
  assert.equal(bot.pollingStatus.leaseHeld, false);
  assert.match(bot.pollingStatus.lastError, /lease unavailable/i);
  assert.equal(leaseCalls[0][0], 'acquire');
});

test('backs off after Telegram getUpdates conflict and records a recoverable status', async () => {
  let pollCalls = 0;
  const errors = [];
  const bot = new TelegramInteractionBot({
    allowedChatIds: ['allowed'],
    stateFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-conflict-')), 'state.json'),
    pollLease: {
      acquireLease() { return true; },
      refreshLease() { return true; },
      releaseLease() { return true; },
    },
    pollConflictBackoffMs: 1,
    pollLeaseWaitMs: 1,
    transport: {
      async getUpdates() {
        pollCalls += 1;
        if (pollCalls === 1) throw new Error('Conflict: terminated by other getUpdates request');
        return [];
      },
      async sendMessage() {},
    },
    handlers: { help: async () => 'help' },
    logger: { error(message) { errors.push(message); } },
  });

  bot.start();
  await new Promise(resolve => setTimeout(resolve, 12));
  bot.stop();
  assert.ok(pollCalls >= 2);
  assert.ok(errors.some(message => /polling conflict/i.test(message)));
  assert.equal(bot.pollingStatus.lastError, null);
  assert.ok(bot.pollingStatus.conflictCount >= 1);
});
