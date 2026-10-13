const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SQLiteStateStore } = require('../dist/storage/sqlite-state');
const { StateBackupScheduler, stateBackupDue } = require('../dist/features/automation-ops');

test('verified byte backup with quarantined evidence remains visibly partial in scheduler history',async()=>{
 const records=[],store={acquireLease:()=>true,refreshLease:()=>true,releaseLease:()=>true};
 const summary={format:1,status:'verified',snapshot:'2026-10-13T12-00-00-000Z',databaseBytes:{'moneymoney.sqlite':1024},snapshotBytes:2048,fileCount:4,lakeFileCount:1,quarantinedFileCount:1,dataStatus:'partial'};
 const scheduler=new StateBackupScheduler({store,owner:'partial-evidence',clock:()=>Date.parse('2026-10-13T12:00:00Z'),getLastSuccessAt:()=>null,runBackup:async()=> 'State backup verified: '+JSON.stringify(summary),recordRun:record=>records.push(record)});
 const result=await scheduler.runNow();assert.equal(result.status,'SUCCESS');assert.match(result.message,/隔离.*1|1.*隔离/);assert.match(records[0].message,/不可用|非正常/);
});

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

test('scheduler exposes verified database and snapshot sizes without persisting filesystem paths', async () => {
  const records = [];
  const store = { acquireLease: () => true, refreshLease: () => true, releaseLease: () => true };
  const summary = {
    format: 1,
    status: 'verified',
    snapshot: '2026-10-10T12-00-00-000Z',
    databaseBytes: { 'moneymoney.sqlite': 1048576, 'research.db': 524288 },
    snapshotBytes: 3145728,
    fileCount: 6,
    lakeFileCount: 2,
  };
  const scheduler = new StateBackupScheduler({
    store, owner: 'safe-summary-test', clock: () => Date.parse('2026-10-10T12:00:00.000Z'),
    getLastSuccessAt: () => null,
    runBackup: async () => `State backup verified: ${JSON.stringify(summary)}`,
    recordRun: record => records.push(record),
  });

  const result = await scheduler.runNow();
  assert.equal(result.status, 'SUCCESS');
  assert.match(result.message, /moneymoney\.sqlite.*1\.0 MiB/);
  assert.match(result.message, /research\.db.*0\.5 MiB/);
  assert.match(result.message, /快照.*3\.0 MiB/);
  assert.match(records[0].message, /6 个文件/);
  assert.doesNotMatch(result.message, /[A-Z]:\\|\/opt\//);
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
