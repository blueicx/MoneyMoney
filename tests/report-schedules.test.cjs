const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
require('ts-node/register/transpile-only');
process.env.MONEYMONEY_DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'mm-report-schedule-'));
const { SQLiteStateStore } = require('../src/storage/sqlite-state');
const { ReportScheduleStore } = require('../src/features/report-schedules');

const projectId = 'project_00000000-0000-0000-0000-000000000001';
const linkIds = ['link-1', 'link-2'];
const now = Date.parse('2026-10-28T01:30:00Z'); // 09:30 Asia/Shanghai

function fixture(generate = () => ({ html: '<html>report</html>', json: '{"report":true}' })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-report-store-'));
  const state = new SQLiteStateStore(path.join(dir, 'state.sqlite'), dir);
  const root = path.join(dir, 'reports');
  const store = new ReportScheduleStore(state, root, generate, () => now);
  return { state, root, store, close() { state.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('scheduled report generates local html and json once per window', () => {
  const f = fixture();
  try {
    const schedule = f.store.create({ projectId, linkIds, cadence: 'daily', timeOfDay: '09:00', requestId: 'request-id-0000001' });
    assert.equal(schedule.enabled, true);
    assert.equal(schedule.timezone, 'Asia/Shanghai');
    const first = f.store.runDue();
    assert.deepEqual(first.generated, [schedule.id]);
    const folder = path.join(f.root, schedule.id);
    const manifestPath = path.join(folder, '2026-10-28_daily.manifest.json');
    assert.equal(fs.existsSync(manifestPath), true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.projectId, projectId);
    assert.deepEqual(manifest.linkIds, linkIds);
    assert.match(manifest.htmlHash, /^[a-f0-9]{64}$/);
    const second = f.store.runDue();
    assert.deepEqual(second.generated, []);
    assert.equal(f.store.get(schedule.id).lastRunWindow, '2026-10-28:daily');
  } finally {
    f.close();
  }
});

test('schedule updates require version and delete keeps audit history', () => {
  const f = fixture();
  try {
    const schedule = f.store.create({ projectId, linkIds, cadence: 'daily', timeOfDay: '09:00', requestId: 'request-id-0000002' });
    assert.throws(() => f.store.update(schedule.id, 99, { enabled: false }), /版本/);
    const updated = f.store.update(schedule.id, schedule.version, { enabled: false });
    assert.equal(updated.enabled, false);
    assert.equal(updated.version, 2);
    assert.equal(f.store.preview(schedule.id).due, false);
    const removed = f.store.remove(schedule.id, updated.version);
    assert.equal(removed.deleted, true);
    assert.equal(f.store.list().length, 0);
    assert.equal(f.store.get(schedule.id).deleted, true);
    assert.throws(() => f.store.create({ projectId, linkIds: ['only-one'], cadence: 'daily', timeOfDay: '09:00', requestId: 'request-id-0000003' }), /2–6/);
    assert.throws(() => f.store.create({ projectId, linkIds, cadence: 'hourly', timeOfDay: '09:00', requestId: 'request-id-0000004' }), /频率/);
  } finally {
    f.close();
  }
});

test('failed generation is recorded and retries stop after three attempts in the same window', () => {
  const f = fixture(() => { throw Error('report builder unavailable'); });
  try {
    const schedule = f.store.create({ projectId, linkIds, cadence: 'daily', timeOfDay: '09:00', requestId: 'request-id-0000005' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = f.store.runDue();
      assert.equal(result.failed.length, 1);
    }
    const blocked = f.store.runDue();
    assert.equal(blocked.failed.length, 0);
    assert.deepEqual(blocked.skipped, [schedule.id]);
    const record = f.store.get(schedule.id);
    assert.equal(record.failureCount, 3);
    assert.equal(record.lastRunWindow, null);
  } finally {
    f.close();
  }
});

test('weekly schedules only run on Monday after the chosen time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-report-weekly-'));
  const state = new SQLiteStateStore(path.join(dir, 'state.sqlite'), dir);
  try {
    const wednesday = new ReportScheduleStore(state, path.join(dir, 'reports'), () => ({ html: 'h', json: '{}' }), () => now);
    const schedule = wednesday.create({ projectId, linkIds, cadence: 'weekly', timeOfDay: '09:00', requestId: 'request-id-0000006' });
    assert.equal(wednesday.preview(schedule.id).due, false);
    const mondayNow = Date.parse('2026-11-02T01:30:00Z');
    const monday = new ReportScheduleStore(state, path.join(dir, 'reports'), () => ({ html: 'h', json: '{}' }), () => mondayNow);
    assert.equal(monday.preview(schedule.id).due, true);
  } finally {
    state.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
