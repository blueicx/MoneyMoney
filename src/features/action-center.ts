import type { SQLiteStateStore } from '../storage/sqlite-state';
import { assertMarketContext, type MarketId } from './research-contracts';

export interface ActionCenterItem {
  id: string; market: MarketId; instrument?: string; kind: 'price' | 'event' | 'alert' | 'screener' | '13f' | 'review' | 'signal' | 'source';
  title: string; summary?: string; occurredAt?: string; publishedAt?: string; observedAt: string;
  source: string; sourceUrl?: string; dataStatus: string; reason?: string; evidenceRefs: string[];
  eventId?: string; decisionId?: string; signalId?: string; experimentId?: string;
}
export interface ActionCenterState { read: boolean; pinned: boolean; snoozedUntil: string | null; updatedAt: string }
export class ActionCenterStore {
  constructor(private readonly store: SQLiteStateStore) {}
  states(owner: string): Record<string, ActionCenterState> { return this.store.get(`action-center:states:${owner}`) || {}; }
  update(owner: string, item: ActionCenterItem, change: Partial<Pick<ActionCenterState, 'read' | 'pinned' | 'snoozedUntil'>>, now = new Date().toISOString()): ActionCenterState {
    assertMarketContext({ market: item.market, instrument: item.instrument, workspace: 'action-center' });
    if (change.read !== undefined && typeof change.read !== 'boolean' || change.pinned !== undefined && typeof change.pinned !== 'boolean') throw new Error('处理状态必须为布尔值');
    if (change.snoozedUntil != null && (!Number.isFinite(Date.parse(change.snoozedUntil)) || Date.parse(change.snoozedUntil) <= Date.parse(now) || Date.parse(change.snoozedUntil) > Date.parse(now) + 30 * 86400_000)) throw new Error('稍后处理时间必须在未来30天内');
    return this.store.transaction(() => {
      const states = this.states(owner);
      const previous = states[item.id] || { read: false, pinned: false, snoozedUntil: null, updatedAt: '' };
      const state: ActionCenterState = { ...previous, ...change, updatedAt: now };
      const entries = Object.entries({ ...states, [item.id]: state }).sort((a,b) => a[1].updatedAt.localeCompare(b[1].updatedAt)).slice(-5000);
      this.store.set(`action-center:states:${owner}`, Object.fromEntries(entries));
      this.store.appendAudit({ id: `action:${owner}:${item.id}:${now}`, action: 'action_center_update', detail: JSON.stringify({ owner, id: item.id, market: item.market, ...change }), at: now });
      return state;
    });
  }
}
export function buildActionCenter(input: ActionCenterItem[], options: { market?: MarketId; now?: string; states?: Record<string, ActionCenterState> } = {}) {
  const now = options.now || new Date().toISOString(), nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('行动中心时间无效');
  const unique = new Map<string, ActionCenterItem>();
  for (const item of input) {
    if (options.market && item.market !== options.market) continue;
    try { assertMarketContext({ market: item.market, instrument: item.instrument, workspace: 'action-center' }); } catch { continue; }
    if (!item.id || !item.title || !Number.isFinite(Date.parse(item.observedAt))) continue;
    const occurred = Date.parse(item.occurredAt || item.publishedAt || item.observedAt);
    if (occurred > nowMs + 7 * 86400_000) continue;
    let sourceUrl: string | undefined;
    try { const url = new URL(item.sourceUrl || ''); if (['https:', 'http:'].includes(url.protocol)) sourceUrl = url.href; } catch {}
    unique.set(item.id, { ...item, sourceUrl });
  }
  const items = [...unique.values()].map(item => {
    const state = options.states?.[item.id] || { read: false, pinned: false, snoozedUntil: null, updatedAt: '' };
    const section = ['review','alert','screener','13f'].includes(item.kind) ? item.kind : Date.parse(item.occurredAt || item.publishedAt || item.observedAt) > nowMs ? 'upcoming' : 'changes';
    return { ...item, ...state, section, snoozed: Boolean(state.snoozedUntil && Date.parse(state.snoozedUntil) > nowMs) };
  }).sort((a,b) => Number(b.pinned) - Number(a.pinned) || Number(a.read) - Number(b.read) || b.observedAt.localeCompare(a.observedAt));
  return { items, updatedAt: now, counts: { total: items.length, unread: items.filter(x => !x.read && !x.snoozed).length, upcoming: items.filter(x => x.section === 'upcoming').length }, dataStatus: items.length ? 'cached' : 'empty', reason: items.length ? null : '当前自选尚无可处理记录；可查看各标的来源与覆盖情况' };
}
