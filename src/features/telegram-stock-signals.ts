import type { AssistantAction, StockSignalCandidateAnalysis } from './trade-assistant';
import type {
  TelegramMoverSourceStatus,
  TelegramStockSignalCandidate,
  TelegramStockSignalUniverse,
} from './telegram-stock-signal-universe';

export type TelegramStockSignalRowStatus = 'pending' | 'ready' | 'unavailable';
export type TelegramStockSignalScanStatus = 'discovering' | 'scanning' | 'partial' | 'complete' | 'failed';

export interface TelegramStockSignalRow {
  candidate: TelegramStockSignalCandidate;
  status: TelegramStockSignalRowStatus;
  dataStatus?: StockSignalCandidateAnalysis['dataStatus'];
  action: AssistantAction | null;
  source: string;
  updatedAt: string | null;
  reason?: string;
}

export interface TelegramStockSignalSnapshot {
  chatId: string;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: TelegramStockSignalScanStatus;
  scanned: number;
  candidates: TelegramStockSignalRow[];
  moverStatus: TelegramMoverSourceStatus;
  reason?: string;
}

export interface TelegramStockSignalPage {
  snapshot: TelegramStockSignalSnapshot;
  page: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  items: TelegramStockSignalRow[];
}

export interface TelegramStockSignalStore {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
}

export interface TelegramStockSignalScannerOptions {
  store: TelegramStockSignalStore;
  concurrency?: number;
  candidateBudget?: number;
  ttlMs?: number;
  now?: () => number;
}

export interface TelegramStockSignalScanInput {
  initialUniverse: TelegramStockSignalUniverse;
  loadUniverse: () => Promise<TelegramStockSignalUniverse>;
  analyze: (candidate: TelegramStockSignalCandidate) => Promise<StockSignalCandidateAnalysis>;
}

export interface TelegramStockSignalScanJob {
  snapshot: TelegramStockSignalSnapshot;
  completion: Promise<TelegramStockSignalSnapshot>;
}

export function selectTelegramStockSignalAlerts(snapshot: TelegramStockSignalSnapshot): TelegramStockSignalRow[] {
  return snapshot.candidates.filter(row => {
    const identity = row.candidate;
    return row.status === 'ready'
      && (row.action?.action === 'BUY' || row.action?.action === 'SELL')
      && identity.instrumentId === `stock:${identity.market}:${identity.symbol}`;
  });
}

export function telegramStockSignalNotificationKey(chatId: string, snapshot: TelegramStockSignalSnapshot): string {
  return `telegram:stock-signal-push:${String(chatId)}:${snapshot.id}`;
}

const PAGE_SIZE = 8;
const STATE_PREFIX = 'telegram:stock-signal-scan:';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function pendingRows(universe: TelegramStockSignalUniverse): TelegramStockSignalRow[] {
  return universe.candidates.map(candidate => ({
    candidate,
    status: 'pending',
    action: null,
    source: '',
    updatedAt: null,
  }));
}

function sourceLabels(candidate: TelegramStockSignalCandidate): string {
  const labels: Record<string, string> = { fixed: '固定热门', mover: '美股异动', watchlist: '自选' };
  return candidate.sources.map(source => labels[source] || source).join('＋');
}

function sortCompletedCandidates(rows: TelegramStockSignalRow[]): void {
  const sourceRank = (row: TelegramStockSignalRow) => row.candidate.sources.includes('fixed') ? 0
    : row.candidate.sources.includes('mover') ? 1 : 2;
  const signalRank = (row: TelegramStockSignalRow) => row.status !== 'ready' ? 3
    : row.action?.action === 'BUY' ? 0
      : row.action?.action === 'SELL' ? 1
        : 2;
  rows.sort((left, right) => sourceRank(left) - sourceRank(right)
    || signalRank(left) - signalRank(right)
    || (right.action?.confidencePct || 0) - (left.action?.confidencePct || 0)
    || left.candidate.symbol.localeCompare(right.candidate.symbol));
}

function dataStatusLabel(status: TelegramStockSignalRow['dataStatus']): string {
  return ({ live: '实时', delayed: '延迟', cached: '缓存', stale: '缓存过期', unavailable: '来源不可用' } as Record<string, string>)[status || 'unavailable'];
}

function moverStatusLabel(status: TelegramMoverSourceStatus): string {
  const labels: Record<string, string> = {
    pending: '获取中', live: '可用', cached: '缓存数据', stale: '过期缓存', empty: '来源成功但无异动', unavailable: '来源不可用',
  };
  return `${labels[status.state] || status.state}${status.updatedAt ? ` · ${status.updatedAt.slice(0, 16).replace('T', ' ')}` : ''}${status.reason ? ` · ${status.reason}` : ''}`;
}

export function paginateTelegramStockSignals(snapshot: TelegramStockSignalSnapshot, requestedPage: number, pageSize = PAGE_SIZE): TelegramStockSignalPage {
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(20, pageSize) : PAGE_SIZE;
  const totalCount = snapshot.candidates.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / safePageSize));
  const page = Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= pageCount ? requestedPage : 1;
  const start = (page - 1) * safePageSize;
  return {
    snapshot,
    page,
    pageCount,
    pageSize: safePageSize,
    totalCount,
    items: snapshot.candidates.slice(start, start + safePageSize),
  };
}

export function formatTelegramStockSignalPage(page: TelegramStockSignalPage): string {
  const snapshot = page.snapshot;
  const fixedCount = snapshot.candidates.filter(row => row.candidate.sources.includes('fixed')).length;
  const moverCount = snapshot.candidates.filter(row => row.candidate.sources.includes('mover')).length;
  const watchCount = snapshot.candidates.filter(row => row.candidate.sources.includes('watchlist')).length;
  const readyCount = snapshot.candidates.filter(row => row.status === 'ready').length;
  const unavailableCount = snapshot.candidates.filter(row => row.status === 'unavailable').length;
  const statusText = snapshot.status === 'complete' ? '扫描完成'
    : snapshot.status === 'failed' ? '扫描失败'
      : snapshot.status === 'discovering' ? '正在获取异动名单'
        : snapshot.status === 'partial' ? '本轮扫描完成，仍有待扫描项'
        : '扫描进行中';
  const lines = [
    `<b>📡 股票信号 · 第 ${page.page}/${page.pageCount} 页</b> · ${statusText}`,
    `候选 ${page.totalCount} · 已分析 ${snapshot.scanned} · 固定热门 ${fixedCount} · 美股异动 ${moverCount} · 自选 ${watchCount}`,
    `异动来源：${escapeHtml(snapshot.moverStatus.source)} · ${escapeHtml(moverStatusLabel(snapshot.moverStatus))}`,
    '',
  ];
  if (!page.items.length) lines.push('当前没有股票候选。');
  page.items.forEach((row, index) => {
    const number = (page.page - 1) * page.pageSize + index + 1;
    const candidate = row.candidate;
    const label = candidate.name ? `${candidate.name} (${candidate.symbol})` : candidate.symbol;
    const actionText = row.status === 'pending' ? '等待扫描'
      : row.status === 'unavailable' ? '数据不可用'
        : row.action?.actionZh || row.action?.action || 'WAIT';
    const confidence = row.status === 'ready' && row.action ? ` · ${Math.round(row.action.confidencePct)}%` : '';
    const mover = candidate.mover ? ` · 异动 ${candidate.mover.changePct > 0 ? '+' : ''}${candidate.mover.changePct}%` : '';
    lines.push(
      `${number}. <b>${escapeHtml(label)}</b> · ${escapeHtml(actionText)}${confidence}${mover}`,
      `   来源池：${escapeHtml(sourceLabels(candidate))} · 数据：${escapeHtml(dataStatusLabel(row.dataStatus))}`,
      `   ${row.source ? `行情源：${escapeHtml(row.source)}` : '行情源：等待扫描'}${row.updatedAt ? ` · 更新时间：${escapeHtml(row.updatedAt.slice(0, 16).replace('T', ' '))}` : ''}`,
      ...(row.reason ? [`   原因：${escapeHtml(row.reason)}`] : []),
    );
  });
  lines.push('', `状态汇总：可分析 ${readyCount} · 数据不可用 ${unavailableCount} · 待扫描 ${snapshot.candidates.length - readyCount - unavailableCount}`);
  if (snapshot.reason) lines.push(`扫描说明：${escapeHtml(snapshot.reason)}`);
  if (page.page > 1) lines.push(`上一页：/signals ${page.page - 1}`);
  if (page.page < page.pageCount) lines.push(`下一页：/signals ${page.page + 1}`);
  if (snapshot.status === 'partial') lines.push('继续扫描下一批：/signals continue');
  if (snapshot.status === 'complete') lines.push('刷新扫描：/signals refresh');
  lines.push('信号仅作研究信息，不构成投资建议，也不会自动下单。');
  return lines.join('\n');
}

export class TelegramStockSignalScanner {
  private readonly store: TelegramStockSignalStore;
  private readonly concurrency: number;
  private readonly candidateBudget: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly inFlight = new Map<string, Promise<TelegramStockSignalSnapshot>>();
  private activeAnalyses = 0;
  private readonly permitWaiters: Array<() => void> = [];

  constructor(options: TelegramStockSignalScannerOptions) {
    this.store = options.store;
    this.concurrency = Math.max(1, Math.min(8, Math.trunc(options.concurrency || 4)));
    this.candidateBudget = Math.max(1, Math.min(256, Math.trunc(options.candidateBudget || 32)));
    this.ttlMs = Math.max(30_000, options.ttlMs || 15 * 60_000);
    this.now = options.now || Date.now;
  }

  storageKey(chatId: string): string {
    return `${STATE_PREFIX}${encodeURIComponent(String(chatId))}`;
  }

  get(chatId: string): TelegramStockSignalSnapshot | null {
    const snapshot = this.peek(chatId);
    if (!snapshot) return null;
    if (this.now() - Date.parse(snapshot.updatedAt) > this.ttlMs) return null;
    return snapshot;
  }

  private peek(chatId: string): TelegramStockSignalSnapshot | null {
    const snapshot = this.store.get<TelegramStockSignalSnapshot>(this.storageKey(chatId));
    if (!snapshot || snapshot.chatId !== String(chatId)) return null;
    return clone(snapshot);
  }

  start(chatIdInput: string, input: TelegramStockSignalScanInput): TelegramStockSignalScanJob {
    const chatId = String(chatIdInput);
    const active = this.inFlight.get(chatId);
    if (active) {
      const snapshot = this.get(chatId) || this.peek(chatId);
      if (snapshot) return { snapshot, completion: active };
    }
    const nowIso = new Date(this.now()).toISOString();
    const snapshot: TelegramStockSignalSnapshot = {
      chatId,
      id: `${this.now()}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: nowIso,
      updatedAt: nowIso,
      status: 'discovering',
      scanned: 0,
      candidates: pendingRows(input.initialUniverse),
      moverStatus: input.initialUniverse.moverStatus,
    };
    this.save(snapshot);
    const completion = this.run(snapshot, input);
    this.inFlight.set(chatId, completion);
    void completion.finally(() => {
      if (this.inFlight.get(chatId) === completion) this.inFlight.delete(chatId);
    }).catch(() => {});
    return { snapshot: clone(snapshot), completion };
  }

  resume(
    chatIdInput: string,
    analyze: TelegramStockSignalScanInput['analyze'],
  ): TelegramStockSignalScanJob | null {
    const chatId = String(chatIdInput);
    const active = this.inFlight.get(chatId);
    if (active) {
      const snapshot = this.get(chatId) || this.peek(chatId);
      return snapshot ? { snapshot, completion: active } : null;
    }
    const snapshot = this.get(chatId);
    if (!snapshot || snapshot.status === 'complete' || !snapshot.candidates.some(row => row.status === 'pending')) return null;
    const universe: TelegramStockSignalUniverse = {
      candidates: snapshot.candidates.map(row => row.candidate),
      moverStatus: snapshot.moverStatus,
    };
    const input: TelegramStockSignalScanInput = {
      initialUniverse: universe,
      loadUniverse: async () => universe,
      analyze,
    };
    const completion = this.run(snapshot, input);
    this.inFlight.set(chatId, completion);
    void completion.finally(() => {
      if (this.inFlight.get(chatId) === completion) this.inFlight.delete(chatId);
    }).catch(() => {});
    return { snapshot, completion };
  }

  private save(snapshot: TelegramStockSignalSnapshot): void {
    snapshot.updatedAt = new Date(this.now()).toISOString();
    this.store.set(this.storageKey(snapshot.chatId), clone(snapshot));
  }

  private async withPermit<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeAnalyses >= this.concurrency) await new Promise<void>(resolve => this.permitWaiters.push(resolve));
    this.activeAnalyses += 1;
    try { return await operation(); }
    finally {
      this.activeAnalyses -= 1;
      this.permitWaiters.shift()?.();
    }
  }

  private async run(snapshot: TelegramStockSignalSnapshot, input: TelegramStockSignalScanInput): Promise<TelegramStockSignalSnapshot> {
    try {
      const universe = await input.loadUniverse();
      const previous = new Map(snapshot.candidates.map(row => [row.candidate.instrumentId, row]));
      snapshot.candidates = universe.candidates.map(candidate => {
        const existing = previous.get(candidate.instrumentId);
        return existing ? { ...existing, candidate } : {
          candidate, status: 'pending', action: null, source: '', updatedAt: null,
        };
      });
      snapshot.moverStatus = universe.moverStatus;
    } catch (error) {
      snapshot.moverStatus = {
        state: 'unavailable',
        source: snapshot.moverStatus.source || 'Nasdaq Public Screener',
        updatedAt: snapshot.moverStatus.updatedAt,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    snapshot.status = 'scanning';
    this.save(snapshot);
    let nextIndex = 0;
    let scheduled = 0;
    const workerCount = Math.min(this.concurrency, this.candidateBudget, snapshot.candidates.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < snapshot.candidates.length) {
        const index = nextIndex++;
        const row = snapshot.candidates[index];
        if (row.status !== 'pending') continue;
        if (scheduled >= this.candidateBudget) break;
        scheduled += 1;
        try {
          const result = await this.withPermit(() => input.analyze(row.candidate));
          snapshot.candidates[index] = {
            candidate: result.candidate,
            status: result.status,
            dataStatus: result.dataStatus,
            action: result.action,
            source: result.source,
            updatedAt: result.updatedAt,
            ...(result.reason ? { reason: result.reason } : {}),
          };
        } catch (error) {
          snapshot.candidates[index] = {
            ...row,
            status: 'unavailable',
            dataStatus: 'unavailable',
            reason: error instanceof Error ? error.message : String(error),
          };
        }
        snapshot.scanned += 1;
        this.save(snapshot);
      }
    }));
    const hasPending = snapshot.candidates.some(row => row.status === 'pending');
    snapshot.status = hasPending ? 'partial' : 'complete';
    snapshot.reason = hasPending
      ? `本轮已分析 ${scheduled} 个候选，达到单轮请求预算；剩余 ${snapshot.candidates.filter(row => row.status === 'pending').length} 个待扫描。`
      : undefined;
    if (!hasPending) sortCompletedCandidates(snapshot.candidates);
    this.save(snapshot);
    return clone(snapshot);
  }
}
