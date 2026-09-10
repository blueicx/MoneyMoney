import { classifyEventResult, compareEventValues, EVENT_REMINDER_THRESHOLDS_MINUTES, getReachedEventReminderThreshold, type EventResultDirection } from './event-alerts';
import { MARKET_SCOPES, type MarketScope } from './market-scope';
import { stateStore } from '../storage/sqlite-state';

export const EVENT_ALERT_STAGES = [...EVENT_REMINDER_THRESHOLDS_MINUTES];
export type UnifiedAlertKind = 'event' | 'price' | 'news';
export type AlertChannel = 'web' | 'telegram';

export interface UnifiedAlertRule {
  id: string;
  ownerId: string;
  instrumentId: string;
  scope?: string;
  watchlistId?: string;
  expiresAt?: string;
  digestMinutes?: number;
  kind: UnifiedAlertKind;
  condition: {
    stage?: number;
    direction?: 'above' | 'below';
    value?: number;
    keywords?: string[];
  };
  channels: { web: boolean; telegram: boolean };
  enabled: boolean;
  cooldownMinutes: number;
  quietHours?: { start: string; end: string };
  pausedUntil?: string;
  lastTriggeredAt?: string;
  createdAt: string;
}

export interface UnifiedAlertObservation {
  id?: string;
  scope?: string;
  watchlistIds?: string[];
  kind: UnifiedAlertKind;
  value?: number;
  minutesUntil?: number;
  title?: string;
  content?: string;
  actual?: string | null;
  forecast?: string | null;
  observedAt?: string;
}

export interface UnifiedAlertHistory {
  id: string;
  ruleId: string;
  ownerId: string;
  instrumentId: string;
  kind: UnifiedAlertKind;
  dedupKey: string;
  direction: EventResultDirection | 'above' | 'below' | 'neutral';
  channels: { web: boolean; telegram: boolean };
  message: string;
  createdAt: string;
}

export function validateUnifiedAlertRule(input: Partial<UnifiedAlertRule>): { ok: boolean; error?: string } {
  if (!String(input.instrumentId || '').trim() && !String(input.scope || '').trim() && !String(input.watchlistId || '').trim()) {
    return { ok: false, error: '必须提供有效的标的 ID、scope 或 watchlistId' };
  }
  if (!['event', 'price', 'news'].includes(String(input.kind))) return { ok: false, error: '提醒类型无效' };
  if (input.scope && !MARKET_SCOPES.includes(String(input.scope) as MarketScope)) return { ok: false, error: '市场范围无效' };
  if (input.expiresAt && !Number.isFinite(new Date(input.expiresAt).getTime())) return { ok: false, error: '过期时间无效' };
  if (input.digestMinutes != null && (!Number.isFinite(Number(input.digestMinutes)) || Number(input.digestMinutes) < 0)) return { ok: false, error: '摘要间隔无效' };
  const condition = input.condition || {};
  if (input.kind === 'event' && (!EVENT_ALERT_STAGES.includes(Number(condition.stage) as typeof EVENT_ALERT_STAGES[number]))) return { ok: false, error: '事件提前时间必须是 24h/12h/6h/3h/1h/30m/10m/5m' };
  if (input.kind === 'price' && (!['above', 'below'].includes(String(condition.direction)) || !Number.isFinite(Number(condition.value)) || Number(condition.value) <= 0)) return { ok: false, error: '价格提醒条件无效' };
  if (input.kind === 'news' && (!Array.isArray(condition.keywords) || condition.keywords.map(String).filter(item => item.trim()).length === 0)) return { ok: false, error: '新闻提醒至少需要一个关键词' };
  return { ok: true };
}

function normalizedKeywords(values: unknown): string[] { return Array.from(new Set((Array.isArray(values) ? values : []).map(value => String(value).trim().toLowerCase()).filter(Boolean))).slice(0, 20); }

export function alertDedupKey(rule: UnifiedAlertRule, observation: UnifiedAlertObservation): string {
  const condition = rule.condition || {};
  const scope = observation.scope || rule.scope ? `:${observation.scope || rule.scope}` : '';
  if (rule.kind === 'event') {
    const identity = observation.id
      ? `:${observation.id}`
      : `:${observation.actual || observation.minutesUntil || 'upcoming'}`;
    return `${rule.id}:event:${condition.stage}${identity}${scope}`;
  }
  if (rule.kind === 'news') {
    const identity = observation.id
      ? `:${observation.id}`
      : `:${String(observation.title || '').trim().toLowerCase()}`;
    return `${rule.id}:news:${normalizedKeywords(condition.keywords).join('|')}${identity}${scope}`;
  }
  return `${rule.id}:price:${condition.direction}:${condition.value}`;
}

function parseMinutes(value: string): number | null {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]); const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

function isWithinQuietHours(now: Date, quietHours?: { start: string; end: string }): boolean {
  if (!quietHours) return false;
  const start = parseMinutes(quietHours.start); const end = parseMinutes(quietHours.end);
  if (start == null || end == null || start === end) return false;
  const current = now.getUTCHours() * 60 + now.getUTCMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function isAlertSuppressed(rule: UnifiedAlertRule, now = new Date()): boolean {
  if (rule.enabled === false) return true;
  if (rule.expiresAt && new Date(rule.expiresAt).getTime() < now.getTime()) return true;
  if (rule.pausedUntil && new Date(rule.pausedUntil).getTime() > now.getTime()) return true;
  if (isWithinQuietHours(now, rule.quietHours)) return true;
  if (rule.lastTriggeredAt && Number(rule.cooldownMinutes) > 0) {
    const last = new Date(rule.lastTriggeredAt).getTime();
    if (Number.isFinite(last) && now.getTime() - last < Number(rule.cooldownMinutes) * 60_000) return true;
  }
  return false;
}

export function evaluateUnifiedAlert(rule: UnifiedAlertRule, observation: UnifiedAlertObservation): { matched: boolean; direction: EventResultDirection | 'above' | 'below' | 'neutral'; message: string } {
  if (rule.kind !== observation.kind) return { matched: false, direction: 'neutral', message: '' };
  if (rule.kind === 'price') {
    const value = Number(observation.value); const target = Number(rule.condition.value);
    const matched = rule.condition.direction === 'above' ? value >= target : value <= target;
    return { matched, direction: rule.condition.direction || 'neutral', message: matched ? `价格已${rule.condition.direction === 'above' ? '达到' : '跌至'} ${target}` : '' };
  }
  if (rule.kind === 'news') {
    const text = `${observation.title || ''} ${observation.content || ''}`.toLowerCase();
    const keywords = normalizedKeywords(rule.condition.keywords);
    const matched = keywords.some(keyword => text.includes(keyword));
    const score = Number(observation.value);
    const direction = matched && Number.isFinite(score) ? score > 0.15 ? 'bullish' : score < -0.15 ? 'bearish' : 'neutral' : 'neutral';
    return { matched, direction, message: matched ? `新闻命中关键词：${keywords.filter(keyword => text.includes(keyword)).join('、')}` : '' };
  }
  const reached = getReachedEventReminderThreshold(Number(observation.minutesUntil));
  const matched = reached === Number(rule.condition.stage) && Number(observation.minutesUntil) >= 0;
  const comparison = compareEventValues(observation.actual ?? null, observation.forecast ?? null);
  const direction = classifyEventResult(observation.title || '', comparison);
  return { matched, direction, message: matched ? `事件将在约 ${observation.minutesUntil} 分钟后发生` : '' };
}

export function triggerUnifiedAlerts(store: UnifiedAlertStore, observations: Array<{ instrumentId: string; observation: UnifiedAlertObservation }>, now = new Date()): UnifiedAlertHistory[] {
  const created: UnifiedAlertHistory[] = [];
  for (const rule of store.listRules()) {
    if (isAlertSuppressed(rule, now)) continue;
    const candidate = observations.find(item => {
      if (item.observation.kind !== rule.kind) return false;
      if (rule.instrumentId && item.instrumentId !== rule.instrumentId) return false;
      if (rule.scope && item.observation.scope !== rule.scope) return false;
      if (rule.watchlistId && !item.observation.watchlistIds?.includes(rule.watchlistId)) return false;
      return Boolean(rule.instrumentId || rule.scope || rule.watchlistId);
    });
    if (!candidate) continue;
    const result = evaluateUnifiedAlert(rule, candidate.observation);
    if (!result.matched) continue;
    const dedupKey = alertDedupKey(rule, candidate.observation);
    if (store.listHistory(500).some(item => item.dedupKey === dedupKey)) continue;
    const entry = store.appendHistory({ ruleId: rule.id, ownerId: rule.ownerId, instrumentId: rule.instrumentId, kind: rule.kind, dedupKey, direction: result.direction, channels: { ...rule.channels }, message: result.message, createdAt: now.toISOString() });
    store.markTriggered(rule.id, now);
    created.push(entry);
  }
  return created;
}

interface UnifiedAlertState { rules: UnifiedAlertRule[]; history: UnifiedAlertHistory[]; watchlist: string[] }

export class UnifiedAlertStore {
  private readonly keys: { state: string };
  private state: UnifiedAlertState;

  constructor(options: { keyPrefix?: string } = {}) {
    const prefix = options.keyPrefix || 'unified-alerts';
    this.keys = { state: prefix };
    const stored = stateStore.get<Partial<UnifiedAlertState>>(this.keys.state);
    this.state = { rules: Array.isArray(stored?.rules) ? stored.rules : [], history: Array.isArray(stored?.history) ? stored.history : [], watchlist: Array.isArray(stored?.watchlist) ? stored.watchlist : [] };
  }

  listRules(ownerId = 'admin'): UnifiedAlertRule[] { return this.state.rules.filter(rule => rule.ownerId === ownerId).map(rule => ({ ...rule, condition: { ...rule.condition }, channels: { ...rule.channels } })); }
  getRule(id: string): UnifiedAlertRule | null { return this.state.rules.find(rule => rule.id === id) || null; }
  createRule(input: Partial<UnifiedAlertRule>): UnifiedAlertRule {
    const validation = validateUnifiedAlertRule(input);
    if (!validation.ok) throw new Error(validation.error);
    const rule: UnifiedAlertRule = {
      id: input.id || `uar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ownerId: String(input.ownerId || 'admin'),
      instrumentId: String(input.instrumentId || ''),
      scope: input.scope ? String(input.scope) : undefined,
      watchlistId: input.watchlistId ? String(input.watchlistId) : undefined,
      expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : undefined,
      digestMinutes: input.digestMinutes == null ? undefined : Math.max(0, Number(input.digestMinutes)),
      kind: input.kind!, condition: { ...(input.condition || {}) },
      channels: { web: input.channels?.web !== false, telegram: input.channels?.telegram === true }, enabled: input.enabled !== false,
      cooldownMinutes: Math.max(0, Number(input.cooldownMinutes) || 30), quietHours: input.quietHours, pausedUntil: input.pausedUntil, createdAt: input.createdAt || new Date().toISOString(),
    };
    this.state.rules.push(rule); this.save(); return { ...rule };
  }
  updateRule(id: string, patch: Partial<UnifiedAlertRule>): UnifiedAlertRule | null {
    const rule = this.state.rules.find(item => item.id === id); if (!rule) return null;
    const next = { ...rule, ...patch, condition: { ...rule.condition, ...(patch.condition || {}) }, channels: { ...rule.channels, ...(patch.channels || {}) } };
    const validation = validateUnifiedAlertRule(next); if (!validation.ok) throw new Error(validation.error);
    Object.assign(rule, next); this.save(); return { ...rule };
  }
  removeRule(id: string): boolean { const before = this.state.rules.length; this.state.rules = this.state.rules.filter(rule => rule.id !== id); if (before !== this.state.rules.length) this.save(); return before !== this.state.rules.length; }
  listWatchlist(): string[] { return [...this.state.watchlist]; }
  addWatchlist(instrumentId: string): string[] { const id = String(instrumentId || '').trim(); if (id && !this.state.watchlist.includes(id)) this.state.watchlist.push(id); this.save(); return this.listWatchlist(); }
  removeWatchlist(instrumentId: string): string[] { this.state.watchlist = this.state.watchlist.filter(item => item !== instrumentId); this.save(); return this.listWatchlist(); }
  appendHistory(entry: Omit<UnifiedAlertHistory, 'id'>): UnifiedAlertHistory { const value = { ...entry, id: `uah_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }; this.state.history.unshift(value); this.state.history = this.state.history.slice(0, 500); this.save(); return value; }
  listHistory(limit = 100): UnifiedAlertHistory[] { return this.state.history.slice(0, Math.max(1, Math.min(500, limit))); }
  markTriggered(ruleId: string, at = new Date()): void { const rule = this.state.rules.find(item => item.id === ruleId); if (rule) { rule.lastTriggeredAt = at.toISOString(); this.save(); } }
  private save(): void { stateStore.set(this.keys.state, this.state, 1); }
}

export const unifiedAlertStore = new UnifiedAlertStore();
