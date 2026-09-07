const test = require('node:test');
const assert = require('node:assert/strict');
const { getTelegramCommandHandlers } = require('../dist/web/server.js');
const { telegramCommandCenterStore } = require('../dist/features/telegram-command-center.js');
const { unifiedAlertStore } = require('../dist/features/unified-alerts.js');

test('telegram watchlist detail actions generation', async () => {
  const handlers = getTelegramCommandHandlers();
  const watchlistHandler = handlers['watchlist'];

  telegramCommandCenterStore.listWatchlist = () => ['1234', 'usAAPL'];
  unifiedAlertStore.listWatchlist = () => ['stock:us:MSFT', 'crypto:binance:BTCUSDT', 'prediction:predictfun:5678'];

  const response = await watchlistHandler({ chatId: 'test_chat' });

  const kb = response.replyMarkup.inline_keyboard;
  assert.equal(kb.length, 5);

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
