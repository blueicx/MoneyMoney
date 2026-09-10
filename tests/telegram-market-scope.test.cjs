const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { TelegramCommandCenterStore } = require('../dist/features/telegram-command-center');
const { buildTelegramBottomMenu } = require('../dist/web/telegram-menu');

test('chat market scope is isolated and defaults to overview', () => {
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-market-scope-')), 'state.json');
  const store = new TelegramCommandCenterStore(stateFile);
  const chatA = `scope-a-${Date.now()}`;
  const chatB = `scope-b-${Date.now()}`;

  assert.equal(store.getActiveMarketScope(chatA), 'overview');
  assert.equal(store.setActiveMarketScope(chatA, 'stocks'), 'stocks');
  assert.equal(store.getActiveMarketScope(chatA), 'stocks');
  assert.equal(store.getActiveMarketScope(chatB), 'overview');
  assert.equal(store.setActiveMarketScope(chatA, 'invalid'), 'overview');
});

test('market menu contains selected scope and only its feature labels', () => {
  const menu = buildTelegramBottomMenu(`menu-${Date.now()}`, 'stocks');
  const labels = menu.keyboard.flat().map(button => button.text);

  assert.ok(labels.includes('📈 股票'));
  assert.ok(labels.includes('🌡️ 市场宽度'));
  assert.ok(labels.includes('🧑‍💼 内部人'));
  assert.ok(!labels.includes('🌐 预测雷达'));
});
