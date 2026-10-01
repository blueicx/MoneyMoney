const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { SQLiteStateStore } = require('../dist/storage/sqlite-state');
const { ActionCenterStore, buildActionCenter } = require('../dist/features/action-center');
const at = '2026-10-01T08:00:00.000Z';
const item = (id, extra = {}) => ({ id, market: 'stocks', instrument: 'stock:us:AAPL', kind: 'event', title: id, occurredAt: at, observedAt: at, source: 'SEC', dataStatus: 'historical', evidenceRefs: [], ...extra });
test('action center isolates scope, splits future from occurred events and sanitizes source links', () => {
  const data = buildActionCenter([item('old'), item('next', { occurredAt: '2026-10-03T08:00:00Z' }), item('bad', { market: 'crypto' }), item('unsafe', { sourceUrl: 'javascript:alert(1)' })], { market: 'stocks', now: at });
  assert.equal(data.items.some(x => x.id === 'bad'), false);
  assert.equal(data.items.find(x => x.id === 'next').section, 'upcoming');
  assert.equal(data.items.find(x => x.id === 'unsafe').sourceUrl, undefined);
});
test('read/pin/snooze persists by owner and resumes at expiration, invalid snooze is rejected', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-actions-'));
  const db = new SQLiteStateStore(path.join(dir, 'state.sqlite'), dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const store = new ActionCenterStore(db);
  store.update('admin', item('a'), { read: true, pinned: true, snoozedUntil: '2026-10-02T08:00:00Z' }, at);
  assert.equal(new ActionCenterStore(db).states('admin').a.read, true);
  assert.deepEqual(store.states('telegram:123'), {});
  assert.equal(buildActionCenter([item('a')], { now: at, states: store.states('admin') }).items[0].snoozed, true);
  assert.equal(buildActionCenter([item('a')], { now: '2026-10-03T00:00:00Z', states: store.states('admin') }).items[0].snoozed, false);
  assert.throws(() => store.update('admin', item('a'), { snoozedUntil: 'not-a-date' }, at));
});
