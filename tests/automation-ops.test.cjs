const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  defaultAutomationJobs,
  inspectSqliteWalHealth,
  createSQLiteWalHealthScheduler,
  configuredSQLiteWalWarnBytes,
  recordAutomationRun,
  summarizeAutomation,
} = require('../dist/features/automation-ops');

const jobs = defaultAutomationJobs();
assert.ok(jobs.some(job => job.id === 'radar-refresh'));
assert.ok(jobs.some(job => job.id === 'risk-patrol'));
const backup = jobs.find(job => job.id === 'state-backup');
assert.ok(backup, 'the daily state backup must be a visible automation job');
assert.equal(backup.enabled, true);
assert.match(backup.cadenceZh, /24 小时|每天/);
const walHealth = jobs.find(job => job.id === 'sqlite-wal-health');
assert.ok(walHealth, 'SQLite WAL health must be visible as an independent Ops job');
assert.equal(walHealth.enabled, true);
assert.match(walHealth.cadenceZh, /15 分钟/);

const updated = recordAutomationRun(jobs, 'radar-refresh', {
  status: 'SUCCESS',
  message: '预测雷达缓存刷新完成',
  startedAt: '2026-08-30T09:00:00Z',
  finishedAt: '2026-08-30T09:00:04Z',
});
const radar = updated.find(job => job.id === 'radar-refresh');
assert.equal(radar.lastStatus, 'SUCCESS');
assert.equal(radar.runCount, 1);
assert.equal(radar.failureCount, 0);
assert.equal(radar.lastDurationMs, 4000);

const failed = recordAutomationRun(updated, 'radar-refresh', {
  status: 'FAILED',
  message: '上游超时',
  startedAt: '2026-08-30T10:00:00Z',
  finishedAt: '2026-08-30T10:00:03Z',
});
const overview = summarizeAutomation(failed);
assert.equal(overview.totalRuns, 2);
assert.equal(overview.failedRuns, 1);
assert.equal(overview.lastFailure.message, '上游超时');

console.log('automation ops helpers: all assertions passed');

test('WAL health inspection reports threshold breaches without changing database sidecars', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-wal-health-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const database = path.join(root, 'moneymoney.sqlite');
  const wal = `${database}-wal`;
  const shm = `${database}-shm`;
  fs.writeFileSync(database, Buffer.alloc(96));
  fs.writeFileSync(wal, Buffer.alloc(48));
  fs.writeFileSync(shm, Buffer.alloc(16));

  const report = inspectSqliteWalHealth(root, 32);
  assert.equal(report.status, 'warning');
  assert.equal(report.thresholdBytes, 32);
  assert.deepEqual(report.databases, [{ name: 'moneymoney.sqlite', status: 'warning', databaseBytes: 96, walBytes: 48, shmBytes: 16 }]);
assert.equal(fs.statSync(wal).size, 48, 'inspection must not checkpoint, truncate, or rewrite WAL');
assert.equal(fs.statSync(shm).size, 16, 'inspection must not rewrite SHM');
assert.match(report.reason, /moneymoney\.sqlite DB .* WAL .* SHM .*只读检查未执行 checkpoint/);
});

test('WAL health scheduler records a warning result and releases its cross-process lease', async () => {
  const leases = new Map();
  const recorded = [];
  const store = {
    acquireLease(key, owner) { if (leases.has(key)) return false; leases.set(key, owner); return true; },
    refreshLease(key, owner) { return leases.get(key) === owner; },
    releaseLease(key, owner) { if (leases.get(key) === owner) leases.delete(key); },
  };
  const scheduler = createSQLiteWalHealthScheduler({
    store,
    inspect: () => ({ status: 'warning', checkedAt: '2026-10-10T00:00:00.000Z', thresholdBytes: 32, databases: [{ name: 'research.db', status: 'warning', databaseBytes: 64, walBytes: 48, shmBytes: 16 }], reason: 'research.db WAL 超过告警阈值' }),
    clock: () => Date.parse('2026-10-10T00:00:00.000Z'),
    recordRun: run => recorded.push(run),
  });
  const result = await scheduler.runNow();
  assert.equal(result.status, 'WARNING');
  assert.match(result.message, /research\.db.*WAL/);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].status, 'WARNING');
  assert.equal(leases.size, 0);
  const warningJob = recordAutomationRun(defaultAutomationJobs(), 'sqlite-wal-health', recorded[0]).find(job => job.id === 'sqlite-wal-health');
  assert.equal(warningJob.failureCount, 0, 'a size warning is not an inspection failure');
});

test('Ops renders WAL threshold warnings with a distinct attention color', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/web/public/index.html'), 'utf8');
  assert.match(source, /job\.lastStatus === 'WARNING'.*var\(--yellow\)/);
});

test('WAL巡检 has a configurable safe default and is scheduled, stoppable, and admin-only when run manually', () => {
  assert.equal(configuredSQLiteWalWarnBytes('invalid'), 256 * 1024 * 1024);
  assert.equal(configuredSQLiteWalWarnBytes('33554432'), 33554432);
  const server = fs.readFileSync(path.join(process.cwd(), 'src/web/server.ts'), 'utf8');
  assert.match(server, /sqliteWalHealthScheduler\.start\(\)/);
  assert.match(server, /await sqliteWalHealthScheduler\.stop\(\)/);
  const route = server.slice(server.indexOf("if (jobId === 'sqlite-wal-health')"), server.indexOf("if (jobId === 'state-backup')"));
  assert.match(route, /if \(!adminOnly\(req, res\)\) return/);
  assert.match(route, /sqliteWalHealthScheduler\.runNow\(\)/);
});
