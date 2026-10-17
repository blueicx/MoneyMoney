import type { SQLiteStateStore } from '../storage/sqlite-state';
import { assertMarketContext, type MarketId } from './research-contracts';

export interface ActionCenterItem {
  changePct?:number; volumeRatio?:number;
  id: string; market: MarketId; instrument?: string; kind: 'price' | 'event' | 'alert' | 'screener' | '13f' | 'review' | 'signal' | 'source';
  title: string; summary?: string; scheduledAt?: string; occurredAt?: string; publishedAt?: string; observedAt: string;
  source: string; sourceUrl?: string; dataStatus: string; reason?: string; evidenceRefs: string[];
  eventId?: string; decisionId?: string; signalId?: string; experimentId?: string;
}
export interface ActionCenterState { read: boolean; pinned: boolean; snoozedUntil: string | null; updatedAt: string }
export interface ActionCenterHistoryEntry {
  undoOf?:string;
  id: string; itemId: string; title?: string; market: MarketId; instrument?: string;
  changes: Partial<Pick<ActionCenterState, 'read' | 'pinned' | 'snoozedUntil'>>;
  previous: ActionCenterState; next: ActionCenterState; updatedAt: string;
}
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
      const effectiveChange = Object.fromEntries(Object.entries(change).filter(([key, value]) => previous[key as keyof ActionCenterState] !== value)) as typeof change;
      if (!Object.keys(effectiveChange).length) return previous;
      const state: ActionCenterState = { ...previous, ...change, updatedAt: now };
      const entries = Object.entries({ ...states, [item.id]: state }).sort((a,b) => a[1].updatedAt.localeCompare(b[1].updatedAt)).slice(-5000);
      this.store.set(`action-center:states:${owner}`, Object.fromEntries(entries));
      const history = this.store.get<ActionCenterHistoryEntry[]>(`action-center:history:${owner}`) || [];
      history.push({ id: `ach_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, itemId: item.id, title: item.title, market: item.market, instrument: item.instrument, changes: effectiveChange, previous, next: state, updatedAt: now });
      this.store.set(`action-center:history:${owner}`, history.slice(-5000));
      this.store.appendAudit({ id: `action:${owner}:${item.id}:${now}`, action: 'action_center_update', detail: JSON.stringify({ owner, id: item.id, market: item.market, ...change }), at: now });
      return state;
    });
  }
  history(owner: string, options: { itemId?: string; market?: MarketId; limit?: number } = {}): ActionCenterHistoryEntry[] {
    const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit) || 100)));
    const rows = this.store.get<ActionCenterHistoryEntry[]>(`action-center:history:${owner}`) || [];
    return rows.filter(row => (!options.itemId || row.itemId === options.itemId) && (!options.market || row.market === options.market)).slice(-limit).reverse();
  }
  undo(owner:string,historyId:string,expectedUpdatedAt:string):ActionCenterState {
    return this.store.transaction(()=>{
      const key=`action-center:history:${owner}`,history=this.store.get<ActionCenterHistoryEntry[]>(key)||[],entry=history.find(row=>row.id===historyId),states=this.states(owner);
      if(!entry||history.filter(row=>row.itemId===entry.itemId).at(-1)?.id!==entry.id)throw Error('存在后续修改或记录不可用，不能撤销');
      assertMarketContext({market:entry.market,instrument:entry.instrument,workspace:'action-center'});
      const current=states[entry.itemId],previous=entry.previous;
      if(!current||current.updatedAt!==expectedUpdatedAt||JSON.stringify(current)!==JSON.stringify(entry.next))throw Error('处理状态版本已变化，请刷新后重试');
      if(typeof previous?.read!=='boolean'||typeof previous?.pinned!=='boolean'||previous.snoozedUntil!==null&&!Number.isFinite(Date.parse(previous.snoozedUntil)))throw Error('旧状态不完整，不能猜测恢复');
      const now=new Date().toISOString(),next={read:previous.read,pinned:previous.pinned,snoozedUntil:previous.snoozedUntil,updatedAt:now};
      states[entry.itemId]=next;this.store.set(`action-center:states:${owner}`,states);
      history.push({id:`ach_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`,undoOf:entry.id,itemId:entry.itemId,title:entry.title,market:entry.market,instrument:entry.instrument,changes:{read:next.read,pinned:next.pinned,snoozedUntil:next.snoozedUntil},previous:current,next,updatedAt:now});
      this.store.set(key,history.slice(-5000));this.store.appendAudit({id:'action-undo:'+history.at(-1)!.id,action:'action_center_undo',detail:JSON.stringify({id:entry.id,market:entry.market}),at:now});return next;
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
    const relevantAt = Date.parse(item.scheduledAt || item.occurredAt || item.publishedAt || item.observedAt);
    if (relevantAt > nowMs + 7 * 86400_000) continue;
    let sourceUrl: string | undefined;
    try { const url = new URL(item.sourceUrl || ''); if (['https:', 'http:'].includes(url.protocol)) sourceUrl = url.href; } catch {}
    unique.set(item.id, { ...item, sourceUrl });
  }
  const items = [...unique.values()].map(item => {
    const state = options.states?.[item.id] || { read: false, pinned: false, snoozedUntil: null, updatedAt: '' };
    const relevantAt = Date.parse(item.scheduledAt || item.occurredAt || item.publishedAt || item.observedAt);
    const section = ['review','alert','screener','13f'].includes(item.kind) ? item.kind : relevantAt > nowMs ? 'upcoming' : 'changes';
    return { ...item, ...state, section, snoozed: Boolean(state.snoozedUntil && Date.parse(state.snoozedUntil) > nowMs) };
  }).sort((a,b) => Number(b.pinned) - Number(a.pinned) || Number(a.read) - Number(b.read) || b.observedAt.localeCompare(a.observedAt));
  return { items, updatedAt: now, counts: { total: items.length, unread: items.filter(x => !x.read && !x.snoozed).length, upcoming: items.filter(x => x.section === 'upcoming').length }, dataStatus: items.length ? 'cached' : 'empty', reason: items.length ? null : '当前自选尚无可处理记录；可查看各标的来源与覆盖情况' };
}
