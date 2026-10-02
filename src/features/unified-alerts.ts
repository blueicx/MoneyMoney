import { classifyEventResult, compareEventValues, EVENT_REMINDER_THRESHOLDS_MINUTES, getReachedEventReminderThreshold, type EventResultDirection } from './event-alerts';
import { MARKET_SCOPES, type MarketScope } from './market-scope';
import { stateStore } from '../storage/sqlite-state';

export const EVENT_ALERT_STAGES = [...EVENT_REMINDER_THRESHOLDS_MINUTES];
export type UnifiedAlertKind = 'event' | 'price' | 'news' | 'metric';
export type AlertMetric = 'price' | 'volume' | 'rsi' | 'pattern' | 'fundingRatePct' | 'openInterestUsd';
export function alertMetricFields(instrument: string): AlertMetric[] {
  if (/^stock:us:[A-Z0-9.-]+$/i.test(instrument) || /^crypto:binance:[A-Z0-9]+$/i.test(instrument)) return ['price','volume','rsi','pattern'];
  if (/^crypto:gateio:[A-Z0-9_]+$/i.test(instrument)) return ['price','fundingRatePct','openInterestUsd'];
  return [];
}
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
    join?: 'all' | 'any';
    clauses?: Array<{field: AlertMetric; operator: 'gte' | 'lte' | 'eq'; value: number | string}>;
    durationMinutes?: number;
  };
  channels: { web: boolean; telegram: boolean };
  enabled: boolean;
  cooldownMinutes: number;
  quietHours?: { start: string; end: string };
  pausedUntil?: string;
  lastTriggeredAt?: string;
  matchedSince?: string;
  lastObservedAt?: string;
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
  metrics?: Partial<Record<AlertMetric, number | string>>;
  dataStatus?: string;
  reason?: string;
  source?: string;
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
  if (!['event', 'price', 'news', 'metric'].includes(String(input.kind))) return { ok: false, error: '提醒类型无效' };
  if (input.scope && !MARKET_SCOPES.includes(String(input.scope) as MarketScope)) return { ok: false, error: '市场范围无效' };
  if (input.expiresAt && !Number.isFinite(new Date(input.expiresAt).getTime())) return { ok: false, error: '过期时间无效' };
  if (input.digestMinutes != null && (!Number.isFinite(Number(input.digestMinutes)) || Number(input.digestMinutes) < 0)) return { ok: false, error: '摘要间隔无效' };
  const condition = input.condition || {};
  if (input.kind === 'metric') {
    const fields=alertMetricFields(String(input.instrumentId || ''));
    const market=input.instrumentId?.startsWith('stock:') ? 'stocks':input.instrumentId?.startsWith('crypto:') ? 'crypto':null;
    if (!fields.length || input.scope !== market) return {ok:false,error:'组合提醒需绑定受支持的当前市场标的'};
    if (!['all','any'].includes(condition.join || '') || !condition.clauses?.length || condition.clauses.length>6) return {ok:false,error:'请选择 1–6 个条件及组合方式'};
    if (!Number.isInteger(condition.durationMinutes ?? 0) || Number(condition.durationMinutes || 0)<0 || Number(condition.durationMinutes || 0)>1440) return {ok:false,error:'持续时间应为 0–1440 分钟'};
    for (const clause of condition.clauses) {
      if (!fields.includes(clause.field) || !['gte','lte','eq'].includes(clause.operator) || (clause.field==='pattern' ? clause.operator!=='eq' || !['doji','hammer','bullish-engulfing','bearish-engulfing'].includes(String(clause.value)) : typeof clause.value!=='number' || !Number.isFinite(clause.value))) return {ok:false,error:'当前市场/交易场所不支持此字段，或条件值无效'};
    }
  }
  if (input.kind === 'event' && (!EVENT_ALERT_STAGES.includes(Number(condition.stage) as typeof EVENT_ALERT_STAGES[number]))) return { ok: false, error: '事件提前时间必须是 24h/12h/6h/3h/1h/30m/10m/5m' };
  if (input.kind === 'price' && (!['above', 'below'].includes(String(condition.direction)) || !Number.isFinite(Number(condition.value)) || Number(condition.value) <= 0)) return { ok: false, error: '价格提醒条件无效' };
  if (input.kind === 'news' && (!Array.isArray(condition.keywords) || condition.keywords.map(String).filter(item => item.trim()).length === 0)) return { ok: false, error: '新闻提醒至少需要一个关键词' };
  return { ok: true };
}

function normalizedKeywords(values: unknown): string[] { return Array.from(new Set((Array.isArray(values) ? values : []).map(value => String(value).trim().toLowerCase()).filter(Boolean))).slice(0, 20); }

export function alertDedupKey(rule: UnifiedAlertRule, observation: UnifiedAlertObservation): string {
  const condition = rule.condition || {};
  if (rule.kind === 'metric') return `${rule.id}:metric:${observation.observedAt || observation.id || 'unknown'}`;
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
  if (rule.kind === 'metric') {
    if (!['live','delayed'].includes(observation.dataStatus || '')) return {matched:false,direction:'neutral',message:observation.reason || '组合条件数据不是可用的实时/延迟来源'};
    const matches=(rule.condition.clauses || []).map(clause=>{
      const actual=observation.metrics?.[clause.field];
      if (actual==null) return false;
      if (clause.field==='pattern') return actual===clause.value;
      if (typeof actual!=='number' || !Number.isFinite(actual) || typeof clause.value!=='number') return false;
      return clause.operator==='gte' ? actual>=clause.value : clause.operator==='lte' ? actual<=clause.value : actual===clause.value;
    });
    const matched=matches.length>0 && (rule.condition.join==='any' ? matches.some(Boolean) : matches.every(Boolean));
    return {matched,direction:'neutral',message:matched ? `组合条件满足：${rule.condition.clauses?.map(c=>`${c.field} ${c.operator} ${c.value}`).join(rule.condition.join==='any' ? ' 或 ':' 且 ')}`:'组合条件未满足或字段不可用'};
  }
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
    if (!candidate) { if(rule.kind==='metric') store.recordMetricObservation(rule.id,false,now); continue; }
    const result = evaluateUnifiedAlert(rule, candidate.observation);
    if (rule.kind==='metric') {
      const observed=Date.parse(candidate.observation.observedAt || '');
      const fresh=Number.isFinite(observed) && observed<=now.getTime()+60_000 && now.getTime()-observed<=120_000;
      if (!store.recordMetricObservation(rule.id,result.matched && fresh,now)) continue;
    }
    if (!result.matched) continue;
    const dedupKey = alertDedupKey(rule, candidate.observation);
    if (store.listHistory(500).some(item => item.dedupKey === dedupKey)) continue;
    const entry = store.appendHistory({ ruleId: rule.id, ownerId: rule.ownerId, instrumentId: rule.instrumentId, kind: rule.kind, dedupKey, direction: result.direction, channels: { ...rule.channels }, message: result.message, createdAt: now.toISOString() });
    store.markTriggered(rule.id, now);
    created.push(entry);
  }
  return created;
}

export interface UnifiedAlertPreview {
  ruleId: string;
  instrumentId: string;
  wouldTrigger: boolean;
  suppressed: boolean;
  reason: string;
  direction: UnifiedAlertHistory['direction'];
  message: string;
}

/** Evaluate the same rules as production without changing history or cooldown state. */
export function previewUnifiedAlerts(store: UnifiedAlertStore, observations: Array<{ instrumentId: string; observation: UnifiedAlertObservation }>, now = new Date()): UnifiedAlertPreview[] {
  return store.listRules().map(rule => {
    if (isAlertSuppressed(rule, now)) return { ruleId: rule.id, instrumentId: rule.instrumentId, wouldTrigger: false, suppressed: true, reason: '规则处于暂停、静默、冷却或已过期状态', direction: 'neutral', message: '' };
    const candidate = observations.find(item => item.observation.kind === rule.kind && (!rule.instrumentId || item.instrumentId === rule.instrumentId) && (!rule.scope || item.observation.scope === rule.scope) && (!rule.watchlistId || item.observation.watchlistIds?.includes(rule.watchlistId)));
    if (!candidate) return { ruleId: rule.id, instrumentId: rule.instrumentId, wouldTrigger: false, suppressed: false, reason: '本次试运行没有匹配到观察数据', direction: 'neutral', message: '' };
    const result = evaluateUnifiedAlert(rule, candidate.observation);
    if (rule.kind==='metric') {
      const at=Date.parse(candidate.observation.observedAt || ''), duration=Number(rule.condition.durationMinutes || 0)*60_000;
      const pending=duration>0 && (!rule.matchedSince || now.getTime()-Date.parse(rule.matchedSince)<duration || !rule.lastObservedAt || now.getTime()-Date.parse(rule.lastObservedAt)>120_000);
      if (!Number.isFinite(at) || at>now.getTime()+60_000 || now.getTime()-at>120_000 || pending) return {ruleId:rule.id,instrumentId:candidate.instrumentId,wouldTrigger:false,suppressed:false,reason:pending?'持续条件尚未达到或缺少连续观察':'来源数据已过期',direction:'neutral',message:result.message};
    }
    const deduped = store.listHistory(500).some(item => item.dedupKey === alertDedupKey(rule, candidate.observation));
    return { ruleId: rule.id, instrumentId: candidate.instrumentId, wouldTrigger: result.matched && !deduped, suppressed: false, reason: deduped ? '同一事件已发送过，生产逻辑会去重' : result.matched ? '满足触发条件' : '未满足触发条件', direction: result.direction, message: result.message };
  });
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
    this.checkMetricCapacity(rule);this.state.rules.push(rule); this.save(); return { ...rule };
  }
  updateRule(id: string, patch: Partial<UnifiedAlertRule>): UnifiedAlertRule | null {
    const rule = this.state.rules.find(item => item.id === id); if (!rule) return null;
    const next = { ...rule, ...patch, condition: { ...rule.condition, ...(patch.condition || {}) }, channels: { ...rule.channels, ...(patch.channels || {}) } };
    const validation = validateUnifiedAlertRule(next); if (!validation.ok) throw new Error(validation.error);
    this.checkMetricCapacity(next,id);
    Object.assign(rule, next); if (patch.condition || patch.enabled===false) { delete rule.matchedSince;delete rule.lastObservedAt; } this.save(); return { ...rule };
  }
  recordMetricObservation(id:string,matched:boolean,now:Date):boolean {
    const rule=this.state.rules.find(row=>row.id===id); if(!rule) return false;
    if(!matched) {delete rule.matchedSince;delete rule.lastObservedAt;this.save();return false;}
    const last=Date.parse(rule.lastObservedAt || '');
    if(!rule.matchedSince || !Number.isFinite(last) || now.getTime()-last>120_000) rule.matchedSince=now.toISOString();
    rule.lastObservedAt=now.toISOString();this.save();
    return now.getTime()-Date.parse(rule.matchedSince)>=Number(rule.condition.durationMinutes || 0)*60_000;
  }
  private checkMetricCapacity(next:UnifiedAlertRule,excludedId?:string):void {
    const active=(rule:UnifiedAlertRule)=>rule.kind==='metric' && rule.enabled && (!rule.expiresAt || Date.parse(rule.expiresAt)>Date.now());
    if(!active(next))return;
    const instruments=new Set(this.state.rules.filter(rule=>rule.id!==excludedId && active(rule)).map(rule=>rule.instrumentId));instruments.add(next.instrumentId);
    if(instruments.size>6)throw new Error('免费来源监控预算最多同时启用 6 个指标标的；请暂停其他标的规则后再启用');
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
