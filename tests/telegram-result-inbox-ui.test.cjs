const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
require('ts-node/register/transpile-only');

test('result action refs are stable, opaque, and scoped to one Telegram chat', () => {
  const { telegramResultActionRef } = require('../src/features/telegram-event-results');
  const ref = telegramResultActionRef('private-chat-123', 'event-result-id');
  assert.match(ref, /^[a-f0-9]{32}$/);
  assert.equal(telegramResultActionRef('private-chat-123', 'event-result-id'), ref);
  assert.notEqual(telegramResultActionRef('other-chat-456', 'event-result-id'), ref);
  assert.notEqual(telegramResultActionRef('private-chat-123', 'other-event-id'), ref);
});

test('Telegram settings expose actionable result inbox entries without leaking private chat ids', () => {
  const runtime = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  assert.match(runtime, /data-result-action=/);
  assert.match(runtime, /原提醒已关联|未关联原提醒/);
  assert.match(runtime, /acknowledge|retry/);
  assert.match(runtime, /\/api\/telegram\/results\//);
  assert.match(server, /app\.post\('\/api\/telegram\/results\/:actionRef\/action'/);
  assert.match(server, /actionRef: telegramResultActionRef/);
  assert.doesNotMatch(server.match(/app\.get\('\/api\/telegram\/results\/coverage'[\s\S]*?\n\}\);/)?.[0] || '', /chatId:/);
});
