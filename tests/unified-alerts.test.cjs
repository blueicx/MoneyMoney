const assert = require('node:assert/strict');

const {
  EVENT_ALERT_STAGES,
  validateUnifiedAlertRule,
  alertDedupKey,
  isAlertSuppressed,
  evaluateUnifiedAlert,
  triggerUnifiedAlerts,
  UnifiedAlertStore,
} = require('../dist/features/unified-alerts');

assert.deepEqual(EVENT_ALERT_STAGES, [1440, 720, 360, 180, 60, 30, 10, 5]);
assert.equal(validateUnifiedAlertRule({ instrumentId: 'stock:us:AAPL', kind: 'event', condition: { stage: 60 }, channels: { web: true, telegram: false } }).ok, true);
assert.equal(validateUnifiedAlertRule({ instrumentId: 'stock:us:AAPL', kind: 'price', condition: { direction: 'above', value: 200 }, channels: { web: true, telegram: true } }).ok, true);
assert.equal(validateUnifiedAlertRule({ instrumentId: 'stock:us:AAPL', kind: 'news', condition: { keywords: ['earnings'] }, channels: { web: true, telegram: true } }).ok, true);
assert.equal(validateUnifiedAlertRule({ instrumentId: '', kind: 'price', condition: { direction: 'above', value: 0 }, channels: { web: true, telegram: true } }).ok, false);

assert.equal(validateUnifiedAlertRule({ scope: 'stocks', kind: 'event', condition: { stage: 60 } }).ok, true);
assert.equal(validateUnifiedAlertRule({ watchlistId: 'my-list', kind: 'news', condition: { keywords: ['apple'] } }).ok, true);
assert.equal(validateUnifiedAlertRule({ scope: 'not-a-market', kind: 'event', condition: { stage: 60 } }).ok, false);
assert.equal(validateUnifiedAlertRule({ kind: 'news', condition: { keywords: ['apple'] } }).ok, false);

const rule = { id: 'r1', ownerId: 'admin', instrumentId: 'stock:us:AAPL', kind: 'price', condition: { direction: 'above', value: 200 }, channels: { web: true, telegram: false }, enabled: true, cooldownMinutes: 30, createdAt: '2026-09-08T00:00:00.000Z' };
assert.equal(evaluateUnifiedAlert(rule, { kind: 'price', value: 201 }).matched, true);
assert.equal(evaluateUnifiedAlert(rule, { kind: 'price', value: 199 }).matched, false);
assert.equal(alertDedupKey(rule, { kind: 'price', value: 201, observedAt: '2026-09-08T01:00:00.000Z' }), 'r1:price:above:200');
assert.equal(isAlertSuppressed({ ...rule, lastTriggeredAt: '2026-09-08T01:00:00.000Z' }, new Date('2026-09-08T01:20:00.000Z')), true);
assert.equal(isAlertSuppressed({ ...rule, quietHours: { start: '22:00', end: '07:00' } }, new Date('2026-09-08T23:00:00.000Z')), true);
assert.equal(isAlertSuppressed({ ...rule, pausedUntil: '2026-09-08T02:00:00.000Z' }, new Date('2026-09-08T01:00:00.000Z')), true);

const eventRule = { ...rule, kind: 'event', condition: { stage: 60 } };
assert.equal(alertDedupKey(eventRule, { kind: 'event', minutesUntil: 60, id: 'ev123', scope: 'stocks' }), 'r1:event:60:ev123:stocks');

const newsRule = { ...rule, kind: 'news', condition: { keywords: ['a'] } };
assert.equal(alertDedupKey(newsRule, { kind: 'news', id: 'n123', scope: 'crypto' }), 'r1:news:a:n123:crypto');

assert.equal(isAlertSuppressed({ ...rule, expiresAt: '2026-09-07T00:00:00.000Z' }, new Date('2026-09-08T01:20:00.000Z')), true);

const store = new UnifiedAlertStore({ keyPrefix: 'test-unified-alerts-' + Date.now() });
const saved = store.createRule({ ...rule, id: undefined });
assert.match(saved.id, /^uar_/);
assert.equal(store.listRules().length, 1);
assert.equal(store.removeRule(saved.id), true);
assert.equal(store.listRules().length, 0);

const triggerStore = new UnifiedAlertStore({ keyPrefix: 'test-unified-alert-trigger-' + Date.now() });
const triggerRule = triggerStore.createRule({ ...rule, id: undefined, cooldownMinutes: 0 });
const triggered = triggerUnifiedAlerts(triggerStore, [{ instrumentId: triggerRule.instrumentId, observation: { kind: 'price', value: 201, observedAt: '2026-09-08T01:00:00.000Z' } }], new Date('2026-09-08T01:00:00.000Z'));
assert.equal(triggered.length, 1);
assert.equal(triggerUnifiedAlerts(triggerStore, [{ instrumentId: triggerRule.instrumentId, observation: { kind: 'price', value: 201, observedAt: '2026-09-08T01:00:00.000Z' } }], new Date('2026-09-08T01:01:00.000Z')).length, 0);

const scopeStore = new UnifiedAlertStore({ keyPrefix: 'test-unified-alert-scope-' + Date.now() });
const scopeRule = scopeStore.createRule({ instrumentId: '', scope: 'stocks', kind: 'price', condition: { direction: 'above', value: 100 }, cooldownMinutes: 0 });
assert.equal(triggerUnifiedAlerts(scopeStore, [{ instrumentId: 'stock:us:AAPL', observation: { kind: 'price', value: 101, scope: 'stocks' } }], new Date('2026-09-08T01:00:00.000Z')).length, 1);
const cryptoScopeStore = new UnifiedAlertStore({ keyPrefix: 'test-unified-alert-crypto-scope-' + Date.now() });
cryptoScopeStore.createRule({ instrumentId: '', scope: 'crypto', kind: 'price', condition: { direction: 'above', value: 100 }, cooldownMinutes: 0 });
assert.equal(triggerUnifiedAlerts(cryptoScopeStore, [{ instrumentId: 'stock:us:AAPL', observation: { kind: 'price', value: 101, scope: 'stocks' } }], new Date('2026-09-08T01:00:00.000Z')).length, 0);
const watchlistStore = new UnifiedAlertStore({ keyPrefix: 'test-unified-alert-watchlist-' + Date.now() });
watchlistStore.createRule({ instrumentId: '', watchlistId: 'my-list', kind: 'news', condition: { keywords: ['apple'] }, cooldownMinutes: 0 });
assert.equal(triggerUnifiedAlerts(watchlistStore, [{ instrumentId: 'stock:us:AAPL', observation: { kind: 'news', title: 'Apple earnings', watchlistIds: ['my-list'] } }], new Date('2026-09-08T01:00:00.000Z')).length, 1);

console.log('unified alert helpers: all assertions passed');
