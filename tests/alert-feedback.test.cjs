const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { applyAlertDeliveryFeedback } = require('../dist/features/research-contracts.js');

const delivery = {
  id: 'delivery-1', alertId: 'alert-1', status: 'sent',
  context: { market: 'stocks', workspace: 'alerts', instrument: 'stock:us:AAPL', timeframe: '1d' },
};

test('alert feedback is validated, timestamped and does not change delivery status', () => {
  const updated = applyAlertDeliveryFeedback(delivery, 'useful', '2026-09-27T09:00:00.000Z');
  assert.equal(updated.feedback.rating, 'useful');
  assert.equal(updated.feedback.at, '2026-09-27T09:00:00.000Z');
  assert.equal(updated.status, 'sent');
  assert.equal(delivery.feedback, undefined);
});

test('alert feedback rejects unknown ratings and feedback for undelivered items', () => {
  assert.throws(() => applyAlertDeliveryFeedback(delivery, 'mute', '2026-09-27T09:00:00.000Z'), /反馈类型无效/);
  assert.throws(() => applyAlertDeliveryFeedback({ ...delivery, status: 'queued' }, 'useful', '2026-09-27T09:00:00.000Z'), /已投递提醒/);
});

test('delivery history, ACK, retry and feedback routes are admin-only', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  for (const route of [
    "app.get('/api/alerts/deliveries'",
    "app.post('/api/alerts/deliveries/:id/retry'",
    "app.post('/api/alerts/:id/ack'",
    "app.post('/api/alerts/deliveries/:id/feedback'",
  ]) {
    const start = server.indexOf(route);
    assert.notEqual(start, -1, `missing route ${route}`);
    assert.match(server.slice(start, start + 320), /adminOnly\(req, res\)/, `${route} must deny guest access`);
  }
  const page = fs.readFileSync('src/web/public/index.html', 'utf8');
  const feedbackUi = page.slice(page.indexOf('async function loadAlertDeliveryFeedback()'), page.indexOf('async function setAlertDeliveryFeedback'));
  assert.match(feedbackUi, /window\.mm_isLoggedIn !== true \|\| window\.mm_isGuest/);
  assert.doesNotMatch(feedbackUi, /localStorage\.getItem\(['"]mm_token['"]\)/, 'HttpOnly sessions do not expose a legacy browser token');
  assert.match(feedbackUi, /queued|failed|suppressed/);
  assert.match(feedbackUi, /retryAlertDelivery/);
  assert.match(feedbackUi, /ackAlertDelivery/);
  assert.match(page, /data-alert-delivery-management/);
});
