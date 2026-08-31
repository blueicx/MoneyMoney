const assert = require('node:assert/strict');
const {
  defaultAutomationJobs,
  recordAutomationRun,
  summarizeAutomation,
} = require('../dist/features/automation-ops');

const jobs = defaultAutomationJobs();
assert.ok(jobs.some(job => job.id === 'radar-refresh'));
assert.ok(jobs.some(job => job.id === 'risk-patrol'));

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
