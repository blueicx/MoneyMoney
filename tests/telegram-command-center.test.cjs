const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  TelegramCommandCenterStore,
  normalizeAlertSymbol,
  parsePriceAlertArgs,
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
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1);
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
