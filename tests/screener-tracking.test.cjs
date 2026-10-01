const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SQLiteStateStore } = require('../dist/storage/sqlite-state');
const { ScreenerTrackingStore } = require('../dist/features/screener-tracking');
const template = id => ({ id, scope: 'stocks', name: id, filters: {} });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-screen-race-'));
  const db = new SQLiteStateStore(path.join(dir, 'state.sqlite'), dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { db, tracker: new ScreenerTrackingStore(db) };
}
test('parallel different templates preserve both results and survive restart', async t => {
  const { db, tracker } = fixture(t);
  let finish;
  const slow = tracker.run(template('a'), () => new Promise(resolve => { finish = resolve; }));
  await tracker.run(template('b'), async () => [{ id: 'stock:us:MSFT' }]);
  finish([{ id: 'stock:us:AAPL' }]);
  await slow;
  assert.deepEqual(new ScreenerTrackingStore(db).list().map(x => x.templateId).sort(), ['a','b']);
  assert.equal(tracker.list()[0].dataStatus, 'cached');
});
test('partially failed source does not report missing rows as screener exits', async t => {
  const { tracker } = fixture(t);
  await tracker.run(template('a'), async () => [{ id:'stock:us:AAPL' },{ id:'stock:us:MSFT' }]);
  const result = await tracker.run(template('a'), async () => [{ id:'stock:us:AAPL', _sourceIncomplete:true }]);
  assert.equal(result.record.dataStatus,'partial');
  assert.deepEqual(result.record.currentIds,['stock:us:AAPL','stock:us:MSFT']);
  assert.deepEqual(result.record.exited,[]);
  assert.equal(tracker.claimNotification(result.record),false);
});
test('stop while a request is in flight prevents resurrection even after restart', async t => {
  const { db, tracker } = fixture(t);
  let finish;
  const pending = tracker.run(template('a'), () => new Promise(resolve => { finish = resolve; }));
  tracker.stop('a');
  finish([{ id: 'stock:us:AAPL' }]);
  assert.equal((await pending).cancelled, true);
  assert.deepEqual(new ScreenerTrackingStore(db).list(), []);
});
test('one lease owner per template; failed initial baseline stays retryable; empty input retains last baseline', async t => {
  const { db, tracker } = fixture(t);
  let finish;
  const first = tracker.run(template('a'), () => new Promise(resolve => { finish = resolve; }));
  const busy = await new ScreenerTrackingStore(db).run(template('a'), async () => []);
  assert.equal(busy.busy, true);
  finish([]);
  assert.equal((await first).success, false);
  assert.equal(tracker.list().length, 1);
  await tracker.run(template('a'), async () => [{ id: 'stock:us:AAPL' }]);
  const failed = await tracker.run(template('a'), async () => { throw new Error('upstream failed'); });
  assert.deepEqual(failed.record.currentIds, ['stock:us:AAPL']);
  assert.equal(failed.record.dataStatus, 'failed');
  assert.equal(tracker.history('a').length, 3);
});
test('lease loss and deleted templates cannot commit; notification claim is idempotent', async t => {
  const { db, tracker } = fixture(t);
  await tracker.run(template('a'), async () => [{ id: 'stock:us:AAPL' }]);
  const result = await tracker.run(template('a'), async () => [{ id: 'stock:us:MSFT' }]);
  assert.equal(tracker.claimNotification(result.record), true);
  assert.equal(tracker.claimNotification(result.record), false);
  const deleted = await tracker.run(template('a'), async () => [{ id: 'stock:us:NVDA' }], () => false);
  assert.equal(deleted.cancelled, true);
  assert.deepEqual(tracker.list()[0].currentIds, ['stock:us:MSFT']);
});
