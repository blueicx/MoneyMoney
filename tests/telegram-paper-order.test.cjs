const assert = require('node:assert/strict');
const test = require('node:test');

const { getTelegramCommandHandlers } = require('../dist/web/server.js');
const { unifiedPaperLedgerStore } = require('../dist/features/unified-paper-trading.js');
const { telegramCommandCenterStore } = require('../dist/features/telegram-command-center.js');

const replyText = (reply) => typeof reply === 'string' ? reply : reply.text;

test('telegram stock paper order requires confirmation and preserves market scope', async () => {
  const handlers = getTelegramCommandHandlers();
  const chatId = `telegram-paper-order-${Date.now()}`;
  const originalApply = unifiedPaperLedgerStore.apply;
  let capturedOrder;
  unifiedPaperLedgerStore.apply = (order) => {
    capturedOrder = order;
    return { cash: 800, positions: [], orders: [], peakEquity: 1000, maxDrawdownPct: 0 };
  };

  try {
    telegramCommandCenterStore.setActiveMarketScope(chatId, 'stocks');
    const scopedPortfolio = replyText(await handlers.paper({ chatId, args: [] }));
    assert.match(scopedPortfolio, /股票模拟盘账户/);

    const legacyPredictionOpen = replyText(await handlers.paper({ chatId, args: ['open', '123', 'yes', '0.5', '10'] }));
    assert.match(legacyPredictionOpen, /不能跨市场执行/);

    const preview = await handlers.paper({ chatId, args: ['buy', 'stock:us:AAPL', '200', '2'] });
    const previewText = replyText(preview);
    assert.match(previewText, /请确认股票\/虚拟币纸面订单/);
    assert.match(previewText, /stock:us:AAPL/);
    const nonce = previewText.match(/确认码：([a-z0-9-]+)/i)?.[1];
    assert.ok(nonce);

    const confirmed = replyText(await handlers.confirm({ chatId, args: [nonce] }));
    assert.match(confirmed, /纸面订单已提交/);
    assert.equal(capturedOrder.instrumentId, 'stock:us:AAPL');
    assert.equal(capturedOrder.instrumentType, 'stock');
    assert.equal(capturedOrder.side, 'BUY');
    assert.equal(capturedOrder.quantity, 2);
    assert.equal(telegramCommandCenterStore.getActiveMarketScope(chatId), 'stocks');

    const crossMarket = replyText(await handlers.paper({ chatId, args: ['buy', 'crypto:binance:BTCUSDT', '60000', '0.01'] }));
    assert.match(crossMarket, /不能提交虚拟币纸面订单/);
  } finally {
    unifiedPaperLedgerStore.apply = originalApply;
  }
});

setTimeout(() => process.exit(0), 10);
