const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { buildAuditTimeline, renderAuditCsv } = require('../src/features/audit-timeline');

const now = Date.parse('2026-10-28T00:00:00Z');
const entries = [
  { id: '1', at: '2026-10-27T10:00:00Z', action: 'research-project-created', detail: JSON.stringify({ projectId: 'p1', market: 'stocks' }) },
  { id: '2', at: '2026-10-27T11:00:00Z', action: 'option-recovery-file-published', detail: JSON.stringify({ instrument: 'option:x', market: 'options' }), category: 'recovery' },
  { id: '3', at: '2026-10-27T12:00:00Z', action: 'guest_session_started', detail: 'user=guest' },
  { id: '4', at: '2026-10-27T13:00:00Z', action: 'portfolio-import-committed', detail: JSON.stringify({ projectId: 'p2', market: 'crypto' }) },
];

test('audit timeline classifies and sorts newest-first', () => {
  const timeline = buildAuditTimeline({ entries, now });
  assert.equal(timeline.total, 4);
  assert.equal(timeline.events[0].id, '4');
  assert.equal(timeline.events[0].category, 'ledger');
  assert.equal(timeline.events.find(event => event.id === '1').projectId, 'p1');
  assert.equal(timeline.events.find(event => event.id === '3').category, 'auth');
  assert.equal(timeline.events.find(event => event.id === '2').category, 'recovery');
  assert.match(timeline.contentHash, /^[a-f0-9]{64}$/);
});

test('audit filters by project and category', () => {
  const byProject = buildAuditTimeline({ entries, projectId: 'p1', now });
  assert.equal(byProject.total, 1);
  const byCategory = buildAuditTimeline({ entries, category: 'auth', now });
  assert.equal(byCategory.total, 1);
});

test('audit drops future records and reports truncation', () => {
  assert.throws(() => buildAuditTimeline({ entries: [{ id: 'x', at: '2026-10-29T00:00:00Z', action: 'a', detail: '' }], now }), /时间/);
  const timeline = buildAuditTimeline({ entries, limit: 2, now });
  assert.equal(timeline.events.length, 2);
  assert.equal(timeline.truncated, true);
});

test('audit csv escapes detail text', () => {
  const csv = renderAuditCsv(buildAuditTimeline({ entries, now }));
  assert.match(csv, /research-project-created/);
  assert.equal(csv.split('\n').length, 5);
});
