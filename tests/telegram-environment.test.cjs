const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../dist/config/runtime-secrets');

test('saved polling setting cannot activate production Telegram in development or tests', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-environment-'));
  try {
    const store = new runtime.RuntimeSecretsStore(path.join(dir, 'secrets.json'));
    store.update({ telegramPollingEnabled: true, telegramBotToken: 'test-token' });
    for (const NODE_ENV of [undefined, 'development', 'test']) {
      assert.equal(runtime.getRuntimeTelegramConfig(store, { NODE_ENV }).pollingEnabled, false);
    }
    assert.equal(runtime.getRuntimeTelegramConfig(store, { NODE_ENV: 'production', TELEGRAM_NETWORK_ENABLED: 'true' }).pollingEnabled, true);
    assert.equal(runtime.getRuntimeTelegramConfig(store, { NODE_ENV: 'production', TELEGRAM_NETWORK_ENABLED: 'false' }).pollingEnabled, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real Telegram transport refuses all traffic outside production before fetch', async () => {
  const { TelegramApiTransport } = require('../dist/features/telegram-bot');
  assert.equal(typeof TelegramApiTransport, 'function');
  const env = process.env.NODE_ENV;
  const fetch = global.fetch;
  let requests = 0;
  process.env.NODE_ENV = 'test';
  global.fetch = async () => { requests++; throw new Error('network should not be used'); };
  try {
    const transport = new TelegramApiTransport('test-token');
    await assert.rejects(transport.getUpdates(0, 1), /environment/i);
    await assert.rejects(transport.sendMessage('123', 'test'), /environment/i);
    assert.equal(requests, 0);
  } finally {
    global.fetch = fetch;
    if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
  }
});
