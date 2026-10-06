const test = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'telegram-watchlist-actions-'));
process.env.MONEYMONEY_DATA_DIR=root;
const { getTelegramCommandHandlers } = require('../dist/web/server.js');
const { telegramCommandCenterStore } = require('../dist/features/telegram-command-center.js');
const { unifiedAlertStore } = require('../dist/features/unified-alerts.js');

test('telegram watchlist detail actions generation', async () => {
  const handlers = getTelegramCommandHandlers();
  const watchlistHandler = handlers['watchlist'];

  telegramCommandCenterStore.listWatchlist = () => ['1234', 'usAAPL', 'stock:us:MSFT', 'crypto:binance:BTCUSDT', 'prediction:predictfun:5678'];
  unifiedAlertStore.listWatchlist = () => ['stock:us:NVDA'];

  const response = await watchlistHandler({ chatId: 'test_chat' });

  const kb = response.replyMarkup.inline_keyboard;
  assert.equal(kb.length, 5);
  assert.ok(!kb.some(row=>row.some(btn=>String(btn.callback_data).includes('NVDA'))), 'private web watch must not leak into an unrelated chat');

  // 'stock:us:MSFT' should have '查看详情' and 'unified:show:stock:us:MSFT'
  const msftRow = kb.find(row => row.some(btn => btn.callback_data === 'watch:remove:stock:us:MSFT'));
  assert.ok(msftRow);
  assert.ok(msftRow.some(btn => btn.text === '查看详情' && btn.callback_data === 'unified:show:stock:us:MSFT'));
  assert.ok(msftRow.some(btn => btn.text === '解释'));

  // 'crypto:binance:BTCUSDT' should have '查看详情'
  const btcRow = kb.find(row => row.some(btn => btn.callback_data === 'watch:remove:crypto:binance:BTCUSDT'));
  assert.ok(btcRow);
  assert.ok(btcRow.some(btn => btn.text === '查看详情' && btn.callback_data === 'unified:show:crypto:binance:BTCUSDT'));

  // 'prediction:predictfun:5678' should have '查看详情'
  const predRow = kb.find(row => row.some(btn => btn.callback_data === 'watch:remove:prediction:predictfun:5678'));
  assert.ok(predRow);
  assert.ok(predRow.some(btn => btn.text === '查看详情' && btn.callback_data === 'unified:show:prediction:predictfun:5678'));

  // 'usAAPL' is a normalizable old stock ID, should have '查看详情' mapped to stock:us:AAPL
  const aaplRow = kb.find(row => row.some(btn => btn.callback_data === 'watch:remove:usAAPL'));
  assert.ok(aaplRow);
  assert.ok(aaplRow.some(btn => btn.text === '查看详情' && btn.callback_data === 'unified:show:stock:us:AAPL'));
  assert.ok(aaplRow.some(btn => btn.text === '解释'));

  // '1234' cannot be normalized (unless telegramFindMarket finds it, which by default here returns undefined)
  const oldRow = kb.find(row => row.some(btn => btn.callback_data === 'watch:remove:1234'));
  assert.ok(oldRow);
  assert.ok(!oldRow.some(btn => btn.text === '查看详情'));
  assert.ok(oldRow.some(btn => btn.text === '解释'));

  setTimeout(() => process.exit(0), 10);
});
