const test = require('node:test');
const assert = require('node:assert/strict');
const telegram = require('../dist/web/telegram-search');

const { TelegramStockSignalScanner, paginateTelegramStockSignals, formatTelegramStockSignalPage, selectTelegramStockSignalAlerts, telegramStockSignalNotificationKey } = telegram;

test('exposes a recoverable per-chat Telegram stock signal scanner and page formatter', () => {
  assert.equal(typeof TelegramStockSignalScanner, 'function');
  assert.equal(typeof paginateTelegramStockSignals, 'function');
  assert.equal(typeof formatTelegramStockSignalPage, 'function');
});

test('scanner exposes explicit recovery for persisted pending candidates', () => {
  assert.equal(typeof TelegramStockSignalScanner.prototype.resume, 'function');
});

test('paginates all candidates in groups of eight and invalid pages return to page one', { skip: typeof paginateTelegramStockSignals !== 'function' }, () => {
  const candidates = Array.from({ length: 19 }, (_, index) => ({
    candidate: { instrumentId: `stock:us:T${index}`, market: 'us', symbol: `T${index}`, sources: ['watchlist'] },
    status: index === 18 ? 'unavailable' : 'ready',
    dataStatus: index === 18 ? 'unavailable' : 'delayed',
    action: index === 18 ? null : { action: index % 2 ? 'WAIT' : 'BUY', actionZh: index % 2 ? '等待' : '关注', confidencePct: 60 },
    source: 'Nasdaq Public Data',
    updatedAt: '2026-10-06T00:00:00.000Z',
    ...(index === 18 ? { reason: 'history timeout' } : {}),
  }));
  const snapshot = { chatId: 'chat-a', id: 'scan-1', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', status: 'complete', scanned: 19, candidates, moverStatus: { state: 'live', source: 'Nasdaq Public Screener', updatedAt: '2026-10-06T00:00:00.000Z' } };
  const first = paginateTelegramStockSignals(snapshot, 1);
  const second = paginateTelegramStockSignals(snapshot, 2);
  const third = paginateTelegramStockSignals(snapshot, 3);
  const invalid = paginateTelegramStockSignals(snapshot, 99);
  assert.deepEqual([first.items.length, second.items.length, third.items.length], [8, 8, 3]);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(row => row.candidate.instrumentId)).size, 19);
  assert.equal(third.page, 3);
  assert.equal(invalid.page, 1);
  assert.equal(third.totalCount, 19);
});

test('renders WAIT, unavailable reasons, source labels and escapes external names', { skip: typeof formatTelegramStockSignalPage !== 'function' }, () => {
  const snapshot = {
    chatId: 'chat-a', id: 'scan-1', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', status: 'complete', scanned: 2,
    candidates: [
      { candidate: { instrumentId: 'stock:us:SNDK', market: 'us', symbol: 'SNDK', name: '<Sandisk>', sources: ['mover', 'watchlist'] }, status: 'ready', dataStatus: 'delayed', action: { action: 'WAIT', actionZh: '等待', confidencePct: 53 }, source: 'Nasdaq quote + history', updatedAt: '2026-10-06T00:00:00.000Z' },
      { candidate: { instrumentId: 'stock:hk:00700', market: 'hk', symbol: '00700', sources: ['watchlist'] }, status: 'unavailable', dataStatus: 'unavailable', action: null, source: 'Tencent Finance', updatedAt: null, reason: 'K线超时' },
    ],
    moverStatus: { state: 'empty', source: 'Nasdaq Public Screener', updatedAt: '2026-10-06T00:00:00.000Z' },
  };
  const rendered = formatTelegramStockSignalPage(paginateTelegramStockSignals(snapshot, 1));
  assert.match(rendered, /等待/);
  assert.match(rendered, /数据不可用/);
  assert.match(rendered, /Nasdaq quote \+ history/);
  assert.match(rendered, /Tencent Finance/);
  assert.match(rendered, /来源成功但无异动/);
  assert.match(rendered, /&lt;Sandisk&gt;/);
  assert.match(rendered, /K线超时/);
});

test('scanner persists independent chat snapshots, resumes pending candidates, and caps shared concurrency', { skip: typeof TelegramStockSignalScanner !== 'function' }, async () => {
  const values = new Map();
  const store = {
    get: key => values.get(key) || null,
    set: (key, value) => values.set(key, structuredClone(value)),
  };
  const scanner = new TelegramStockSignalScanner({ store, concurrency: 2, ttlMs: 60_000 });
  let active = 0;
  let maximumActive = 0;
  const makeUniverse = (chatId, symbols) => ({
    candidates: symbols.map(symbol => ({ market: 'us', symbol, instrumentId: `stock:us:${symbol}`, sources: ['watchlist'] })),
    moverStatus: { state: 'empty', source: 'Nasdaq Public Screener', updatedAt: null },
  });
  const options = chatId => ({
    initialUniverse: makeUniverse(chatId, ['A', 'B', 'C']),
    loadUniverse: async () => makeUniverse(chatId, ['A', 'B', 'C']),
    analyze: async candidate => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 4));
      active -= 1;
      if (candidate.symbol === 'B') throw new Error('provider failed');
      return { candidate, status: 'ready', dataStatus: 'live', action: { action: 'WAIT', actionZh: '等待', confidencePct: 50 }, source: 'test-provider', updatedAt: '2026-10-06T00:00:00.000Z' };
    },
  });
  const firstJob = scanner.start('chat-a', options('chat-a'));
  const secondJob = scanner.start('chat-b', options('chat-b'));
  assert.equal(firstJob.snapshot.candidates.every(row => row.status === 'pending'), true);
  await Promise.all([firstJob.completion, secondJob.completion]);
  const first = scanner.get('chat-a');
  const second = scanner.get('chat-b');
  assert.equal(first.candidates.length, 3);
  assert.equal(first.candidates.find(row => row.candidate.symbol === 'B').status, 'unavailable');
  assert.match(first.candidates.find(row => row.candidate.symbol === 'B').reason, /provider failed/);
  assert.equal(second.chatId, 'chat-b');
  assert.notEqual(scanner.storageKey('chat-a'), scanner.storageKey('chat-b'));
  assert.equal(maximumActive, 2);
  assert.equal(first.status, 'complete');
});

test('recovery resumes only pending rows and preserves completed results', { skip: typeof TelegramStockSignalScanner !== 'function' || typeof TelegramStockSignalScanner.prototype.resume !== 'function' }, async () => {
  const values = new Map();
  const store = { get: key => values.get(key) || null, set: (key, value) => values.set(key, structuredClone(value)) };
  const scanner = new TelegramStockSignalScanner({ store, now: () => Date.parse('2026-10-06T00:02:00.000Z') });
  const snapshot = {
    chatId: 'chat-recover', id: 'scan-resume', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:30.000Z', status: 'scanning', scanned: 1,
    candidates: [
      { candidate: { market: 'us', symbol: 'AAPL', instrumentId: 'stock:us:AAPL', sources: ['fixed'] }, status: 'ready', dataStatus: 'live', action: { action: 'WAIT', actionZh: '等待', confidencePct: 50 }, source: 'already-complete', updatedAt: '2026-10-06T00:00:00.000Z' },
      { candidate: { market: 'us', symbol: 'SNDK', instrumentId: 'stock:us:SNDK', sources: ['watchlist'] }, status: 'pending', action: null, source: '', updatedAt: null },
    ],
    moverStatus: { state: 'empty', source: 'Nasdaq Public Screener', updatedAt: null },
  };
  store.set(scanner.storageKey('chat-recover'), snapshot);
  const calls = [];
  const job = scanner.resume('chat-recover', async candidate => {
    calls.push(candidate.symbol);
    return { candidate, status: 'unavailable', dataStatus: 'unavailable', action: null, source: 'Nasdaq Public Data', updatedAt: null, reason: 'provider timeout' };
  });
  assert.ok(job);
  const result = await job.completion;
  assert.deepEqual(calls, ['SNDK']);
  assert.equal(result.candidates[0].source, 'already-complete');
  assert.equal(result.candidates[1].status, 'unavailable');
  assert.equal(result.scanned, 2);
  assert.equal(result.status, 'complete');
});

test('stock push candidates include only ready actionable stock rows and dedupe by chat plus scan', () => {
  assert.equal(typeof selectTelegramStockSignalAlerts, 'function');
  assert.equal(typeof telegramStockSignalNotificationKey, 'function');
  const snapshot = {
    chatId: 'chat-a', id: 'scan-1', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:01:00.000Z', status: 'complete', scanned: 4,
    moverStatus: { state: 'empty', source: 'Nasdaq Public Screener', updatedAt: null },
    candidates: [
      { candidate: { market: 'us', symbol: 'AAPL', instrumentId: 'stock:us:AAPL', sources: ['fixed'] }, status: 'ready', dataStatus: 'live', action: { action: 'BUY' } },
      { candidate: { market: 'us', symbol: 'MSFT', instrumentId: 'stock:us:MSFT', sources: ['watchlist'] }, status: 'ready', dataStatus: 'delayed', action: { action: 'WAIT' } },
      { candidate: { market: 'hk', symbol: '00700', instrumentId: 'stock:hk:00700', sources: ['watchlist'] }, status: 'unavailable', dataStatus: 'unavailable', action: { action: 'SELL' } },
      { candidate: { market: 'us', symbol: 'BAD', instrumentId: 'crypto:binance:BAD', sources: ['watchlist'] }, status: 'ready', dataStatus: 'live', action: { action: 'SELL' } },
    ],
  };
  assert.deepEqual(selectTelegramStockSignalAlerts(snapshot).map(row => row.candidate.instrumentId), ['stock:us:AAPL']);
  const delivered = new Set();
  const markDelivered = chat => {
    const key = telegramStockSignalNotificationKey(chat, snapshot);
    if (delivered.has(key)) return false;
    delivered.add(key);
    return true;
  };
  assert.equal(markDelivered('chat-a'), true);
  assert.equal(markDelivered('chat-a'), false);
  assert.equal(markDelivered('chat-b'), true);
});

test('scans a bounded candidate batch per run and resumes the next pending batch explicitly', { skip: typeof TelegramStockSignalScanner !== 'function' }, async () => {
  const values = new Map();
  const store = { get: key => values.get(key) || null, set: (key, value) => values.set(key, structuredClone(value)) };
  const scanner = new TelegramStockSignalScanner({ store, concurrency: 2, candidateBudget: 3, ttlMs: 60_000 });
  const universe = {
    candidates: Array.from({ length: 8 }, (_, index) => ({ market: 'us', symbol: `T${index}`, instrumentId: `stock:us:T${index}`, sources: ['watchlist'] })),
    moverStatus: { state: 'empty', source: 'Nasdaq Public Screener', updatedAt: null },
  };
  const analyze = async candidate => ({ candidate, status: 'ready', dataStatus: 'live', action: { action: 'WAIT', actionZh: '等待', confidencePct: 50 }, source: 'test', updatedAt: '2026-10-06T00:00:00.000Z' });
  const first = scanner.start('budget-chat', { initialUniverse: universe, loadUniverse: async () => universe, analyze });
  const firstResult = await first.completion;
  assert.equal(firstResult.status, 'partial');
  assert.equal(firstResult.scanned, 3);
  assert.equal(firstResult.candidates.filter(row => row.status === 'pending').length, 5);
  const second = scanner.resume('budget-chat', analyze);
  assert.ok(second);
  const secondResult = await second.completion;
  assert.equal(secondResult.scanned, 6);
  assert.equal(secondResult.candidates.filter(row => row.status === 'pending').length, 2);
  const third = scanner.resume('budget-chat', analyze);
  assert.ok(third);
  const thirdResult = await third.completion;
  assert.equal(thirdResult.status, 'complete');
  assert.equal(thirdResult.scanned, 8);
  assert.equal(thirdResult.candidates.filter(row => row.status === 'pending').length, 0);
});

test('completed scan orders ready BUY/SELL before WAIT and unavailable within the same source tier', { skip: typeof TelegramStockSignalScanner !== 'function' }, async () => {
  const values = new Map();
  const store = { get: key => values.get(key) || null, set: (key, value) => values.set(key, structuredClone(value)) };
  const scanner = new TelegramStockSignalScanner({ store, candidateBudget: 10 });
  const candidates = ['WAIT', 'BUY', 'SELL', 'unavailable'].map((action, index) => ({
    market: 'us', symbol: `S${index}`, instrumentId: `stock:us:S${index}`, sources: ['fixed'],
  }));
  const universe = { candidates, moverStatus: { state: 'empty', source: 'Nasdaq Public Screener', updatedAt: null } };
  const job = scanner.start('sort-chat', {
    initialUniverse: universe, loadUniverse: async () => universe,
    analyze: async (candidate, index) => {
      const type = candidate.symbol === 'S3' ? 'unavailable' : 'ready';
      const action = candidate.symbol === 'S0' ? 'WAIT' : candidate.symbol === 'S1' ? 'BUY' : 'SELL';
      return { candidate, status: type, dataStatus: type === 'ready' ? 'live' : 'unavailable', action: type === 'ready' ? { action, actionZh: action, confidencePct: 50 } : null, source: 'test', updatedAt: null };
    },
  });
  const result = await job.completion;
  assert.deepEqual(result.candidates.map(row => row.candidate.symbol), ['S1', 'S2', 'S0', 'S3']);
});
