const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isTelegramBareSymbol,
} = require('../dist/features/telegram-command-center');
const {
  buildTelegramDeepLink,
  telegramPublicBaseUrl,
} = require('../dist/web/telegram-search');

test('recognizes bare market symbols without swallowing ordinary text', () => {
  assert.equal(isTelegramBareSymbol('SNDK'), true);
  assert.equal(isTelegramBareSymbol('btc/usdt'), true);
  assert.equal(isTelegramBareSymbol('stock:us:AAPL'), false);
  assert.equal(isTelegramBareSymbol('帮我看一下风险'), false);
  assert.equal(isTelegramBareSymbol('搜索市场'), false);
});

test('builds market-scoped web deep links with encoded context', () => {
  const link = buildTelegramDeepLink('https://money.example/app', {
    market: 'stocks',
    instrument: 'stock:us:SNDK',
    timeframe: '1h',
    workspace: 'stock-quotes',
  });
  assert.equal(link, 'https://money.example/app?market=stocks&workspace=stock-quotes&instrument=stock%3Aus%3ASNDK&timeframe=1h');
});

test('refuses local or non-http Telegram deep-link bases', () => {
  assert.equal(telegramPublicBaseUrl({ MONEYMONEY_PUBLIC_URL: 'http://localhost:3000' }), null);
  assert.equal(telegramPublicBaseUrl({ MONEYMONEY_PUBLIC_URL: 'http://127.0.0.1:3000' }), null);
  assert.equal(telegramPublicBaseUrl({ MONEYMONEY_PUBLIC_URL: 'file:///tmp/app' }), null);
  assert.equal(telegramPublicBaseUrl({ MONEYMONEY_PUBLIC_URL: 'https://money.example/' }), 'https://money.example');
});

test('Telegram interaction bot routes unmatched text through its explicit fallback', async () => {
  const { TelegramInteractionBot } = require('../dist/features/telegram-bot');
  const sent = [];
  const bot = new TelegramInteractionBot({
    allowedChatIds: ['allowed'],
    stateFile: require('node:path').join(require('node:os').tmpdir(), `telegram-quick-${Date.now()}.json`),
    handlers: { help: () => 'help' },
    textFallback: ({ message }) => message.text === 'SNDK' ? 'quick:SNDK' : undefined,
    transport: {
      getUpdates: async () => [],
      sendMessage: async (chatId, text) => sent.push({ chatId, text }),
      answerCallbackQuery: async () => {},
    },
  });
  const result = await bot.handleUpdate({ update_id: 1, message: { chat: { id: 'allowed' }, text: 'SNDK' } });
  assert.equal(result.handled, true);
  assert.deepEqual(sent, [{ chatId: 'allowed', text: 'quick:SNDK' }]);
});
