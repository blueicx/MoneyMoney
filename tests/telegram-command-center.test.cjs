const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  TelegramCommandCenterStore,
  normalizeAlertSymbol,
  parsePriceAlertArgs,
  parseSmartAlertArgs,
  parseWatchCommandArgs,
  parseDigestTime,
  routeNaturalLanguage,
  sparkline,
} = require('../dist/features/telegram-command-center');

test('stores per-chat notification preferences and keeps defaults safe', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-center-')), 'state.json');
  const store = new TelegramCommandCenterStore(file);
  assert.deepEqual(store.getPreferences('100').notifications, {
    signals: true,
    dailyReport: true,
    riskAlerts: true,
    events: true,
    priceAlerts: true,
  });
  store.updatePreferences('100', { notifications: { riskAlerts: false } });
  assert.equal(store.getPreferences('100').notifications.riskAlerts, false);
  assert.equal(store.getPreferences('100').notifications.signals, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 2);
});

test('parses safe price alerts and normalizes crypto symbols', () => {
  assert.equal(normalizeAlertSymbol('btc'), 'BTCUSDT');
  assert.equal(normalizeAlertSymbol('ETHUSDT'), 'ETHUSDT');
  assert.deepEqual(parsePriceAlertArgs(['BTC', 'above', '120000']), {
    symbol: 'BTCUSDT', direction: 'ABOVE', price: 120000,
  });
  assert.equal(parsePriceAlertArgs(['BTC', 'sideways', '1']), null);
  assert.equal(parsePriceAlertArgs(['BTC', 'above', '-1']), null);
});

test('supports pending confirmation lifecycle and audit records', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-center-')), 'state.json');
  const store = new TelegramCommandCenterStore(file);
  const pending = store.createPendingAction('100', { type: 'paper_open', marketId: 7, amountUsd: 10 });
  assert.equal(store.consumePendingAction('100', pending.nonce)?.marketId, 7);
  assert.equal(store.consumePendingAction('100', pending.nonce), null);
  store.recordAudit('100', 'paper_open', 'confirmed');
  assert.equal(store.listAudits('100', 1)[0].action, 'paper_open');
});

test('routes common natural-language shortcuts and renders a trend sparkline', () => {
  assert.equal(routeNaturalLanguage('帮我看一下风险'), 'risk');
  assert.equal(routeNaturalLanguage('今天有什么事件'), 'events');
  assert.equal(routeNaturalLanguage('随便聊聊'), null);
  assert.equal(sparkline([1, 2, 3, 2, 5]).length, 5);
  assert.equal(sparkline([]), '暂无');
});

test('persists a per-chat watchlist and normalizes market IDs', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-center-')), 'state.json');
  const store = new TelegramCommandCenterStore(file);
  assert.deepEqual(parseWatchCommandArgs([]), { action: 'list' });
  assert.deepEqual(parseWatchCommandArgs(['add', ' 42 ']), { action: 'add', marketId: '42' });
  assert.equal(store.addWatchlistMarket('100', ' 42 '), true);
  assert.equal(store.addWatchlistMarket('100', '42'), false);
  assert.equal(store.addWatchlistMarket('200', '42'), true);
  assert.deepEqual(store.listWatchlist('100'), ['42']);
  assert.equal(store.removeWatchlistMarket('100', '42'), true);
  assert.deepEqual(store.listWatchlist('100'), []);
  assert.deepEqual(store.listWatchlist('200'), ['42']);
});

test('parses smart alerts and digest times safely', () => {
  assert.deepEqual(parseSmartAlertArgs(['BTC', 'probability', 'above', '60']), {
    type: 'PROBABILITY', symbol: 'BTCUSDT', direction: 'ABOVE', threshold: 60,
  });
  assert.deepEqual(parseSmartAlertArgs(['risk', 'above', '10']), {
    type: 'RISK', direction: 'ABOVE', threshold: 10,
  });
  assert.equal(parseSmartAlertArgs(['BTC', 'probability', 'above', '120']), null);
  assert.equal(parseDigestTime('08:30'), '08:30');
  assert.equal(parseDigestTime('8:30'), '08:30');
  assert.equal(parseDigestTime('25:00'), null);
});

test('persists alert policy, cooldown metadata, and journal entries', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-center-')), 'state.json');
  const store = new TelegramCommandCenterStore(file);
  store.updateAlertPolicy('100', {
    pausedUntil: '2026-09-01T09:00:00.000Z',
    quietHours: { enabled: true, start: '22:00', end: '07:00' },
    digest: { enabled: true, time: '08:30' },
  });
  const policy = store.getAlertPolicy('100');
  assert.equal(policy.digest.time, '08:30');
  assert.equal(policy.quietHours.start, '22:00');
  assert.equal(store.isChatAlertPaused('100', new Date('2026-09-01T08:00:00.000Z')), true);
  assert.equal(store.isChatInQuietHours('100', new Date(2026, 8, 1, 23, 0)), true);
  const entry = store.createJournalEntry('100', { text: '测试研究记录', marketId: '42', marketTitle: '测试市场' });
  assert.equal(store.listJournalEntries('100')[0].id, entry.id);
  assert.equal(store.listJournalEntries('100')[0].marketId, '42');
});

test('migrates version one state without losing existing preferences or price alerts', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-center-')), 'state.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    preferences: { '100': { chatId: '100', notifications: { signals: false }, updatedAt: '2026-08-30T00:00:00.000Z' } },
    priceAlerts: [{ id: 'ta_old', chatId: '100', symbol: 'BTCUSDT', direction: 'ABOVE', price: 100000, triggered: false, createdAt: '2026-08-30T00:00:00.000Z' }],
    pending: [],
    audits: [],
  }), 'utf8');
  const store = new TelegramCommandCenterStore(file);
  assert.equal(store.getPreferences('100').notifications.signals, false);
  assert.equal(store.listPriceAlerts('100')[0].id, 'ta_old');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1);
  store.addWatchlistMarket('100', '42');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 2);
});
