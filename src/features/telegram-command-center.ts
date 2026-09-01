import fs from 'node:fs';
import path from 'node:path';
import { stateStore } from '../storage/sqlite-state';

export interface TelegramNotificationPreferences {
  signals: boolean;
  dailyReport: boolean;
  riskAlerts: boolean;
  events: boolean;
  priceAlerts: boolean;
}

export interface TelegramChatPreferences {
  chatId: string;
  notifications: TelegramNotificationPreferences;
  updatedAt: string;
}

export interface TelegramPriceAlert {
  id: string;
  chatId: string;
  symbol: string;
  direction: 'ABOVE' | 'BELOW';
  price: number;
  triggered: boolean;
  createdAt: string;
  triggeredAt?: string;
}

export type TelegramSmartAlertType = 'PROBABILITY' | 'RISK' | 'EVENT' | 'SIGNAL';

export interface TelegramSmartAlert {
  id: string;
  chatId: string;
  type: TelegramSmartAlertType;
  symbol?: string;
  direction?: 'ABOVE' | 'BELOW' | 'WITHIN' | 'REVERSAL';
  threshold?: number;
  enabled: boolean;
  cooldownMinutes: number;
  triggeredCount: number;
  lastTriggeredAt?: string;
  createdAt: string;
}

export interface TelegramAlertPolicy {
  pausedUntil?: string;
  quietHours: { enabled: boolean; start: string; end: string };
  digest: { enabled: boolean; time: string };
}

export interface TelegramJournalEntry {
  id: string;
  chatId: string;
  text: string;
  marketId?: string;
  marketTitle?: string;
  snapshot?: {
    price?: number;
    probabilityPct?: number;
    signal?: string;
    sourceStatus?: string;
    capturedAt?: string;
  };
  createdAt: string;
}

export interface TelegramPendingAction {
  nonce: string;
  chatId: string;
  type: 'paper_open' | 'paper_close' | 'paper_reset';
  marketId?: number;
  outcomeIndex?: 0 | 1;
  outcomeName?: string;
  price?: number;
  amountUsd?: number;
  positionId?: string;
  createdAt: string;
  expiresAt: string;
}

export interface TelegramAuditRecord {
  id: string;
  chatId: string;
  action: string;
  detail: string;
  at: string;
}

interface TelegramCommandCenterState {
  version: 2;
  preferences: Record<string, TelegramChatPreferences>;
  priceAlerts: TelegramPriceAlert[];
  smartAlerts: TelegramSmartAlert[];
  watchlists: Record<string, string[]>;
  policies: Record<string, TelegramAlertPolicy>;
  journal: TelegramJournalEntry[];
  pending: TelegramPendingAction[];
  audits: TelegramAuditRecord[];
}

const DEFAULT_NOTIFICATIONS: TelegramNotificationPreferences = {
  signals: true,
  dailyReport: true,
  riskAlerts: true,
  events: true,
  priceAlerts: true,
};

export function normalizeAlertSymbol(value: string): string {
  const symbol = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!symbol) return '';
  return symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
}

export function parsePriceAlertArgs(args: string[]): Pick<TelegramPriceAlert, 'symbol' | 'direction' | 'price'> | null {
  if (!Array.isArray(args) || args.length !== 3) return null;
  const symbol = normalizeAlertSymbol(args[0]);
  const directionText = String(args[1] || '').toLowerCase();
  const direction = directionText === 'above' || directionText === '高于' ? 'ABOVE'
    : directionText === 'below' || directionText === '低于' ? 'BELOW' : null;
  const price = Number(args[2]);
  if (!symbol || !direction || !Number.isFinite(price) || price <= 0) return null;
  return { symbol, direction, price };
}

export function parseWatchCommandArgs(args: string[]): { action: 'list' | 'add' | 'remove'; marketId?: string } | null {
  const action = String(args?.[0] || 'list').trim().toLowerCase();
  if (action === 'list') return { action: 'list' };
  if (!['add', 'remove', 'del', 'delete'].includes(action)) return null;
  const marketId = String(args?.[1] || '').trim();
  if (!marketId || !/^[a-z0-9:_-]{1,120}$/i.test(marketId)) return null;
  return { action: action === 'add' ? 'add' : 'remove', marketId };
}

export function parseDigestTime(value: string): string | null {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function parseSmartAlertArgs(args: string[]): {
  type: TelegramSmartAlertType;
  symbol?: string;
  direction: 'ABOVE' | 'BELOW' | 'WITHIN' | 'REVERSAL';
  threshold?: number;
} | null {
  const values = (args || []).map(value => String(value || '').trim().toLowerCase());
  if (values[0] === 'risk') {
    const direction = values[1] === 'above' ? 'ABOVE' : values[1] === 'below' ? 'BELOW' : null;
    const threshold = Number(values[2]);
    return direction && Number.isFinite(threshold) && threshold >= 0 && threshold <= 100
      ? { type: 'RISK', direction, threshold }
      : null;
  }
  if (values[0] === 'event' && values[1] === 'within') {
    const threshold = Number(values[2]);
    return Number.isFinite(threshold) && threshold >= 0 && threshold <= 720
      ? { type: 'EVENT', direction: 'WITHIN', threshold }
      : null;
  }
  if (values[0] === 'signal' && ['reversal', 'reverse', '反转'].includes(values[1])) {
    return { type: 'SIGNAL', direction: 'REVERSAL' };
  }
  const symbol = normalizeAlertSymbol(values[0]);
  const type = values[1] === 'probability' || values[1] === 'prob' ? 'PROBABILITY' : null;
  const direction = values[2] === 'above' ? 'ABOVE' : values[2] === 'below' ? 'BELOW' : null;
  const threshold = Number(values[3]);
  if (!symbol || type !== 'PROBABILITY' || !direction || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) return null;
  return { type, symbol, direction, threshold };
}

export function routeNaturalLanguage(input: string): string | null {
  const text = String(input || '').toLowerCase();
  if (/风险|回撤|var|敞口/.test(text)) return 'risk';
  if (/信号|建议|机会/.test(text)) return 'signals';
  if (/事件|日历|财报|美联储|fomc/.test(text)) return 'events';
  if (/持仓|模拟盘|paper|盈亏/.test(text)) return 'paper';
  if (/研究|笔记|workspace/.test(text)) return 'research';
  if (/数据源|健康|连通|source/.test(text)) return 'sources';
  if (/日报|总结|概览|今天/.test(text)) return 'today';
  if (/提醒|通知|订阅/.test(text)) return 'alerts';
  if (/历史|表现|胜率/.test(text)) return 'history';
  return null;
}

export function sparkline(values: number[]): string {
  if (!values.length) return '暂无';
  const glyphs = '▁▂▃▄▅▆▇█';
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return '暂无';
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return glyphs[0].repeat(finite.length);
  return finite.map(value => glyphs[Math.max(0, Math.min(glyphs.length - 1,
    Math.round((value - min) / (max - min) * (glyphs.length - 1))))]).join('');
}

function emptyState(): TelegramCommandCenterState {
  return { version: 2, preferences: {}, priceAlerts: [], smartAlerts: [], watchlists: {}, policies: {}, journal: [], pending: [], audits: [] };
}

function defaultAlertPolicy(): TelegramAlertPolicy {
  return { quietHours: { enabled: false, start: '22:00', end: '07:00' }, digest: { enabled: false, time: '08:30' } };
}

function normalizeMarketId(value: string): string {
  return String(value || '').trim();
}

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export class TelegramCommandCenterStore {
  private state: TelegramCommandCenterState;
  private readonly useSqlite: boolean;
  private readonly stateFile: string;

  constructor(stateFile?: string) {
    this.useSqlite = !stateFile;
    this.stateFile = stateFile || path.resolve('data/telegram-command-center.json');
    this.state = this.load();
  }

  getPreferences(chatId: string): TelegramChatPreferences {
    const id = String(chatId);
    const existing = this.state.preferences[id];
    if (existing) return {
      ...existing,
      notifications: { ...DEFAULT_NOTIFICATIONS, ...existing.notifications },
    };
    const created = { chatId: id, notifications: { ...DEFAULT_NOTIFICATIONS }, updatedAt: new Date().toISOString() };
    this.state.preferences[id] = created;
    this.save();
    return { ...created, notifications: { ...created.notifications } };
  }

  updatePreferences(chatId: string, patch: { notifications?: Partial<TelegramNotificationPreferences> }): TelegramChatPreferences {
    const current = this.getPreferences(chatId);
    const updated: TelegramChatPreferences = {
      ...current,
      ...patch,
      notifications: { ...current.notifications, ...(patch.notifications || {}) },
      updatedAt: new Date().toISOString(),
    };
    this.state.preferences[String(chatId)] = updated;
    this.save();
    return { ...updated, notifications: { ...updated.notifications } };
  }

  listPriceAlerts(chatId?: string): TelegramPriceAlert[] {
    return this.state.priceAlerts
      .filter(alert => chatId == null || alert.chatId === String(chatId))
      .map(alert => ({ ...alert }));
  }

  listSmartAlerts(chatId?: string): TelegramSmartAlert[] {
    return this.state.smartAlerts
      .filter(alert => chatId == null || alert.chatId === String(chatId))
      .map(alert => ({ ...alert }));
  }

  createSmartAlert(chatId: string, input: Omit<TelegramSmartAlert, 'id' | 'chatId' | 'enabled' | 'triggeredCount' | 'createdAt' | 'cooldownMinutes'> & Partial<Pick<TelegramSmartAlert, 'enabled' | 'cooldownMinutes'>>): TelegramSmartAlert {
    const alert: TelegramSmartAlert = {
      ...input,
      id: `sa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      chatId: String(chatId),
      enabled: input.enabled ?? true,
      cooldownMinutes: Math.max(1, Math.min(24 * 60, Number(input.cooldownMinutes || 60))),
      triggeredCount: 0,
      createdAt: new Date().toISOString(),
    };
    this.state.smartAlerts.unshift(alert);
    this.save();
    return { ...alert };
  }

  updateSmartAlert(id: string, patch: Partial<Pick<TelegramSmartAlert, 'enabled' | 'cooldownMinutes'>>): TelegramSmartAlert | null {
    const alert = this.state.smartAlerts.find(item => item.id === id);
    if (!alert) return null;
    if (patch.enabled != null) alert.enabled = Boolean(patch.enabled);
    if (patch.cooldownMinutes != null && Number.isFinite(Number(patch.cooldownMinutes))) {
      alert.cooldownMinutes = Math.max(1, Math.min(24 * 60, Number(patch.cooldownMinutes)));
    }
    this.save();
    return { ...alert };
  }

  removeSmartAlert(chatId: string, id: string): boolean {
    const before = this.state.smartAlerts.length;
    this.state.smartAlerts = this.state.smartAlerts.filter(alert => !(alert.chatId === String(chatId) && alert.id === id));
    if (before === this.state.smartAlerts.length) return false;
    this.save();
    return true;
  }

  markSmartAlertTriggered(id: string, at = new Date()): TelegramSmartAlert | null {
    const alert = this.state.smartAlerts.find(item => item.id === id && item.enabled);
    if (!alert) return null;
    alert.triggeredCount += 1;
    alert.lastTriggeredAt = at.toISOString();
    this.save();
    return { ...alert };
  }

  addWatchlistMarket(chatId: string, marketId: string): boolean {
    const id = normalizeMarketId(marketId);
    if (!id) return false;
    const key = String(chatId);
    const list = this.state.watchlists[key] || [];
    if (list.includes(id)) return false;
    this.state.watchlists[key] = [...list, id].slice(-100);
    this.save();
    return true;
  }

  removeWatchlistMarket(chatId: string, marketId: string): boolean {
    const key = String(chatId);
    const id = normalizeMarketId(marketId);
    const list = this.state.watchlists[key] || [];
    const next = list.filter(item => item !== id);
    if (next.length === list.length) return false;
    this.state.watchlists[key] = next;
    this.save();
    return true;
  }

  listWatchlist(chatId: string): string[] {
    return [...(this.state.watchlists[String(chatId)] || [])];
  }

  getAlertPolicy(chatId: string): TelegramAlertPolicy {
    const existing = this.state.policies[String(chatId)];
    const defaults = defaultAlertPolicy();
    return {
      ...defaults,
      ...(existing || {}),
      quietHours: { ...defaults.quietHours, ...(existing?.quietHours || {}) },
      digest: { ...defaults.digest, ...(existing?.digest || {}) },
    };
  }

  updateAlertPolicy(chatId: string, patch: Partial<TelegramAlertPolicy>): TelegramAlertPolicy {
    const current = this.getAlertPolicy(chatId);
    const updated: TelegramAlertPolicy = {
      ...current,
      ...patch,
      quietHours: { ...current.quietHours, ...(patch.quietHours || {}) },
      digest: { ...current.digest, ...(patch.digest || {}) },
    };
    this.state.policies[String(chatId)] = updated;
    this.save();
    return this.getAlertPolicy(chatId);
  }

  isChatAlertPaused(chatId: string, now = new Date()): boolean {
    const pausedUntil = this.getAlertPolicy(chatId).pausedUntil;
    return !!pausedUntil && new Date(pausedUntil).getTime() > now.getTime();
  }

  isChatInQuietHours(chatId: string, now = new Date()): boolean {
    const quiet = this.getAlertPolicy(chatId).quietHours;
    if (!quiet.enabled) return false;
    const current = now.getHours() * 60 + now.getMinutes();
    const start = minutesOfDay(quiet.start);
    const end = minutesOfDay(quiet.end);
    return start === end ? true : start < end ? current >= start && current < end : current >= start || current < end;
  }

  createJournalEntry(chatId: string, input: Omit<TelegramJournalEntry, 'id' | 'chatId' | 'createdAt'>): TelegramJournalEntry {
    const entry: TelegramJournalEntry = {
      ...input,
      id: `tj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      chatId: String(chatId),
      text: String(input.text || '').trim().slice(0, 2000),
      createdAt: new Date().toISOString(),
    };
    if (!entry.text) throw new Error('日志内容不能为空');
    this.state.journal.unshift(entry);
    this.state.journal = this.state.journal.slice(0, 500);
    this.save();
    return { ...entry, snapshot: entry.snapshot ? { ...entry.snapshot } : undefined };
  }

  listJournalEntries(chatId: string, limit = 20): TelegramJournalEntry[] {
    return this.state.journal
      .filter(entry => entry.chatId === String(chatId))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map(entry => ({ ...entry, snapshot: entry.snapshot ? { ...entry.snapshot } : undefined }));
  }

  createPriceAlert(chatId: string, input: Pick<TelegramPriceAlert, 'symbol' | 'direction' | 'price'>): TelegramPriceAlert {
    const alert: TelegramPriceAlert = {
      ...input,
      id: `ta_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      chatId: String(chatId),
      triggered: false,
      createdAt: new Date().toISOString(),
    };
    this.state.priceAlerts.unshift(alert);
    this.save();
    return { ...alert };
  }

  removePriceAlert(chatId: string, id: string): boolean {
    const before = this.state.priceAlerts.length;
    this.state.priceAlerts = this.state.priceAlerts.filter(alert => !(alert.chatId === String(chatId) && alert.id === id));
    if (before === this.state.priceAlerts.length) return false;
    this.save();
    return true;
  }

  markPriceAlertTriggered(id: string): TelegramPriceAlert | null {
    const alert = this.state.priceAlerts.find(item => item.id === id && !item.triggered);
    if (!alert) return null;
    alert.triggered = true;
    alert.triggeredAt = new Date().toISOString();
    this.save();
    return { ...alert };
  }

  createPendingAction(chatId: string, input: Omit<TelegramPendingAction, 'nonce' | 'chatId' | 'createdAt' | 'expiresAt'>, ttlMs = 5 * 60_000): TelegramPendingAction {
    this.state.pending = this.state.pending.filter(item => item.chatId !== String(chatId));
    const now = Date.now();
    const pending: TelegramPendingAction = {
      ...input,
      nonce: Math.random().toString(36).slice(2, 8).toUpperCase(),
      chatId: String(chatId),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    };
    this.state.pending.push(pending);
    this.save();
    return { ...pending };
  }

  consumePendingAction(chatId: string, nonce: string): TelegramPendingAction | null {
    const now = Date.now();
    const index = this.state.pending.findIndex(item => item.chatId === String(chatId) && item.nonce === String(nonce).toUpperCase());
    if (index < 0) return null;
    const [pending] = this.state.pending.splice(index, 1);
    this.state.pending = this.state.pending.filter(item => new Date(item.expiresAt).getTime() > now);
    this.save();
    if (new Date(pending.expiresAt).getTime() <= now) return null;
    return { ...pending };
  }

  countPendingActions(chatId?: string): number {
    if (chatId == null) return this.state.pending.length;
    return this.state.pending.filter(item => item.chatId === String(chatId)).length;
  }

  listPendingActions(chatId?: string): TelegramPendingAction[] {
    const now = Date.now();
    const active = this.state.pending.filter(item => new Date(item.expiresAt).getTime() > now);
    const filtered = chatId == null ? active : active.filter(item => item.chatId === String(chatId));
    return filtered.map(item => ({ ...item }));
  }

  cancelPendingAction(chatId: string): boolean {
    const before = this.state.pending.length;
    this.state.pending = this.state.pending.filter(item => item.chatId !== String(chatId));
    if (before === this.state.pending.length) return false;
    this.save();
    return true;
  }

  recordAudit(chatId: string, action: string, detail: string): TelegramAuditRecord {
    const entry: TelegramAuditRecord = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      chatId: String(chatId), action, detail, at: new Date().toISOString(),
    };
    this.state.audits.unshift(entry);
    this.state.audits = this.state.audits.slice(0, 200);
    this.save();
    if (this.useSqlite) {
      stateStore.appendAudit({
        id: entry.id,
        chatId: entry.chatId,
        action: entry.action,
        detail: entry.detail,
        at: entry.at,
      });
    }
    return { ...entry };
  }

  listAudits(chatId?: string, limit = 20): TelegramAuditRecord[] {
    return this.state.audits
      .filter(item => chatId == null || item.chatId === String(chatId))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map(item => ({ ...item }));
  }

  private load(): TelegramCommandCenterState {
    if (this.useSqlite) {
      const stored = stateStore.get<Partial<TelegramCommandCenterState>>('telegram-command-center');
      if (stored) {
        return {
          ...emptyState(),
          ...stored,
          version: 2,
          preferences: stored.preferences || {},
          priceAlerts: Array.isArray(stored.priceAlerts) ? stored.priceAlerts : [],
          smartAlerts: Array.isArray(stored.smartAlerts) ? stored.smartAlerts : [],
          watchlists: stored.watchlists || {},
          policies: stored.policies || {},
          journal: Array.isArray(stored.journal) ? stored.journal : [],
          pending: Array.isArray(stored.pending) ? stored.pending : [],
          audits: Array.isArray(stored.audits) ? stored.audits : [],
        };
      }
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as Partial<TelegramCommandCenterState>;
      const version = Number((parsed as { version?: number }).version);
      if (version === 1 || version === 2) {
        return {
          version: 2,
          preferences: parsed.preferences || {},
          priceAlerts: Array.isArray(parsed.priceAlerts) ? parsed.priceAlerts : [],
          smartAlerts: Array.isArray((parsed as any).smartAlerts) ? (parsed as any).smartAlerts : [],
          watchlists: (parsed as any).watchlists || {},
          policies: (parsed as any).policies || {},
          journal: Array.isArray((parsed as any).journal) ? (parsed as any).journal : [],
          pending: Array.isArray(parsed.pending) ? parsed.pending : [],
          audits: Array.isArray(parsed.audits) ? parsed.audits : [],
        };
      }
    } catch {}
    return emptyState();
  }

  private save(): void {
    if (this.useSqlite) {
      stateStore.set('telegram-command-center', this.state, 2);
      return;
    }
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const temp = `${this.stateFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(temp, this.stateFile);
  }
}

export const telegramCommandCenterStore = new TelegramCommandCenterStore();
