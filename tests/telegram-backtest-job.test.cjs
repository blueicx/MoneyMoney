const assert = require('node:assert/strict');
const test = require('node:test');

const { getTelegramCommandHandlers } = require('../dist/web/server.js');
const { researchRepository } = require('../dist/features/research-repository.js');
const { telegramCommandCenterStore } = require('../dist/features/telegram-command-center.js');

const replyText = (reply) => typeof reply === 'string' ? reply : reply.text;

test('telegram backtest start creates a scoped persistent research job', async () => {
  const handlers = getTelegramCommandHandlers();
  const chatId = `telegram-backtest-job-${Date.now()}`;
  const originalSaveJob = researchRepository.saveJob;
  let savedJob = null;
  researchRepository.saveJob = (job) => { savedJob = job; };

  try {
    telegramCommandCenterStore.setActiveMarketScope(chatId, 'stocks');
    const response = replyText(await handlers.backtest({ chatId, args: ['start', 'momentum', 'stock:us:AAPL'] }));
    assert.match(response, /回测任务已创建/);
    assert.match(response, /stock:us:AAPL/);
    assert.equal(savedJob.market, 'stocks');
    assert.equal(savedJob.workspace, 'backtest');
    assert.equal(savedJob.status, 'queued');
    assert.match(savedJob.inputSummary, /momentum/);

    const crossMarket = replyText(await handlers.backtest({ chatId, args: ['start', 'momentum', 'crypto:binance:BTCUSDT'] }));
    assert.match(crossMarket, /创建失败|市场或标的无效/);
  } finally {
    researchRepository.saveJob = originalSaveJob;
  }
});

setTimeout(() => process.exit(0), 10);

