import { stateStore, type SQLiteStateStore } from '../storage/sqlite-state';
import { refreshGuruFeaturedManagers, type GuruManagerSnapshot } from './guru-holdings';

const DAILY_LEASE_KEY = 'guru13f:daily-refresh:lease';
const LAST_RUN_KEY = 'guru13f:daily-refresh:last-run';
const DAILY_LEASE_MS = 20 * 60_000;
const POLL_INTERVAL_MS = 15 * 60_000;

interface GuruRefreshRun {
  localDate: string;
  startedAt: string;
  completedAt: string;
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  managersChecked: number;
  failedManagers: Array<{ cik: string; reason: string }>;
  reason: string | null;
}

interface GuruMonitorStore extends Pick<SQLiteStateStore, 'get' | 'set' | 'acquireLease' | 'releaseLease'> {}

export interface GuruHoldingsRefreshMonitorOptions {
  store?: GuruMonitorStore;
  refreshFeaturedManagers?: (force?: boolean) => Promise<GuruManagerSnapshot[]>;
  now?: () => Date;
  owner?: string;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  intervalMs?: number;
}

function shanghaiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function createGuruHoldingsRefreshMonitor(options: GuruHoldingsRefreshMonitorOptions = {}) {
  const store = options.store || stateStore;
  const refresh = options.refreshFeaturedManagers || refreshGuruFeaturedManagers;
  const now = options.now || (() => new Date());
  const owner = options.owner || `guru13f-daily-${process.pid}`;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let activeRun: Promise<{ ran: boolean; reason?: string }> | null = null;

  async function runIfDue(): Promise<{ ran: boolean; reason?: string; result?: GuruRefreshRun }> {
    if (activeRun) return { ran: false, reason: '本进程的刷新任务正在执行' };
    const currentTime = now();
    const localDate = shanghaiDate(currentTime);
    const previous = store.get<GuruRefreshRun>(LAST_RUN_KEY);
    if (previous?.localDate === localDate && previous.status !== 'running') {
      return { ran: false, reason: '今日已完成检查' };
    }
    const nowMs = currentTime.getTime();
    if (!store.acquireLease(DAILY_LEASE_KEY, owner, nowMs, DAILY_LEASE_MS)) {
      return { ran: false, reason: '另一个服务实例持有每日刷新租约' };
    }

    const startedAt = now().toISOString();
    store.set(LAST_RUN_KEY, {
      localDate, startedAt, completedAt: '', status: 'running', managersChecked: 0,
      failedManagers: [], reason: '刷新正在执行；若进程意外退出，租约过期后可重试。',
    } satisfies GuruRefreshRun);

    const run = (async () => {
      try {
        // Daily checks must bypass the per-filer freshness cache so a previous
        // unavailable/partial SEC fetch can recover without an admin login.
        const snapshots = await refresh(true);
        const failedManagers = snapshots.filter(item => item.dataStatus === 'unavailable')
          .map(item => ({ cik: item.manager.cik, reason: item.reason || 'SEC 来源不可用' }));
        const result: GuruRefreshRun = {
          localDate,
          startedAt,
          completedAt: now().toISOString(),
          status: failedManagers.length === 0 ? 'succeeded' : failedManagers.length === snapshots.length ? 'failed' : 'partial',
          managersChecked: snapshots.length,
          failedManagers,
          reason: failedManagers.length ? failedManagers.map(item => `${item.cik}: ${item.reason}`).join('；') : null,
        };
        store.set(LAST_RUN_KEY, result satisfies GuruRefreshRun);
        return { ran: true, result };
      } catch (error) {
        const result: GuruRefreshRun = {
          localDate,
          startedAt,
          completedAt: now().toISOString(),
          status: 'failed',
          managersChecked: 0,
          failedManagers: [],
          reason: error instanceof Error ? error.message : String(error),
        };
        store.set(LAST_RUN_KEY, result satisfies GuruRefreshRun);
        return { ran: true, reason: result.reason || '刷新失败', result };
      } finally {
        store.releaseLease(DAILY_LEASE_KEY, owner);
      }
    })();
    activeRun = run;
    try { return await run; }
    finally { if (activeRun === run) activeRun = null; }
  }

  function start(): void {
    if (timer) return;
    void runIfDue();
    timer = setIntervalFn(() => { void runIfDue(); }, intervalMs);
    timer.unref?.();
  }

  async function stop(): Promise<void> {
    if (timer) clearIntervalFn(timer);
    timer = null;
    if (activeRun) await activeRun;
  }

  return { start, stop, runIfDue };
}

const defaultGuruHoldingsRefreshMonitor = createGuruHoldingsRefreshMonitor();
export const startGuruHoldingsRefreshMonitor = defaultGuruHoldingsRefreshMonitor.start;
export const stopGuruHoldingsRefreshMonitor = defaultGuruHoldingsRefreshMonitor.stop;
export const runGuruHoldingsRefreshIfDue = defaultGuruHoldingsRefreshMonitor.runIfDue;
