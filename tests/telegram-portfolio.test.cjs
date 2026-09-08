const test = require('node:test');
const assert = require('node:assert/strict');
const { getTelegramCommandHandlers } = require('../dist/web/server.js');
const { unifiedPaperLedgerStore } = require('../dist/features/unified-paper-trading.js');

test('Telegram /portfolio output includes legacy and unified performance', async () => {
  // Override unified paper ledger to have some fake positions to test the count formatting
  unifiedPaperLedgerStore.get = () => ({
    positions: [
      { instrumentType: 'stock' },
      { instrumentType: 'stock' },
      { instrumentType: 'crypto' },
      { instrumentType: 'prediction' },
      { instrumentType: 'prediction' },
      { instrumentType: 'prediction' },
    ]
  });

  unifiedPaperLedgerStore.performance = () => ({
    cash: 1000,
    equity: 1200,
    totalPnl: 200,
    winRate: 0.75,
    positions: 6,
    totalTrades: 10
  });

  const handlers = getTelegramCommandHandlers();
  const portfolioHandler = handlers['portfolio'];

  const response = await portfolioHandler({ chatId: 'test_chat' });
  const text = typeof response === 'string' ? response : (response.text || String(response));

  assert.ok(text.includes('模拟盘账户') || text.includes('💼'), 'Should include legacy portfolio');
  assert.ok(text.includes('统一纸面账本') || text.includes('📈'), 'Should include unified paper ledger');

  assert.ok(text.includes('股票 2'), 'Should distinguish stock positions correctly');
  assert.ok(text.includes('加密货币 1'), 'Should distinguish crypto positions correctly');
  assert.ok(text.includes('预测市场 3'), 'Should distinguish prediction positions correctly');

  assert.ok(text.includes('交易数：10'), 'Should contain trade count');
  assert.ok(text.includes('胜率：75.0%'), 'Should contain win rate');

  setTimeout(() => process.exit(0), 10);
});
