import type { MarketId } from './research-contracts';

export type CanaryDataStatus = 'live' | 'delayed' | 'cached' | 'partial' | 'empty' | 'unavailable' | 'unsupported' | 'failed';

export interface DataCoverageCanaryTarget {
  market: MarketId;
  instrument: string;
  label: string;
  requiredCapabilities?: string[];
}

export interface CanaryCapabilityResult {
  status: CanaryDataStatus;
  source: string;
  updatedAt?: string | null;
  retrievedAt?: string | null;
  count?: number | null;
  coverage?: { from?: string | null; to?: string | null };
  reason?: string | null;
}

export interface DataCoverageCanaryResult extends DataCoverageCanaryTarget {
  status: CanaryDataStatus;
  checkedAt: string;
  durationMs: number;
  capabilities: Record<string, CanaryCapabilityResult>;
  reason: string | null;
}

export interface DataCoverageCanaryRun {
  id: string;
  startedAt: string;
  completedAt: string;
  status: CanaryDataStatus;
  durationMs: number;
  results: DataCoverageCanaryResult[];
  marketReasons?: Partial<Record<MarketId, { status: CanaryDataStatus; source?: string; reason: string }>>;
  summary: {
    total: number;
    byMarket: Record<MarketId, number>;
    byStatus: Record<CanaryDataStatus, number>;
  };
}

export interface DataCoverageCanaryStore {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, version?: number): void;
  acquireLease(key: string, owner: string, now?: number, leaseMs?: number): boolean;
  releaseLease(key: string, owner: string): boolean;
}

export type DataCoverageCanaryCheck = (target: DataCoverageCanaryTarget) => Promise<{
  capabilities: Record<string, CanaryCapabilityResult>;
  reason?: string | null;
}>;

export const DEFAULT_DATA_COVERAGE_CANARY_TARGETS: readonly DataCoverageCanaryTarget[] = [
  { market: 'stocks', instrument: 'stock:us:AAPL', label: 'AAPL · 大型股', requiredCapabilities: ['quote', 'bars'] },
  { market: 'stocks', instrument: 'stock:us:SNDK', label: 'SNDK · 非七姐妹', requiredCapabilities: ['quote', 'bars'] },
  { market: 'stocks', instrument: 'stock:us:MU', label: 'MU · 半导体', requiredCapabilities: ['quote', 'bars'] },
  { market: 'stocks', instrument: 'stock:us:SPY', label: 'SPY · ETF', requiredCapabilities: ['quote', 'bars'] },
  { market: 'stocks', instrument: 'stock:us:F', label: 'F · 非七姐妹', requiredCapabilities: ['quote', 'bars'] },
  { market: 'options', instrument: 'option:cboe:SPY', label: 'SPY · CBOE 期权链', requiredCapabilities: ['optionsChain'] },
  { market: 'crypto', instrument: 'crypto:binance:BTCUSDT', label: 'BTC/USDT · Binance', requiredCapabilities: ['bars'] },
  { market: 'crypto', instrument: 'crypto:binance:ETHUSDT', label: 'ETH/USDT · Binance', requiredCapabilities: ['bars'] },
];

const MARKETS: readonly MarketId[] = ['stocks', 'options', 'crypto', 'prediction'];
const STORE_KEYS = {
  targets: 'data-coverage-canary:targets',
  runs: 'data-coverage-canary:runs',
  lastDailyRunAt: 'data-coverage-canary:last-daily-run-at',
} as const;
const LEASE_KEY = 'data-coverage-canary:run';
const LEASE_MS = 20 * 60_000;
const MAX_TARGETS = 32;
const MAX_RUNS = 90;
const STATUS_ORDER: readonly CanaryDataStatus[] = ['live', 'delayed', 'cached', 'partial', 'empty', 'unavailable', 'unsupported', 'failed'];

export function validateCanaryTarget(target: DataCoverageCanaryTarget): DataCoverageCanaryTarget {
  if (!target || !MARKETS.includes(target.market)) throw new Error('Canary target must declare a valid market');
  const instrument = String(target.instrument || '').trim();
  const identity = instrument.match(/^([^:]+):([^:]+):(.+)$/);
  const expectedType: Record<MarketId, string> = { stocks: 'stock', options: 'option', crypto: 'crypto', prediction: 'prediction' };
  if (!identity || identity[1] !== expectedType[target.market] || !identity[2].trim() || !identity[3].trim()) {
    throw new Error(`Canary instrument does not belong to market ${target.market}`);
  }
  const label = String(target.label || '').trim();
  if (!label) throw new Error('Canary target label is required');
  const requiredCapabilities = [...new Set((target.requiredCapabilities || []).map(value => String(value).trim()).filter(Boolean))];
  return { market: target.market, instrument, label, ...(requiredCapabilities.length ? { requiredCapabilities } : {}) };
}

function localShanghaiParts(value: Date): { date: string; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hhmm: `${part('hour')}:${part('minute')}` };
}

export function shouldRunOncePerShanghaiDay(lastCompletedAt: string | null | undefined, now: Date, after = '09:00'): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  const current = localShanghaiParts(now);
  if (current.hhmm < after) return false;
  if (!lastCompletedAt) return true;
  const lastTime = Date.parse(lastCompletedAt);
  if (!Number.isFinite(lastTime)) return true;
  return localShanghaiParts(new Date(lastTime)).date !== current.date;
}

function capabilityStatus(capabilities: Record<string, CanaryCapabilityResult>, required: string[] = []): CanaryDataStatus {
  if (required.some(name => !capabilities[name])) return 'unavailable';
  const entries = (required.length ? required.map(name => capabilities[name]) : Object.values(capabilities));
  if (!entries.length) return 'unavailable';
  const statuses = entries.map(item => item.status);
  if (statuses.includes('failed')) return statuses.every(item => item === 'failed') ? 'failed' : 'partial';
  const usable = statuses.filter(item => item === 'live' || item === 'delayed' || item === 'cached');
  if (usable.length === statuses.length) return statuses.includes('cached') ? 'cached' : statuses.includes('delayed') ? 'delayed' : 'live';
  if (usable.length) return 'partial';
  if (statuses.every(item => item === 'empty')) return 'empty';
  if (statuses.every(item => item === 'unsupported')) return 'unsupported';
  if (statuses.every(item => item === 'unavailable')) return 'unavailable';
  return 'partial';
}

function aggregateStatuses(statuses: readonly CanaryDataStatus[]): CanaryDataStatus {
  if (!statuses.length) return 'empty';
  const usable = statuses.filter(status => status === 'live' || status === 'delayed' || status === 'cached');
  if (usable.length) {
    if (usable.length !== statuses.length) return 'partial';
    return statuses.includes('cached') ? 'cached' : statuses.includes('delayed') ? 'delayed' : 'live';
  }
  if (statuses.every(status => status === 'failed')) return 'failed';
  if (statuses.every(status => status === 'unsupported')) return 'unsupported';
  if (statuses.every(status => status === 'empty')) return 'empty';
  if (statuses.every(status => status === 'unavailable')) return 'unavailable';
  return 'partial';
}

export interface CoverageCanaryHistoryTarget {
  market: MarketId;
  instrument: string;
  label: string;
  checks: number;
  availabilityPct: number;
  latestCheckedAt: string;
  status: CanaryDataStatus;
  capabilities: Record<string, {
    checks: number;
    lastStatus: CanaryDataStatus;
    source: string;
    updatedAt: string | null;
    retrievedAt: string | null;
    count: number | null;
    coverage: { from: string | null; to: string | null } | null;
    reason: string | null;
  }>;
}

export function summarizeCoverageCanaryHistory(
  runs: readonly DataCoverageCanaryRun[],
  windowDays: number,
  now = new Date(),
): CoverageCanaryHistoryTarget[] {
  const days = Math.max(1, Math.min(30, Math.trunc(windowDays)));
  const cutoff = now.getTime() - days * 86_400_000;
  const observations = runs.flatMap(run => {
    const completed = Date.parse(run.completedAt);
    return Number.isFinite(completed) && completed >= cutoff && completed <= now.getTime()
      ? run.results : [];
  });
  const byTarget = new Map<string, DataCoverageCanaryResult[]>();
  for (const row of observations) {
    const key = `${row.market}\0${row.instrument}`;
    const group = byTarget.get(key) || [];
    group.push(row);
    byTarget.set(key, group);
  }
  const usable = (status: CanaryDataStatus) => ['live', 'delayed', 'cached'].includes(status);
  const latestValid = (values: Array<string | null | undefined>) => values
    .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(String(value))))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1) || null;
  return [...byTarget.values()].map(rows => {
    rows.sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
    const last = rows.at(-1)!;
    const names = new Set(rows.flatMap(row => Object.keys(row.capabilities)));
    const capabilities = Object.fromEntries([...names].sort().map(name => {
      const samples = rows.map(row => row.capabilities[name]).filter((item): item is CanaryCapabilityResult => Boolean(item));
      const current = samples.at(-1)!;
      const dates = samples.flatMap(item => [item.coverage?.from, item.coverage?.to]).filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(String(value))));
      return [name, {
        checks: samples.length,
        lastStatus: current.status,
        source: current.source,
        updatedAt: latestValid(samples.map(item => item.updatedAt)),
        retrievedAt: latestValid(samples.map(item => item.retrievedAt)),
        count: current.count ?? null,
        coverage: dates.length ? {
          from: [...dates].sort((a, b) => Date.parse(a) - Date.parse(b))[0],
          to: [...dates].sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)!,
        } : null,
        reason: current.reason || null,
      }];
    }));
    const status: CanaryDataStatus = last.status;
    return {
      market: last.market,
      instrument: last.instrument,
      label: last.label,
      checks: rows.length,
      availabilityPct: Math.round(rows.filter(row => usable(row.status)).length / rows.length * 10_000) / 100,
      latestCheckedAt: last.checkedAt,
      status,
      capabilities,
    };
  }).sort((a, b) => a.market.localeCompare(b.market) || a.instrument.localeCompare(b.instrument));
}

function summarize(results: DataCoverageCanaryResult[]): DataCoverageCanaryRun['summary'] {
  const byMarket = Object.fromEntries(MARKETS.map(market => [market, 0])) as Record<MarketId, number>;
  const byStatus = Object.fromEntries(STATUS_ORDER.map(status => [status, 0])) as Record<CanaryDataStatus, number>;
  for (const result of results) {
    byMarket[result.market] += 1;
    byStatus[result.status] += 1;
  }
  return { total: results.length, byMarket, byStatus };
}

export function toPublicCoverageCanarySummary(run: DataCoverageCanaryRun | null): Record<string, unknown> {
  if (!run) return { status: 'empty', completedAt: null, total: 0, byMarket: Object.fromEntries(MARKETS.map(market => [market, 0])), byStatus: null, reason: '尚无覆盖巡检记录' };
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    total: run.summary.total,
    byMarket: run.summary.byMarket,
    byStatus: run.summary.byStatus,
    marketStatus: Object.fromEntries(MARKETS.map(market => {
      const rows = run.results.filter(item => item.market === market);
      const reason = run.marketReasons?.[market];
      const status = rows.length ? aggregateStatuses(rows.map(item => item.status)) : reason?.status || 'empty';
      return [market, {
        checked: rows.length,
        status,
        reason: rows.length ? status === 'partial' ? '该市场部分标的或来源存在缺口' : null : reason?.status === 'unavailable' || reason?.status === 'failed'
          ? '该市场当前数据来源不可用'
          : reason?.status === 'unsupported' ? '当前数据源不支持该市场能力'
            : reason?.status === 'partial' ? '部分来源不可用，暂未找到可核验的活动事件'
              : '当前没有可巡检的有效标的',
      }];
    })),
    reason: run.summary.total ? null : '本次巡检没有可核验的标的结果',
  };
}

export class DataCoverageCanary {
  private readonly owner: string;
  private running = false;

  constructor(
    private readonly store: DataCoverageCanaryStore,
    private readonly check: DataCoverageCanaryCheck,
    options: { owner?: string } = {},
  ) {
    this.owner = options.owner || `coverage-canary-${process.pid}`;
  }

  listTargets(): DataCoverageCanaryTarget[] {
    const stored = this.store.get<DataCoverageCanaryTarget[]>(STORE_KEYS.targets);
    return (Array.isArray(stored) ? stored : [...DEFAULT_DATA_COVERAGE_CANARY_TARGETS]).map(validateCanaryTarget);
  }

  saveTargets(targets: DataCoverageCanaryTarget[]): DataCoverageCanaryTarget[] {
    if (!Array.isArray(targets) || !targets.length || targets.length > MAX_TARGETS) throw new Error(`Canary target count must be between 1 and ${MAX_TARGETS}`);
    const normalized = targets.map(validateCanaryTarget);
    const unique = new Map(normalized.map(target => [`${target.market}\0${target.instrument}`, target]));
    if (unique.size !== normalized.length) throw new Error('Duplicate market/instrument canary target');
    this.store.set(STORE_KEYS.targets, normalized, 1);
    return normalized;
  }

  listRuns(limit = 30): DataCoverageCanaryRun[] {
    const runs = this.store.get<DataCoverageCanaryRun[]>(STORE_KEYS.runs) || [];
    return runs.slice(-Math.max(1, Math.min(90, Number(limit) || 30))).reverse();
  }

  private async withLease<T>(now: Date, execute: () => Promise<T>): Promise<T> {
    if (this.running || !this.store.acquireLease(LEASE_KEY, this.owner, now.getTime(), LEASE_MS)) {
      throw new Error('Data coverage canary is already running');
    }
    this.running = true;
    try {
      return await execute();
    } finally {
      this.running = false;
      this.store.releaseLease(LEASE_KEY, this.owner);
    }
  }

  private async execute(
    targets: DataCoverageCanaryTarget[],
    now: Date,
    context: { marketReasons?: DataCoverageCanaryRun['marketReasons']; dailyRun?: boolean } = {},
  ): Promise<DataCoverageCanaryRun> {
    const checkedTargets = targets.map(validateCanaryTarget);
    if (!checkedTargets.length || checkedTargets.length > MAX_TARGETS) throw new Error(`Canary target count must be between 1 and ${MAX_TARGETS}`);
    const uniqueTargets = new Set(checkedTargets.map(target => `${target.market}\0${target.instrument}`));
    if (uniqueTargets.size !== checkedTargets.length) throw new Error('Duplicate market/instrument canary target');
    const startedMs = now.getTime();
    const results: DataCoverageCanaryResult[] = [];
    for (const target of checkedTargets) {
      const checkedAt = new Date().toISOString();
      const itemStarted = Date.now();
      try {
        const observation = await this.check(target);
        const capabilities = { ...(observation?.capabilities || {}) };
        for (const name of target.requiredCapabilities || []) {
          if (!capabilities[name]) capabilities[name] = { status: 'unavailable', source: 'required capability check', reason: '必需能力未返回巡检结果' };
        }
        for (const [name, item] of Object.entries(capabilities)) {
          if (!name.trim() || !item || !STATUS_ORDER.includes(item.status) || !String(item.source || '').trim()) {
            throw new Error(`Invalid coverage observation for ${name || 'unknown capability'}`);
          }
          if (item.updatedAt && !Number.isFinite(Date.parse(item.updatedAt))) throw new Error(`Invalid updatedAt for ${name}`);
          if (item.count != null && (!Number.isFinite(item.count) || item.count < 0)) throw new Error(`Invalid row count for ${name}`);
        }
        const status = capabilityStatus(capabilities, target.requiredCapabilities);
        const failedReasons = Object.values(capabilities).filter(item => item.status === 'unavailable' || item.status === 'failed').map(item => item.reason).filter(Boolean);
        results.push({
          ...target, status, checkedAt, durationMs: Math.max(0, Date.now() - itemStarted), capabilities,
          reason: observation.reason || (status === 'empty' ? '来源成功响应，但没有返回数据' : failedReasons.join('；') || null),
        });
      } catch (error: any) {
        results.push({ ...target, status: 'failed', checkedAt, durationMs: Math.max(0, Date.now() - itemStarted), capabilities: {}, reason: error?.message || '覆盖巡检失败' });
      }
    }
    const completedAt = new Date().toISOString();
    const summary = summarize(results);
    const statuses = [
      ...results.map(item => item.status),
      ...Object.values(context.marketReasons || {}).map(item => item.status),
    ];
    const status = aggregateStatuses(statuses);
    const run: DataCoverageCanaryRun = {
      id: `coverage-canary-${startedMs}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: new Date(startedMs).toISOString(), completedAt, status,
      durationMs: Math.max(0, Date.parse(completedAt) - startedMs), results, summary,
      ...(context.marketReasons ? { marketReasons: context.marketReasons } : {}),
    };
    const history = this.store.get<DataCoverageCanaryRun[]>(STORE_KEYS.runs) || [];
    this.store.set(STORE_KEYS.runs, [...history, run].slice(-MAX_RUNS), 1);
    if (context.dailyRun) this.store.set(STORE_KEYS.lastDailyRunAt, completedAt, 1);
    return run;
  }

  run(targets: DataCoverageCanaryTarget[] = this.listTargets(), now = new Date(), context: { marketReasons?: DataCoverageCanaryRun['marketReasons'] } = {}): Promise<DataCoverageCanaryRun> {
    return this.withLease(now, () => this.execute(targets, now, context));
  }

  async runIfDue(
    now = new Date(),
    resolve?: () => Promise<{ targets: DataCoverageCanaryTarget[]; marketReasons?: DataCoverageCanaryRun['marketReasons'] }>,
  ): Promise<DataCoverageCanaryRun | null> {
    if (!shouldRunOncePerShanghaiDay(this.store.get<string>(STORE_KEYS.lastDailyRunAt), now)) return null;
    return this.runResolved(resolve || (async () => ({ targets: this.listTargets() })), now, { dailyRun: true });
  }

  async runResolved(
    resolve: () => Promise<{ targets: DataCoverageCanaryTarget[]; marketReasons?: DataCoverageCanaryRun['marketReasons'] }>,
    now = new Date(),
    options: { dailyRun?: boolean } = {},
  ): Promise<DataCoverageCanaryRun> {
    return this.withLease(now, async () => {
      const dynamic = await resolve();
      return this.execute(dynamic.targets, now, { marketReasons: dynamic.marketReasons, dailyRun: options.dailyRun });
    });
  }
}
