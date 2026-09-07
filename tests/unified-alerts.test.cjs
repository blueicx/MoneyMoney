const assert = require('node:assert/strict');

const {
  EVENT_ALERT_STAGES,
  validateUnifiedAlertRule,
  alertDedupKey,
  isAlertSuppressed,
  evaluateUnifiedAlert,
  UnifiedAlertStore,
} = require('../dist/features/unified-alerts');

assert.deepEqual(EVENT_ALERT_STAGES, [1440, 720, 360, 180, 60, 30, 10, 5]);
assert.equal(validateUnifiedAlertRule({ instrumentId: 'stock:us:AAPL', kind: 'event', condition: { stage: 60 }, channels: { web: true, telegram: false } }).ok, true);
assert.equal(validateUnifiedAlertRule({ instrumentId: 'stock:us:AAPL', kind: 'price', condition: { direction: 'above', value: 200 }, channels: { web: true, telegram: true } }).ok, true);
assert.equal(validateUnifiedAlertRule({ instrumentId: 'stock:us:AAPL', kind: 'news', condition: { keywords: ['earnings'] }, channels: { web: true, telegram: true } }).ok, true);
assert.equal(validateUnifiedAlertRule({ instrumentId: '', kind: 'price', condition: { direction: 'above', value: 0 }, channels: { web: true, telegram: true } }).ok, false);

const rule = { id: 'r1', ownerId: 'admin', instrumentId: 'stock:us:AAPL', kind: 'price', condition: { direction: 'above', value: 200 }, channels: { web: true, telegram: false }, enabled: true, cooldownMinutes: 30, createdAt: '2026-09-08T00:00:00.000Z' };
assert.equal(evaluateUnifiedAlert(rule, { kind: 'price', value: 201 }).matched, true);
assert.equal(evaluateUnifiedAlert(rule, { kind: 'price', value: 199 }).matched, false);
assert.equal(alertDedupKey(rule, { kind: 'price', value: 201, observedAt: '2026-09-08T01:00:00.000Z' }), 'r1:price:above:200');
assert.equal(isAlertSuppressed({ ...rule, lastTriggeredAt: '2026-09-08T01:00:00.000Z' }, new Date('2026-09-08T01:20:00.000Z')), true);
assert.equal(isAlertSuppressed({ ...rule, quietHours: { start: '22:00', end: '07:00' } }, new Date('2026-09-08T23:00:00.000Z')), true);
assert.equal(isAlertSuppressed({ ...rule, pausedUntil: '2026-09-08T02:00:00.000Z' }, new Date('2026-09-08T01:00:00.000Z')), true);

const store = new UnifiedAlertStore({ keyPrefix: 'test-unified-alerts-' + Date.now() });
const saved = store.createRule({ ...rule, id: undefined });
assert.match(saved.id, /^uar_/);
assert.equal(store.listRules().length, 1);
assert.equal(store.removeRule(saved.id), true);
assert.equal(store.listRules().length, 0);

console.log('unified alert helpers: all assertions passed');
