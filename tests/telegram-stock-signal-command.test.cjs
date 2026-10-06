const test = require('node:test');
const assert = require('node:assert/strict');
const signals = require('../dist/features/telegram-stock-signal-command');
const { TelegramStockSignalScanner } = require('../dist/features/telegram-stock-signals');

test('exports an isolated stock-scope Telegram signal command', () => {
  assert.equal(typeof signals.handleTelegramStockSignalsCommand, 'function');
});

function createScanner(now = () => Date.now()) {
  const values = new Map();
  const store = { get: key => values.get(key) || null, set: (key, value) => values.set(key, structuredClone(value)) };
  return { scanner: new TelegramStockSignalScanner({ store, now, ttlMs: 60_000 }), values };
}

async function waitForCompletion(scanner, chatId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = scanner.get(chatId);
    if (snapshot?.status === 'complete') return snapshot;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('stock scan did not complete');
}

test('stock /signals scans fixed, Nasdaq mover and chat watchlist pools without admin-list leakage', { skip: typeof signals.handleTelegramStockSignalsCommand !== 'function' }, async () => {
  const { scanner } = createScanner();
  const calls = [];
  const analyze = async candidate => ({ candidate, status: 'ready', dataStatus: 'delayed', action: { action: 'WAIT', actionZh: '等待', confidencePct: 50 }, source: 'test provider', updatedAt: new Date().toISOString() });
  const command = (chatId, isAdmin, telegramWatchlistIds, administratorWatchlistIds = []) => ({
    chatId, scope: 'stocks', args: [], isAdmin, telegramWatchlistIds, administratorWatchlistIds, scanner, analyze,
    discoverMovers: async () => {
      calls.push(chatId);
      return { movers: [{ symbol: 'SNDK', name: 'SanDisk', changePct: 4.2 }, { symbol: 'XYZ', changePct: -3.1 }], status: 'live', source: 'Nasdaq Public Screener', updatedAt: new Date().toISOString() };
    },
  });

  const firstResponse = await signals.handleTelegramStockSignalsCommand(command('chat-normal', false, ['stock:us:AAPL', 'stock:us:SNDK', 'crypto:binance:BTCUSDT'], ['stock:us:PRIVATE']));
  assert.match(firstResponse, /正在获取异动名单/);
  const first = await waitForCompletion(scanner, 'chat-normal');
  const byId = new Map(first.candidates.map(row => [row.candidate.instrumentId, row.candidate]));
  assert.deepEqual(byId.get('stock:us:AAPL').sources, ['fixed', 'watchlist']);
  assert.deepEqual(byId.get('stock:us:SNDK').sources, ['mover', 'watchlist']);
  assert.ok(byId.has('stock:us:XYZ'));
  assert.ok(!byId.has('stock:us:PRIVATE'));
  assert.ok(![...byId.keys()].some(id => id.startsWith('crypto:')));

  await signals.handleTelegramStockSignalsCommand(command('chat-admin', true, ['stock:hk:00001'], ['stock:us:PRIVATE']));
  const admin = await waitForCompletion(scanner, 'chat-admin');
  assert.ok(admin.candidates.some(row => row.candidate.instrumentId === 'stock:us:PRIVATE'));
  assert.ok(admin.candidates.some(row => row.candidate.instrumentId === 'stock:hk:00001'));
  assert.deepEqual(calls, ['chat-normal', 'chat-admin']);
});

test('paging a completed stock scan does not repeat upstream discovery', { skip: typeof signals.handleTelegramStockSignalsCommand !== 'function' }, async () => {
  const { scanner } = createScanner();
  let discoverCalls = 0;
  const common = {
    chatId: 'page-chat', scope: 'stocks', isAdmin: false, telegramWatchlistIds: [], scanner,
    analyze: async candidate => ({ candidate, status: 'ready', dataStatus: 'live', action: { action: 'WAIT', actionZh: '等待', confidencePct: 50 }, source: 'test', updatedAt: new Date().toISOString() }),
    discoverMovers: async () => { discoverCalls += 1; return { movers: [], status: 'empty', source: 'Nasdaq Public Screener', updatedAt: new Date().toISOString() }; },
  };
  await signals.handleTelegramStockSignalsCommand({ ...common, args: [] });
  await waitForCompletion(scanner, common.chatId);
  const pageTwo = await signals.handleTelegramStockSignalsCommand({ ...common, args: ['2'] });
  assert.match(pageTwo, /第 2\//);
  assert.equal(discoverCalls, 1);
});

test('non-stock scope cannot invoke the stock scanner or Nasdaq discovery', { skip: typeof signals.handleTelegramStockSignalsCommand !== 'function' }, async () => {
  const { scanner } = createScanner();
  let discoverCalls = 0;
  const text = await signals.handleTelegramStockSignalsCommand({
    chatId: 'crypto-chat', scope: 'crypto', args: [], telegramWatchlistIds: [], isAdmin: false, scanner,
    discoverMovers: async () => { discoverCalls += 1; throw new Error('must not scan'); },
    analyze: async () => { throw new Error('must not analyze'); },
  });
  assert.match(text, /仅在股票市场可用/);
  assert.equal(discoverCalls, 0);
  assert.equal(scanner.get('crypto-chat'), null);
});

test('failed mover discovery retains a recent prior mover as stale and names the failure', { skip: typeof signals.handleTelegramStockSignalsCommand !== 'function' }, async () => {
  const now = Date.parse('2026-10-06T01:00:00.000Z');
  const { scanner, values } = createScanner(() => now);
  const prior = {
    chatId: 'stale-chat', id: 'previous-scan', createdAt: new Date(now - 20_000).toISOString(), updatedAt: new Date(now - 10_000).toISOString(),
    status: 'complete', scanned: 1,
    moverStatus: { state: 'cached', source: 'Nasdaq Public Screener', updatedAt: new Date(now - 3 * 60_000).toISOString() },
    candidates: [{
      candidate: { market: 'us', symbol: 'SNDK', instrumentId: 'stock:us:SNDK', sources: ['mover'], mover: { symbol: 'SNDK', changePct: 5, updatedAt: new Date(now - 3 * 60_000).toISOString() } },
      status: 'ready', dataStatus: 'live', action: { action: 'WAIT', actionZh: '等待', confidencePct: 50 }, source: 'previous', updatedAt: new Date(now - 3 * 60_000).toISOString(),
    }],
  };
  values.set(scanner.storageKey('stale-chat'), prior);
  const response = await signals.handleTelegramStockSignalsCommand({
    chatId: 'stale-chat', scope: 'stocks', args: ['refresh'], telegramWatchlistIds: [], isAdmin: false, scanner, now: () => now,
    discoverMovers: async () => { throw new Error('Nasdaq timeout'); },
    analyze: async candidate => ({ candidate, status: 'unavailable', dataStatus: 'unavailable', action: null, source: 'test', updatedAt: null, reason: 'upstream unavailable' }),
  });
  assert.match(response, /正在获取异动名单/);
  const snapshot = await waitForCompletion(scanner, 'stale-chat');
  const mover = snapshot.candidates.find(row => row.candidate.instrumentId === 'stock:us:SNDK');
  assert.ok(mover);
  assert.ok(mover.candidate.sources.includes('mover'));
  assert.equal(snapshot.moverStatus.state, 'stale');
  assert.match(snapshot.moverStatus.reason, /Nasdaq timeout/);
});

test('/signals pagination leaves pending rows untouched and /signals continue resumes the next budget batch', { skip: typeof signals.handleTelegramStockSignalsCommand !== 'function' }, async () => {
  const values = new Map();
  const store = { get: key => values.get(key) || null, set: (key, value) => values.set(key, structuredClone(value)) };
  const scanner = new TelegramStockSignalScanner({ store, concurrency: 4, candidateBudget: 11, ttlMs: 60_000 });
  let analyzed = 0;
  const common = {
    chatId: 'continue-chat', scope: 'stocks', isAdmin: false, telegramWatchlistIds: ['stock:us:WATCH'], scanner,
    analyze: async candidate => {
      analyzed += 1;
      return { candidate, status: 'ready', dataStatus: 'live', action: { action: 'WAIT', actionZh: '等待', confidencePct: 50 }, source: 'test', updatedAt: new Date().toISOString() };
    },
    discoverMovers: async () => ({ movers: [], status: 'empty', source: 'Nasdaq Public Screener', updatedAt: new Date().toISOString() }),
  };
  await signals.handleTelegramStockSignalsCommand({ ...common, args: [] });
  const firstBatch = await waitForSettled(scanner, common.chatId);
  assert.equal(firstBatch.status, 'partial');
  assert.equal(analyzed, 11);
  const pageTwo = await signals.handleTelegramStockSignalsCommand({ ...common, args: ['2'] });
  assert.match(pageTwo, /第 2\//);
  assert.equal(analyzed, 11);
  await signals.handleTelegramStockSignalsCommand({ ...common, args: ['continue'] });
  const completed = await waitForCompletion(scanner, common.chatId);
  assert.equal(completed.status, 'complete');
  assert.equal(analyzed, 12);
});

async function waitForSettled(scanner, chatId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = scanner.get(chatId);
    if (snapshot && ['partial', 'complete'].includes(snapshot.status)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('stock scan batch did not settle');
}
