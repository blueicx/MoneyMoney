import fs from 'fs';
import path from 'path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DATA_ROOT, PROJECT_ROOT, ensureDir } from '../utils/paths';
import { stateStore, type SQLiteStateStore } from '../storage/sqlite-state';

export type AutomationJobId = 'radar-refresh' | 'risk-patrol' | 'assistant-refresh' | 'ai-runners' | 'state-backup';
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
    { id: 'state-backup', nameZh: '业务状态备份', descriptionZh: '一致性备份 SQLite、运行状态与已发布数据湖，并验证快照。', cadenceZh: '每天一次 · 保留最近 7 份已验证快照', enabled: true, lastStatus: 'NEVER', lastMessage: '等待首次备份', lastRunAt: null, lastDurationMs: null, runCount: 0, failureCount: 0, recentRuns: [] },
  ];
}

export type StateBackupRunStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'BUSY';
export interface StateBackupRunResult { status: StateBackupRunStatus; message: string; finishedAt?: string; }
type BackupLeaseStore = Pick<SQLiteStateStore, 'acquireLease' | 'refreshLease' | 'releaseLease'>;
type BackupRunRecord = Omit<AutomationRun, 'id' | 'jobId' | 'durationMs'> & { durationMs?: number };

export function stateBackupDue(lastSuccessAt: string | null, now = Date.now(), intervalMs = 24 * 60 * 60_000): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(intervalMs) || intervalMs <= 0) return true;
  const previous = lastSuccessAt ? Date.parse(lastSuccessAt) : Number.NaN;
  return !Number.isFinite(previous) || previous > now || now - previous >= intervalMs;
}

export interface StateBackupSchedulerOptions {
  store: BackupLeaseStore;
  owner?: string;
  clock?: () => number;
  intervalMs?: number;
  isEnabled?: () => boolean;
  getLastSuccessAt: () => string | null;
  runBackup: (signal: AbortSignal) => Promise<string>;
  recordRun: (run: BackupRunRecord) => void;
}

export class StateBackupScheduler {
  private readonly owner: string;
  private readonly clock: () => number;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<StateBackupRunResult> | null = null;

  constructor(private readonly options: StateBackupSchedulerOptions) {
    this.owner = options.owner || `state-backup:${process.pid}:${randomUUID()}`;
    this.clock = options.clock || Date.now;
    this.intervalMs = Math.max(60_000, options.intervalMs || 60 * 60_000);
  }

  start(): void {
    if (this.timer) return;
    void this.runIfDue().catch(() => undefined);
    this.timer = setInterval(() => { void this.runIfDue().catch(() => undefined); }, this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.active?.catch(() => undefined);
  }

  runIfDue(): Promise<StateBackupRunResult> {
    if (this.options.isEnabled && !this.options.isEnabled()) {
      return Promise.resolve({ status: 'SKIPPED', message: '业务状态备份任务已停用' });
    }
    if (!stateBackupDue(this.options.getLastSuccessAt(), this.clock())) {
      return Promise.resolve({ status: 'SKIPPED', message: '最近一次已验证备份仍在 24 小时有效期内' });
    }
    return this.execute();
  }

  runNow(): Promise<StateBackupRunResult> { return this.execute(); }

  private execute(): Promise<StateBackupRunResult> {
    if (this.active) return Promise.resolve({ status: 'BUSY', message: '备份任务正在运行，不重复启动' });
    const pending = this.executeWithLease();
    this.active = pending;
    return pending.finally(() => { if (this.active === pending) this.active = null; });
  }

  private async executeWithLease(): Promise<StateBackupRunResult> {
    const leaseKey = 'automation:state-backup';
    const startedMs = this.clock();
    const startedAt = new Date(startedMs).toISOString();
    const controller = new AbortController();
    let leaseLost = false;
    let heartbeat: NodeJS.Timeout | null = null;
    let acquired = false;
    try {
      acquired = this.options.store.acquireLease(leaseKey, this.owner, startedMs, 60_000);
      if (!acquired) return { status: 'BUSY', message: '其他服务实例持有备份租约，本次不重复运行' };
      heartbeat = setInterval(() => {
        try {
          if (this.options.store.refreshLease(leaseKey, this.owner, this.clock(), 60_000)) return;
        } catch { /* Losing observability of the lease is equivalent to losing the lease. */ }
        leaseLost = true;
        controller.abort(new Error('备份租约已丢失'));
      }, 15_000);
      heartbeat.unref?.();
      await this.options.runBackup(controller.signal);
      if (leaseLost) throw new Error('备份租约已丢失；不记录为成功');
      const finishedAt = new Date(this.clock()).toISOString();
      const message = '一致性快照已创建并通过校验';
      this.options.recordRun({ status: 'SUCCESS', message, startedAt, finishedAt });
      return { status: 'SUCCESS', message, finishedAt };
    } catch (error) {
      const finishedAt = new Date(this.clock()).toISOString();
      const message = '备份失败；请检查服务日志与数据目录状态';
      try { this.options.recordRun({ status: 'FAILED', message, startedAt, finishedAt }); } catch { /* Preserve the safe result even if ops persistence is unavailable. */ }
      return { status: 'FAILED', message, finishedAt };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (acquired) try { this.options.store.releaseLease(leaseKey, this.owner); } catch { /* Lease expiry remains the fallback cleanup. */ }
    }
  }
}

function runBackupProcess(signal: AbortSignal): Promise<string> {
  const packaged = path.join(PROJECT_ROOT, 'dist', 'scripts', 'state-backup.cjs');
  const script = fs.existsSync(packaged) ? packaged : path.join(PROJECT_ROOT, 'scripts', 'state-backup.cjs');
  if (!fs.existsSync(script)) return Promise.reject(new Error('发布包缺少 state-backup.cjs'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, MONEYMONEY_DATA_DIR: DATA_ROOT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const append = (target: string, chunk: Buffer) => (target + chunk.toString('utf8')).slice(-16_000);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    const abort = () => child.kill('SIGTERM');
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    child.once('error', error => { signal.removeEventListener('abort', abort); reject(error); });
    child.once('close', code => {
      signal.removeEventListener('abort', abort);
      if (code === 0 && !signal.aborted) resolve(stdout.trim() || '业务状态快照已创建并通过 SQLite 校验');
      else reject(new Error((stderr.trim() || stdout.trim() || `备份进程退出码 ${code}`).slice(-500)));
    });
  });
}

export function createStateBackupScheduler(options: Omit<StateBackupSchedulerOptions, 'runBackup' | 'getLastSuccessAt' | 'recordRun'> & Partial<Pick<StateBackupSchedulerOptions, 'getLastSuccessAt' | 'recordRun'>>): StateBackupScheduler {
  return new StateBackupScheduler({
    ...options,
    getLastSuccessAt: options.getLastSuccessAt || (() => {
      const job = getAutomationJobs().find(item => item.id === 'state-backup');
      return job?.recentRuns.find(run => run.status === 'SUCCESS')?.finishedAt || null;
    }),
    runBackup: runBackupProcess,
    recordRun: options.recordRun || (run => { saveAutomationRun('state-backup', run); }),
  });
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
