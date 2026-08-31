import fs from 'node:fs';
import path from 'node:path';

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

export interface TelegramPendingAction {
  nonce: string;
  chatId: string;
  type: 'paper_open' | 'paper_close';
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
  version: 1;
  preferences: Record<string, TelegramChatPreferences>;
  priceAlerts: TelegramPriceAlert[];
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
  return { version: 1, preferences: {}, priceAlerts: [], pending: [], audits: [] };
}

export class TelegramCommandCenterStore {
  private state: TelegramCommandCenterState;

  constructor(private readonly stateFile = path.resolve('data/telegram-command-center.json')) {
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
    return { ...entry };
  }

  listAudits(chatId?: string, limit = 20): TelegramAuditRecord[] {
    return this.state.audits
      .filter(item => chatId == null || item.chatId === String(chatId))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map(item => ({ ...item }));
  }

  private load(): TelegramCommandCenterState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as Partial<TelegramCommandCenterState>;
      if (parsed.version === 1) {
        return {
          version: 1,
          preferences: parsed.preferences || {},
          priceAlerts: Array.isArray(parsed.priceAlerts) ? parsed.priceAlerts : [],
          pending: Array.isArray(parsed.pending) ? parsed.pending : [],
          audits: Array.isArray(parsed.audits) ? parsed.audits : [],
        };
      }
    } catch {}
    return emptyState();
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const temp = `${this.stateFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(temp, this.stateFile);
  }
}

export const telegramCommandCenterStore = new TelegramCommandCenterStore();
