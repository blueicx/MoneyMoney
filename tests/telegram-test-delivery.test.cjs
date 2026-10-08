const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { acknowledgeTelegramTestDelivery, runTelegramTestDelivery } = require('../dist/features/telegram-test-delivery');

function createStore() {
  const values = new Map();
  const leases = new Set();
  return {
    get: key => values.get(key) ?? null,
    set: (key, value) => values.set(key, value),
    acquireLease: key => { if (leases.has(key)) return false; leases.add(key); return true; },
    releaseLease: key => leases.delete(key),
  };
}

const base = (store, overrides = {}) => ({
  store,
  recipientId: 'admin-chat-1',
  adminChatIds: ['admin-chat-1'],
  allowedChatIds: ['admin-chat-1', 'normal-chat-2'],
  botConfigured: true,
  idempotencyKey: 'click-00000001',
  now: '2026-10-03T12:00:00.000Z',
  sendMessage: async () => undefined,
  ...overrides,
});

test('test delivery requires both an explicitly configured admin chat and allowlist membership', async () => {
  const store = createStore();
  let sent = 0;
  const result = await runTelegramTestDelivery(base(store, {
    recipientId: 'normal-chat-2', sendMessage: async () => { sent += 1; },
  }));
  assert.equal(result.status, 'rejected');
  assert.equal(sent, 0);
  assert.match(result.reason, /管理员|allowlist|白名单/);
});

test('unconfigured bot or recipient never attempts a send', async () => {
  let sent = 0;
  const noBot = await runTelegramTestDelivery(base(createStore(), { botConfigured: false, sendMessage: async () => { sent += 1; } }));
  const noRecipient = await runTelegramTestDelivery(base(createStore(), { recipientId: '', sendMessage: async () => { sent += 1; } }));
  assert.equal(noBot.status, 'unavailable');
  assert.equal(noRecipient.status, 'unavailable');
  assert.equal(sent, 0);
});

test('successful and failed attempts persist a redacted outcome without raw chat ID', async () => {
  const store = createStore();
  const sent = await runTelegramTestDelivery(base(store));
  assert.equal(sent.status, 'sent');
  assert.ok(sent.record.chatFingerprint);
  assert.equal(JSON.stringify(sent.record).includes('admin-chat-1'), false);
  const failed = await runTelegramTestDelivery(base(store, {
    recipientId: 'admin-chat-1', idempotencyKey: 'click-00000002', now: '2026-10-03T12:02:00.000Z',
    sendMessage: async () => { throw new Error('request failed for admin-chat-1 using bot123:SECRET_TOKEN'); },
  }));
  assert.equal(failed.status, 'failed');
  assert.equal(JSON.stringify(failed.record).includes('SECRET_TOKEN'), false);
  assert.equal(JSON.stringify(failed.record).includes('admin-chat-1'), false);
});

test('test delivery exposes a record-bound confirmation and only the same private chat may acknowledge it', async () => {
  const store = createStore();
  let sentRecordId = '';
  const delivered = await runTelegramTestDelivery(base(store, {
    sendMessage: async (_chatId, _text, recordId) => { sentRecordId = recordId; },
  }));
  assert.equal(delivered.status, 'sent');
  assert.equal(sentRecordId, delivered.record.id);

  const wrongChat = acknowledgeTelegramTestDelivery(store, sentRecordId, 'other-chat');
  assert.equal(wrongChat.status, 'rejected');
  const acknowledged = acknowledgeTelegramTestDelivery(store, sentRecordId, 'admin-chat-1', '2026-10-03T12:00:05.000Z');
  assert.equal(acknowledged.status, 'acknowledged');
  assert.equal(acknowledged.record.status, 'acknowledged');
  assert.equal(acknowledged.record.acknowledgedAt, '2026-10-03T12:00:05.000Z');
  assert.ok(acknowledged.record.completedAt);
  assert.equal(acknowledgeTelegramTestDelivery(store, sentRecordId, 'admin-chat-1').status, 'duplicate');
});

test('a failed delivery cannot be acknowledged as received', async () => {
  const store = createStore();
  const failed = await runTelegramTestDelivery(base(store, {
    sendMessage: async (_chatId, _text, recordId) => { store.set('failed-record-id', recordId); throw new Error('network down'); },
  }));
  assert.equal(failed.status, 'failed');
  const result = acknowledgeTelegramTestDelivery(store, store.get('failed-record-id'), 'admin-chat-1');
  assert.equal(result.status, 'rejected');
  assert.equal(result.record.status, 'failed');
});

test('a fast receipt callback arriving before the send request returns is not lost', async () => {
  const store = createStore();
  const result = await runTelegramTestDelivery(base(store, {
    sendMessage: async (_chatId, _text, recordId) => {
      const callbackReceipt = acknowledgeTelegramTestDelivery(store, recordId, 'admin-chat-1', '2026-10-03T12:00:01.000Z');
      assert.equal(callbackReceipt.status, 'acknowledged');
    },
  }));
  assert.equal(result.status, 'acknowledged');
  assert.equal(result.record.completedAt, '2026-10-03T12:00:01.000Z');
  assert.equal(store.get('telegram:test-delivery-history')[0].status, 'acknowledged');
});

test('same idempotency key, cooldown, and concurrent requests do not duplicate messages', async () => {
  const store = createStore();
  let sends = 0;
  const input = base(store, { sendMessage: async () => { sends += 1; await new Promise(resolve => setTimeout(resolve, 20)); } });
  const [first, concurrent] = await Promise.all([runTelegramTestDelivery(input), runTelegramTestDelivery(input)]);
  assert.equal(sends, 1);
  assert.ok(['sent', 'suppressed', 'duplicate'].includes(first.status));
  assert.ok(['sent', 'suppressed', 'duplicate'].includes(concurrent.status));
  const duplicate = await runTelegramTestDelivery(base(store, { sendMessage: async () => { sends += 1; } }));
  assert.equal(duplicate.status, 'duplicate');
  const cooldown = await runTelegramTestDelivery(base(store, { idempotencyKey: 'click-00000002', now: '2026-10-03T12:00:20.000Z', sendMessage: async () => { sends += 1; } }));
  assert.equal(cooldown.status, 'suppressed');
  assert.equal(sends, 1);
});

test('duplicate response preserves the original delivery outcome instead of implying success', async () => {
  const store = createStore();
  const failed = await runTelegramTestDelivery(base(store, {
    sendMessage: async () => { throw new Error('network timeout'); },
  }));
  const duplicate = await runTelegramTestDelivery(base(store, {
    sendMessage: async () => { throw new Error('must not retry'); },
  }));
  assert.equal(failed.status, 'failed');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.record.status, 'failed');
  const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'server.ts'), 'utf8');
  assert.match(server, /result\.status === 'duplicate' \? result\.record\?\.status : result\.status/);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'index.html'), 'utf8');
  assert.match(ui, /data\.status === 'duplicate' \? data\.record\?\.status : data\.status/);
});

test('test delivery history is bounded and telegram private routes require admin checks', async () => {
  const store = createStore();
  for (let index = 0; index < 105; index += 1) {
    await runTelegramTestDelivery(base(store, {
      idempotencyKey: `unique-click-${String(index).padStart(4, '0')}`,
      now: new Date(Date.parse('2026-10-03T12:00:00.000Z') + index * 120_000).toISOString(),
    }));
  }
  const history = store.get('telegram:test-delivery-history');
  assert.equal(history.length, 100);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'server.ts'), 'utf8');
  for (const route of ["app.post('/api/telegram/test'", "app.post('/api/telegram/test-delivery'", "app.get('/api/telegram/status'", "app.get('/api/telegram/command-center'", "app.post('/api/notification-channels/test'"]) {
    const start = source.indexOf(route);
    assert.notEqual(start, -1, `${route} exists`);
    const body = source.slice(start, source.indexOf('\n});', start) + 4);
    assert.match(body, /adminOnly\(req, res\)/, `${route} is admin-only`);
  }
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'index.html'), 'utf8');
  assert.match(ui, /\/api\/telegram\/test-delivery/);
  assert.match(ui, /confirm\([^)]*测试消息/);
  assert.match(ui, /最近测试投递/);
  assert.ok(source.includes("handlers['telegram-test:ack:']"), 'signed test ACK callback is registered');
  assert.ok(source.includes('我已收到'), 'test delivery includes an explicit receipt button');
  assert.ok(source.includes('workspace: \'telegram-test\''), 'test callback is scoped to its private test workspace');
  assert.ok(ui.includes("acknowledged: '已确认收到'"), 'admin settings display receipt acknowledgement');
  assert.ok(ui.includes("deliveryStatus === 'acknowledged'"), 'repeated test action reports an existing receipt as successful');
});
