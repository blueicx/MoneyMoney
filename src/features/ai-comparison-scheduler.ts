import { randomUUID } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';

type Store = Pick<SQLiteStateStore, 'get' | 'set' | 'transaction' | 'acquireLease' | 'refreshLease' | 'releaseLease' | 'getLease' | 'health'>;
export const COMPARISON_MARKETS = ['stocks', 'options', 'crypto', 'prediction'] as const;
export type ComparisonMarket = typeof COMPARISON_MARKETS[number];
export interface AutomaticComparisonGroup {
  market: ComparisonMarket; groupId: string; model: string; instruments: string[]; excluded: string[];
  paused: boolean; generation: number; cursor: number; createdAt: string;
}
export interface AutomaticComparisonRound {
  id: string; hour: number; market: ComparisonMarket; groupId: string; model: string; instrument: string;
  generation: number; owner: string; at: string; status: 'running' | 'completed' | 'waiting' | 'failed' | 'cancelled';
  reason?: string; finishedAt?: string;
}
interface SchedulerState {
  version: 1; enabled: boolean; notBefore: number; lastHour: number | null; marketCursor: number;
  groups: AutomaticComparisonGroup[]; archived: AutomaticComparisonGroup[]; history: AutomaticComparisonRound[];
}
const KEY = 'ai-comparison-scheduler', LEASE = 'ai-comparison-scheduled-round', HOUR = 3600000;

/** Scheduling metadata only. Accounts, snapshots, quota and fills remain in existing stores.
 * A claimed hour is never replayed after a crash; uncertain model requests are not refunded.
 */
export class ComparisonScheduler {
  constructor(private readonly store: Store) {}
  private read(): SchedulerState {
    this.healthy();
    const state = this.store.get<SchedulerState>(KEY) ?? { version: 1, enabled: false, notBefore: 0, lastHour: null, marketCursor: 0, groups: [], archived: [], history: [] };
    this.healthy();
    if (state.version !== 1 || typeof state.enabled !== 'boolean' || !Number.isFinite(state.notBefore)
      || !Number.isSafeInteger(state.marketCursor) || !Array.isArray(state.groups) || !Array.isArray(state.archived) || !Array.isArray(state.history)
      || (state.lastHour !== null && !Number.isSafeInteger(state.lastHour))
      || new Set(state.groups.map(g => g.market)).size !== state.groups.length
      || state.groups.some(g => !COMPARISON_MARKETS.includes(g.market) || !g.groupId || !g.model || typeof g.paused !== 'boolean'
        || !Number.isSafeInteger(g.generation) || !Number.isSafeInteger(g.cursor) || !Array.isArray(g.instruments) || !g.instruments.length || g.instruments.length > 5)) {
      throw new Error('自动对照状态无法核验，停止调度');
    }
    return state;
  }
  private healthy() { if (!this.store.health.ok) throw new Error('自动对照存储不可用'); }
  private atomic<T>(work: (state: SchedulerState) => T): T {
    return this.store.transaction(() => {
      // First operation is a SQLite write: obtain the writer lock BEFORE reading cursors.
      const owner = randomUUID();
      if (!this.store.acquireLease(KEY + ':mutation', owner, Date.now(), 10000)) throw new Error('自动对照配置正在更新');
      try { const state = this.read(), result = work(state); this.store.set(KEY, state, 1); return result; }
      finally { this.store.releaseLease(KEY + ':mutation', owner); }
    });
  }
  list() { return this.read(); }
  register(input: { market: ComparisonMarket; groupId: string; model: string; instruments: string[]; excluded?: string[] }, now = Date.now()) {
    if (!COMPARISON_MARKETS.includes(input.market)) throw new Error('自动对照市场无效');
    if (!input.model?.trim() || input.model.length > 160) throw new Error('自动对照必须固定有效模型');
    if (!input.groupId || !Number.isFinite(now)) throw new Error('自动对照配置无效');
    if (!Array.isArray(input.instruments) || input.instruments.length < 1 || input.instruments.length > 5
      || input.instruments.some(id => typeof id !== 'string' || !id.trim()) || new Set(input.instruments).size !== input.instruments.length) throw new Error('冻结标的必须为1–5个不同身份');
    return this.atomic(state => {
      const old = state.groups.find(g => g.market === input.market);
      if (old) state.archived.unshift({ ...old, paused: true });
      const group: AutomaticComparisonGroup = { ...input, instruments: [...input.instruments], excluded: [...(input.excluded ?? [])],
        paused: true, generation: (old?.generation ?? 0) + 1, cursor: 0, createdAt: new Date(now).toISOString() };
      state.groups = [...state.groups.filter(g => g.market !== input.market), group];
      // Initial registration is eligible after global enable; rebuild requires explicit resume.
      if (!old && !state.enabled) group.paused = false;
      return group;
    });
  }
  setEnabled(enabled: boolean, now = Date.now()) {
    if (typeof enabled !== 'boolean' || !Number.isFinite(now)) throw new Error('自动对照开关无效');
    return this.atomic(state => {
      if (state.enabled !== enabled) {
        state.enabled = enabled;
        state.notBefore = (Math.floor(now / HOUR) + 1) * HOUR;
        // Disable+enable during preparation MUST invalidate the old execution token.
        for (const group of state.groups) group.generation++;
      }
      return state;
    });
  }
  pause(market: ComparisonMarket, paused: boolean, now = Date.now()) {
    if (typeof paused !== 'boolean' || !Number.isFinite(now)) throw new Error('暂停参数无效');
    return this.atomic(state => {
      const group = state.groups.find(g => g.market === market); if (!group) throw new Error('市场对照未创建');
      if (group.paused !== paused) { group.paused = paused; group.generation++; }
      if (!paused) state.notBefore = Math.max(state.notBefore, (Math.floor(now / HOUR) + 1) * HOUR);
      return group;
    });
  }
  claim(owner: string, now = Date.now()): AutomaticComparisonRound | null {
    if (!owner || !Number.isFinite(now)) throw new Error('调度时间或持有者无效');
    const initial = this.read();
    if (!initial.enabled || now < initial.notBefore || (initial.lastHour !== null && Math.floor(now / HOUR) <= initial.lastHour)) return null;
    return this.atomic(state => {
      const hour = Math.floor(now / HOUR);
      if (!state.enabled || now < state.notBefore || (state.lastHour !== null && hour <= state.lastHour)) return null;
      const markets = COMPARISON_MARKETS.map((_, n) => COMPARISON_MARKETS[(state.marketCursor + n) % 4]);
      const group = markets.map(m => state.groups.find(g => g.market === m && !g.paused)).find(g => !!g);
      if (!group || !this.store.acquireLease(LEASE, owner, now, 120000)) return null;
      for (const previous of state.history.filter(r => r.status === 'running')) {
        previous.status = 'cancelled'; previous.reason = '上轮进程中断或租约到期；不重放不确定的模型请求'; previous.finishedAt = new Date(now).toISOString();
      }
      const round: AutomaticComparisonRound = { id: 'auto:' + hour + ':' + group.groupId, hour, market: group.market,
        groupId: group.groupId, model: group.model, instrument: group.instruments[group.cursor % group.instruments.length],
        generation: group.generation, owner, at: new Date(now).toISOString(), status: 'running' };
      group.cursor = (group.cursor + 1) % group.instruments.length;
      state.marketCursor = (COMPARISON_MARKETS.indexOf(group.market) + 1) % 4;
      state.lastHour = hour; state.history = [round, ...state.history].slice(0, 720);
      return round;
    });
  }
  assertCurrent(round: AutomaticComparisonRound, now = Date.now()) {
    const state = this.read(), group = state.groups.find(g => g.market === round.market), lease = this.store.getLease(LEASE, now);
    if (!state.enabled || !group || group.paused || group.groupId !== round.groupId || group.generation !== round.generation
      || group.model !== round.model || !state.history.some(r => r.id === round.id && r.status === 'running')) throw new Error('自动对照已暂停或配置改变，拒绝迟到成交');
    if (!lease || lease.expired || lease.owner !== round.owner) throw new Error('自动对照租约已失效，拒绝迟到成交');
  }
  heartbeat(round: AutomaticComparisonRound, now = Date.now()) {
    this.assertCurrent(round, now);
    if (!this.store.refreshLease(LEASE, round.owner, now, 120000)) throw new Error('自动对照租约已失效');
  }
  finish(round: AutomaticComparisonRound, status: Exclude<AutomaticComparisonRound['status'], 'running'>, reason: string, now = Date.now()) {
    return this.atomic(state => {
      const stored = state.history.find(r => r.id === round.id && r.owner === round.owner);
      if (stored?.status === 'running') { stored.status = status; stored.reason = reason.slice(0, 500); stored.finishedAt = new Date(now).toISOString(); }
      this.store.releaseLease(LEASE, round.owner);
      return stored;
    });
  }
}
