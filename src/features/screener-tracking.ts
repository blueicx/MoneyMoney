import crypto from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';
import { filterRows, type ScreenerTemplate, type ScreenerScope } from './market-screener';
import { diffScreenerMembership } from './workspace-experience';

export interface ScreenerTrackingRecord {
  templateId: string; scope: ScreenerScope; name: string; lastRunAt: string; attemptedAt: string;
  lastStatus: 'baseline' | 'updated' | 'failed'; dataStatus: 'cached' | 'partial' | 'empty' | 'failed';
  reason: string | null; currentIds: string[]; entered: string[]; exited: string[]; unchanged: string[];
  runId?: string; source?: string; updatedAt?: string;
}
interface Control { active: boolean; epoch: number; record: ScreenerTrackingRecord | null }
export class ScreenerTrackingStore {
  constructor(private readonly store: SQLiteStateStore) {
    store.transaction(() => {
      if (store.get('screener:tracking:migrated')) return;
      for (const record of store.get<ScreenerTrackingRecord[]>('screener-tracking-v1') || []) {
        this.putControl(record.templateId, { active: true, epoch: 1, record: { ...record, dataStatus: record.dataStatus === 'failed' || record.dataStatus === 'empty' ? record.dataStatus : 'cached' } });
      }
      store.set('screener:tracking:migrated', true);
    });
  }
  private key(id: string) { return `screener:tracking:${id}`; }
  private control(id: string): Control { return this.store.get<Control>(this.key(id)) || { active: false, epoch: 0, record: null }; }
  private putControl(id: string, value: Control) {
    this.store.set(this.key(id), value);
    const ids = this.store.get<string[]>('screener:tracking:index') || [];
    this.store.set('screener:tracking:index', [...new Set([...ids, id])].slice(-200));
  }
  list(): ScreenerTrackingRecord[] {
    return (this.store.get<string[]>('screener:tracking:index') || []).flatMap(id => {
      const item = this.control(id); return item.active && item.record ? [item.record] : [];
    });
  }
  history(id: string): ScreenerTrackingRecord[] { return this.store.get<ScreenerTrackingRecord[]>(`${this.key(id)}:history`) || []; }
  stop(id: string): boolean {
    return this.store.transaction(() => {
      const item = this.control(id); this.putControl(id, { active: false, epoch: item.epoch + 1, record: null });
      return item.active;
    });
  }
  claimNotification(record: ScreenerTrackingRecord): boolean {
    if (record.lastStatus !== 'updated' || (!record.entered.length && !record.exited.length) || !record.runId) return false;
    return this.store.transaction(() => {
      const key = `screener:notification:${record.runId}`;
      if (this.store.getIdempotent(key)) return false;
      this.store.setIdempotent(key, { at: new Date().toISOString() }); return true;
    });
  }
  async run(template: ScreenerTemplate & { id: string }, load: () => Promise<Record<string, unknown>[]>, exists: () => boolean = () => true): Promise<{ success: boolean; record?: ScreenerTrackingRecord; busy?: boolean; cancelled?: boolean }> {
    const owner = crypto.randomUUID(), lease = `screener:run:${template.id}`, leaseMs = 120_000;
    if (!this.store.acquireLease(lease, owner, Date.now(), leaseMs)) return { success: false, busy: true };
    const heartbeat = setInterval(() => this.store.refreshLease(lease, owner, Date.now(), leaseMs), 30_000); heartbeat.unref();
    const initial = this.store.transaction(() => {
      const current = this.control(template.id);
      const next = { ...current, active: true, epoch: current.active ? current.epoch : current.epoch + 1 };
      this.putControl(template.id, next); return next;
    });
    const attemptedAt = new Date().toISOString(), existing = initial.record;
    let record: ScreenerTrackingRecord = {
      templateId: template.id, scope: template.scope, name: template.name, attemptedAt,
      lastRunAt: existing?.lastRunAt || '', lastStatus: 'failed', dataStatus: 'failed', reason: null,
      currentIds: existing?.currentIds || [], entered: [], exited: [], unchanged: existing?.currentIds || [], runId: owner,
    };
    try {
      const raw = await load();
      if (!raw.length) {
        record = { ...record, dataStatus: 'empty', reason: '当前筛选来源返回零条原始记录；为避免误报全部退出，保留上次有效基线。' };
      } else if (raw.some(row => row._sourceIncomplete === true)) {
        record = { ...record, dataStatus:'partial', reason:'部分筛选来源失败；保留有效基线，不把缺失记录判定为退出。' };
      } else {
        const valid = raw.filter(row => typeof row.id === 'string' && String(row.id).startsWith(`${template.scope === 'stocks' ? 'stock' : template.scope === 'options' ? 'option' : template.scope === 'crypto' ? 'crypto' : 'prediction'}:`));
        if (valid.length !== raw.length) throw new Error('筛选来源返回跨市场或缺少身份的记录，已隔离；保留上次有效基线');
        const ids = [...new Set(filterRows(template.scope, valid, template.filters).map(row => String(row.id)))].sort();
        record = { ...record, lastRunAt: attemptedAt, lastStatus: existing?.lastRunAt ? 'updated' : 'baseline', dataStatus: 'cached',
          currentIds: ids, ...(existing?.lastRunAt ? diffScreenerMembership(existing.currentIds, ids) : { entered: [], exited: [], unchanged: ids }),
          source: [...new Set(valid.map(row => String(row.source || '来源未声明')))].join(', '),
          updatedAt: valid.map(row => String(row.dataTime || '')).filter(Boolean).sort().at(-1), reason: '筛选结果来自来源快照；未声明实时能力。' };
      }
    } catch (error) { record.reason = error instanceof Error ? error.message : '筛选来源请求失败；保留上次有效基线。'; }
    finally { clearInterval(heartbeat); }
    try {
      return this.store.transaction(() => {
        const current = this.control(template.id), held = this.store.getLease(lease);
        if (!current.active || current.epoch !== initial.epoch || !exists() || held?.owner !== owner || held.expired) return { success: false, cancelled: true };
        this.putControl(template.id, { ...current, record });
        this.store.set(`${this.key(template.id)}:history`, [...this.history(template.id), record].slice(-100));
        return { success: record.lastStatus !== 'failed', record };
      });
    } finally { this.store.releaseLease(lease, owner); }
  }
}
