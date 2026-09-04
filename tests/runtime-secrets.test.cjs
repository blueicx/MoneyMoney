const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  RuntimeSecretsStore,
  getRuntimeTelegramConfig,
  getRuntimeAiKey,
} = require('../dist/config/runtime-secrets');

test('runtime secrets store keeps secret values out of public status', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-secrets-')), 'secrets.json');
  const store = new RuntimeSecretsStore(file);
  store.update({
    openrouterApiKey: '  openrouter-secret  ',
    telegramBotToken: ' bot-token ',
    telegramChatId: ' 123 ',
  });

  assert.equal(store.get('openrouterApiKey'), 'openrouter-secret');
  assert.equal(store.get('telegramBotToken'), 'bot-token');
  assert.equal(store.status().openrouterConfigured, true);
  assert.equal(store.status().telegramConfigured, true);
  assert.equal(JSON.stringify(store.status()).includes('openrouter-secret'), false);
  assert.equal(JSON.stringify(store.status()).includes('bot-token'), false);
});

test('runtime secret values override environment values and blank update preserves them', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-secrets-')), 'secrets.json');
  const store = new RuntimeSecretsStore(file);
  const env = {
    OPENROUTER_API_KEY: 'env-openrouter',
    TELEGRAM_BOT_TOKEN: 'env-token',
    TELEGRAM_CHAT_ID: 'env-chat',
  };

  assert.equal(getRuntimeAiKey('openrouter', store, env), 'env-openrouter');
  assert.deepEqual(getRuntimeTelegramConfig(store, env), {
    botToken: 'env-token',
    chatId: 'env-chat',
    allowedChatIds: '',
    adminChatIds: '',
    proxyUrl: '',
    pollingEnabled: false,
  });

  store.update({ openrouterApiKey: 'saved-openrouter', telegramBotToken: 'saved-token' });
  store.update({ openrouterApiKey: '' });
  assert.equal(getRuntimeAiKey('openrouter', store, env), 'env-openrouter');
  assert.equal(getRuntimeTelegramConfig(store, env).botToken, 'saved-token');
});
