const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const serverSource = fs.readFileSync('src/web/server.ts', 'utf8');

const { TelegramCommandCenterStore } = require('../dist/features/telegram-command-center');
const { buildTelegramBottomMenu, getTelegramMenuEntries } = require('../dist/web/telegram-menu');
const { getTelegramCommandHandlers } = require('../dist/web/server');

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

test('股票和虚拟币菜单提供各自的真实资产回测入口', () => {
  const stocks = getTelegramMenuEntries('stocks').map(entry => entry.text);
  const crypto = getTelegramMenuEntries('crypto').map(entry => entry.text);
  assert.ok(stocks.includes('🧪 股票回测'));
  assert.ok(crypto.includes('🧪 虚拟币回测'));
});

test('market button changes the chat scope and resets its menu page', async () => {
  const handlers = getTelegramCommandHandlers();
  const response = await handlers.market({ chatId: 'scope-switch-chat', command: 'market', args: ['stocks'] });
  assert.match(response.text, /已切换到股票市场/);
  assert.match(response.text, /scope=stocks/);
});

test('server wires the chat scope into the menu and filters Telegram search results', () => {
  assert.match(serverSource, /menuScope:\s*chatId\s*=>\s*telegramCommandCenterStore\.getActiveMarketScope\(chatId\)/);
  assert.match(serverSource, /filterInstrumentResults\(await unifiedInstrumentService\.search\(query\)/);
  assert.match(serverSource, /getTelegramMenuEntries\(scope\)/);
  assert.match(serverSource, /market:\s*\(\{\s*chatId,\s*args\s*\}\)/);
  assert.match(serverSource, /telegramScopedCallback\('watch:add', scope/);
  assert.match(serverSource, /parseScopedTelegramCallback\(data, 'watch:add'/);
  assert.match(serverSource, /parseScopedTelegramCallback\(data, 'unified:show'/);
});

setTimeout(() => process.exit(0), 10);
