import fs from 'fs';
import path from 'path';
import { DATA_ROOT, ensureDir } from '../utils/paths';
import { stateStore } from '../storage/sqlite-state';

export type AutomationJobId = 'radar-refresh' | 'risk-patrol' | 'assistant-refresh' | 'ai-runners';
export type AutomationRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface AutomationRun {
  id: string;
  jobId: AutomationJobId;
  status: AutomationRunStatus;
  message: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface AutomationJob {
  id: AutomationJobId;
  nameZh: string;
  descriptionZh: string;
  cadenceZh: string;
  enabled: boolean;
  lastStatus: AutomationRunStatus | 'NEVER';
  lastMessage: string;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  runCount: number;
  failureCount: number;
  recentRuns: AutomationRun[];
}

export interface AutomationOverview {
  updatedAt: string;
  totalJobs: number;
  enabledJobs: number;
  runningJobs: number;
  totalRuns: number;
  failedRuns: number;
  lastFailure: AutomationRun | null;
}

const OPS_FILE = path.join(DATA_ROOT, 'automation-ops.json');

export function defaultAutomationJobs(): AutomationJob[] {
  return [
    { id: 'radar-refresh', nameZh: '预测雷达刷新', descriptionZh: '更新跨平台预测市场和天气证据快照。', cadenceZh: '启动预热 + 手动运行', enabled: true, lastStatus: 'NEVER', lastMessage: '尚未运行', lastRunAt: null, lastDurationMs: null, runCount: 0, failureCount: 0, recentRuns: [] },
    { id: 'risk-patrol', nameZh: '持仓风险巡检', descriptionZh: '检查模拟仓位的危险、止盈和观察状态。', cadenceZh: '每 90 秒', enabled: true, lastStatus: 'NEVER', lastMessage: '等待首次巡检', lastRunAt: null, lastDurationMs: null, runCount: 0, failureCount: 0, recentRuns: [] },
    { id: 'assistant-refresh', nameZh: '智能助手刷新', descriptionZh: '汇总多市场环境、行动建议和研究提醒。', cadenceZh: '按需刷新', enabled: true, lastStatus: 'NEVER', lastMessage: '等待首次刷新', lastRunAt: null, lastDurationMs: null, runCount: 0, failureCount: 0, recentRuns: [] },
    { id: 'ai-runners', nameZh: 'AI 模拟跑单', descriptionZh: '按策略 tick 独立模拟账户并记录运行结果。', cadenceZh: '每 60 秒', enabled: true, lastStatus: 'NEVER', lastMessage: '暂无运行记录', lastRunAt: null, lastDurationMs: null, runCount: 0, failureCount: 0, recentRuns: [] },
  ];
}

function loadJobs(): AutomationJob[] {
  ensureDir(DATA_ROOT);
  const stored = stateStore.get<AutomationJob[]>('automation-ops');
  if (Array.isArray(stored)) {
    const defaults = defaultAutomationJobs();
    return defaults.map(item => ({ ...item, ...(stored.find(saved => saved.id === item.id) || {}) }));
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(OPS_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return defaultAutomationJobs();
    const defaults = defaultAutomationJobs();
    return defaults.map(item => ({ ...item, ...(parsed.find((saved: AutomationJob) => saved.id === item.id) || {}) }));
  } catch { return defaultAutomationJobs(); }
}

function saveJobs(jobs: AutomationJob[]): void {
  ensureDir(DATA_ROOT);
  stateStore.set('automation-ops', jobs, 1);
}

export function getAutomationJobs(): AutomationJob[] { return loadJobs(); }

export function recordAutomationRun(jobs: AutomationJob[], jobId: AutomationJobId, run: Omit<AutomationRun, 'id' | 'jobId' | 'durationMs'> & { durationMs?: number }): AutomationJob[] {
  const target = jobs.find(job => job.id === jobId);
  if (!target) throw new Error(`未知自动化任务: ${jobId}`);
  const durationMs = run.durationMs ?? (run.finishedAt ? Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) : undefined);
  const normalized: AutomationRun = { ...run, id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, jobId, durationMs };
  target.lastStatus = normalized.status;
  target.lastMessage = normalized.message;
  target.lastRunAt = normalized.finishedAt || normalized.startedAt;
  target.lastDurationMs = normalized.durationMs ?? null;
  target.runCount += 1;
  if (normalized.status === 'FAILED') target.failureCount += 1;
  target.recentRuns = [normalized, ...target.recentRuns].slice(0, 12);
  return jobs;
}

export function saveAutomationRun(jobId: AutomationJobId, run: Omit<AutomationRun, 'id' | 'jobId' | 'durationMs'> & { durationMs?: number }): AutomationJob[] {
  const jobs = recordAutomationRun(loadJobs(), jobId, run);
  saveJobs(jobs);
  return jobs;
}

export function summarizeAutomation(jobs: AutomationJob[]): AutomationOverview {
  const runs = jobs.flatMap(job => job.recentRuns);
  const failures = runs.filter(run => run.status === 'FAILED').sort((a, b) => (b.finishedAt || b.startedAt).localeCompare(a.finishedAt || a.startedAt));
  return {
    updatedAt: new Date().toISOString(),
    totalJobs: jobs.length,
    enabledJobs: jobs.filter(job => job.enabled).length,
    runningJobs: jobs.filter(job => job.lastStatus === 'RUNNING').length,
    totalRuns: jobs.reduce((sum, job) => sum + job.runCount, 0),
    failedRuns: jobs.reduce((sum, job) => sum + job.failureCount, 0),
    lastFailure: failures[0] || null,
  };
}

export function getAutomationOverview(): AutomationOverview {
  return summarizeAutomation(loadJobs());
}
