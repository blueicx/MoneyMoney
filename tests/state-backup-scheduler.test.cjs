const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SQLiteStateStore } = require('../dist/storage/sqlite-state');
const { StateBackupScheduler, stateBackupDue } = require('../dist/features/automation-ops');

test('daily backup is due initially, after a day, and when the prior success time is invalid', () => {
  assert.equal(typeof stateBackupDue, 'function', 'daily due logic must be testable');
  const now = Date.parse('2026-10-10T12:00:00.000Z');
  assert.equal(stateBackupDue(null, now), true);
  assert.equal(stateBackupDue('not-a-date', now), true);
  assert.equal(stateBackupDue('2026-10-09T11:59:59.999Z', now), true);
  assert.equal(stateBackupDue('2026-10-09T12:00:00.001Z', now), false);
  assert.equal(stateBackupDue('2026-10-10T12:00:00.001Z', now), true, 'a future timestamp must not suppress backups indefinitely');
});

test('scheduler records only safe backup status messages, never child output paths', async () => {
  const records = [];
  const store = { acquireLease: () => true, refreshLease: () => true, releaseLease: () => true };
  const scheduler = new StateBackupScheduler({
    store, owner: 'safe-message-test', clock: () => Date.parse('2026-10-10T12:00:00.000Z'),
    getLastSuccessAt: () => null,
    runBackup: async () => 'State backup created: C:\\private\\money\\data\\backups\\snapshot',
    recordRun: record => records.push(record),
  });
  const result = await scheduler.runNow();
  assert.equal(result.status, 'SUCCESS');
  assert.doesNotMatch(result.message, /C:\\private/);
  assert.doesNotMatch(records[0].message, /C:\\private/);
  assert.match(result.message, /已创建并通过校验/);

  const failed = new StateBackupScheduler({
    store, owner: 'safe-error-test', clock: () => Date.parse('2026-10-10T12:00:00.000Z'),
    getLastSuccessAt: () => null,
    runBackup: async () => { throw new Error('database failed at C:\\private\\money\\data\\research.db'); },
    recordRun: record => records.push(record),
  });
  const failure = await failed.runNow();
  assert.equal(failure.status, 'FAILED');
  assert.doesNotMatch(failure.message, /C:\\private/);
  assert.doesNotMatch(records.at(-1).message, /C:\\private/);
});

test('separate scheduler instances share the SQLite lease and do not run duplicate backups', async (t) => {
  assert.equal(typeof StateBackupScheduler, 'function', 'state backup scheduler must be registered');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-backup-scheduler-'));
  const dbPath = path.join(root, 'moneymoney.sqlite');
  const firstStore = new SQLiteStateStore(dbPath, root);
  const secondStore = new SQLiteStateStore(dbPath, root);
  t.after(() => { secondStore.close(); firstStore.close(); fs.rmSync(root, { recursive: true, force: true }); });

  let lastSuccess = null;
  let runs = 0;
  let start;
  const started = new Promise(resolve => { start = resolve; });
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const schedulerOptions = (store, owner) => ({
    store,
    owner,
    clock: () => Date.parse('2026-10-10T12:00:00.000Z'),
    getLastSuccessAt: () => lastSuccess,
    runBackup: async () => { runs += 1; start(); await gate; return 'snapshot verified'; },
    recordRun: run => { if (run.status === 'SUCCESS') lastSuccess = run.finishedAt; },
    isEnabled: () => true,
  });
  const first = new StateBackupScheduler(schedulerOptions(firstStore, 'backup-worker-one'));
  const second = new StateBackupScheduler(schedulerOptions(secondStore, 'backup-worker-two'));
  const active = first.runIfDue();
  await started;
  const competing = await second.runIfDue();
  assert.equal(competing.status, 'BUSY');
  finish();
  assert.equal((await active).status, 'SUCCESS');
  assert.equal(runs, 1);
  assert.equal((await first.runIfDue()).status, 'SKIPPED');
});
