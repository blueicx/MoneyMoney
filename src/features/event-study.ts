import crypto from 'node:crypto';
import { assertMarketContext, type MarketId } from './research-contracts';

export interface EventStudyBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface EventStudyInput {
  market: MarketId;
  instrument: string;
  eventAt: string;
  bars: EventStudyBar[];
  benchmarkBars?: EventStudyBar[];
  beforeBars?: number;
  afterBars?: number;
}

export interface EventStudyResult {
  id: string;
  market: MarketId;
  instrument: string;
  eventAt: string;
  eventBar: EventStudyBar;
  window: EventStudyBar[];
  rawReturnPct: number | null;
  benchmarkAdjustedReturnPct: number | null;
  mfePct: number | null;
  maePct: number | null;
  recoveryBars: number | null;
  sampleSize: number;
  warnings: string[];
  disclaimer: string;
  createdAt: string;
}

export interface EventStudyRecord extends EventStudyResult {
  asOf?: string;
  title?: string;
  eventCategory?: EventCategory;
  cohort?: EventStudyCohortResult;
  source?: string;
  sourceUrl?: string;
  evidenceRefs?: string[];
}

export type EventCategory = 'earnings' | 'filing' | 'insider' | 'macro' | 'news';

export interface EventStudyCohortResult {
  category: EventCategory;
  sampleSize: number;
  eventIds: string[];
  meanReturnPct: number | null;
  medianReturnPct: number | null;
  confidence95Pct: [number, number] | null;
  benchmarkAdjustedMeanPct: number | null;
  placebo: { sampleSize: number; meanReturnPct: number } | null;
  warnings: string[];
}

interface CohortEvent {
  id: string; market: MarketId; instrument: string; title: string; occurredAt: string; publishedAt: string | null;
}

export function classifyEventCategory(title: string): EventCategory {
  if (/insider|form\s*4\b|内部人|高管增减持/i.test(title)) return 'insider';
  if (/earnings|guidance|财报|业绩|业绩指引/i.test(title)) return 'earnings';
  if (/10[- ]?[kq]\b|8[- ]?k\b|sec filing|年报|季报|披露文件/i.test(title)) return 'filing';
  if (/\bfed\b|\bcpi\b|\bpce\b|interest rate|通胀|美联储|利率决议/i.test(title)) return 'macro';
  return 'news';
}

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }

function confidenceInterval(values: number[], seedText: string): [number, number] | null {
  if (values.length < 5) return null;
  let seed = [...seedText].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0x100000000; };
  const means: number[] = [];
  for (let iteration = 0; iteration < 500; iteration++) {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(next() * values.length)]);
    means.push(mean(sample));
  }
  means.sort((left, right) => left - right);
  return [round(means[Math.floor(means.length * 0.025)])!, round(means[Math.floor(means.length * 0.975)])!];
}

export function buildEventStudyCohort(input: {
  market: MarketId; instrument: string; eventAt: string; title: string; bars: EventStudyBar[];
  events: readonly CohortEvent[]; afterBars?: number; benchmarkBars?: EventStudyBar[];
}): EventStudyCohortResult {
  assertMarketContext({ market: input.market, workspace: 'event-study', instrument: input.instrument });
  assertBars(input.bars, 'cohort bars');
  if (input.benchmarkBars) assertBars(input.benchmarkBars, 'benchmark bars');
  const targetTime = Date.parse(input.eventAt);
  if (!Number.isFinite(targetTime)) throw new Error('eventAt must be a valid timestamp');
  const category = classifyEventCategory(input.title);
  const afterBars = Math.max(1, Math.min(500, Math.floor(input.afterBars ?? 20)));
  const eventIds: string[] = [];
  const returns: number[] = [];
  const benchmarkReturns: number[] = [];
  const occupiedIndices: number[] = [];
  const eligibleEvents = input.events.flatMap(event => {
    if (event.market !== input.market || event.instrument !== input.instrument || classifyEventCategory(event.title) !== category || !event.publishedAt) return [];
    const occurred = Date.parse(event.occurredAt);
    const published = Date.parse(event.publishedAt);
    if (!Number.isFinite(occurred) || !Number.isFinite(published)) return [];
    const entryTime = Math.max(occurred, published);
    if (entryTime >= targetTime) return [];
    const index = input.bars.findIndex(bar => Date.parse(bar.timestamp) >= entryTime);
    if (index < 0 || index + afterBars >= input.bars.length || Date.parse(input.bars[index + afterBars].timestamp) >= targetTime) return [];
    return [{ event, entryTime, index }];
  }).slice(0, 200);
  for (const { event, entryTime, index } of eligibleEvents) {
    const study = runEventStudy({ market: input.market, instrument: input.instrument, eventAt: new Date(entryTime).toISOString(), bars: input.bars, benchmarkBars: input.benchmarkBars, beforeBars: 0, afterBars });
    if (study.rawReturnPct === null || eventIds.includes(event.id)) continue;
    eventIds.push(event.id);
    returns.push(study.rawReturnPct);
    if (study.benchmarkAdjustedReturnPct !== null) benchmarkReturns.push(study.benchmarkAdjustedReturnPct);
    occupiedIndices.push(index);
  }
  const targetIndex = input.bars.findIndex(bar => Date.parse(bar.timestamp) >= targetTime);
  const placeboReturns: number[] = [];
  let lastPlacebo = Infinity;
  for (let index = targetIndex - afterBars - 1; index >= 0 && placeboReturns.length < returns.length; index--) {
    if (lastPlacebo - index <= afterBars * 2 + 1 || occupiedIndices.some(eventIndex => Math.abs(eventIndex - index) <= afterBars * 2 + 1)) continue;
    const value = returnPct(input.bars[index].close, input.bars[index + afterBars].close);
    if (value === null) continue;
    placeboReturns.push(value);
    lastPlacebo = index;
  }
  const warnings = [
    ...(returns.length < 5 ? [`同类历史事件仅 ${returns.length} 件，样本不足，不作稳定结论。`] : []),
    ...(benchmarkReturns.length !== returns.length && returns.length ? ['部分历史事件缺少同时间基准数据，基准调整结果不可用。'] : []),
    ...(placeboReturns.length < returns.length && returns.length ? ['非事件日期对照不足，安慰剂结果仅作参考。'] : []),
  ];
  return {
    category, sampleSize: returns.length, eventIds,
    meanReturnPct: returns.length ? round(mean(returns)) : null,
    medianReturnPct: returns.length ? round([...returns].sort((a, b) => a - b)[Math.floor((returns.length - 1) / 2)]) : null,
    confidence95Pct: confidenceInterval(returns, `${input.market}:${input.instrument}:${input.eventAt}:${category}`),
    benchmarkAdjustedMeanPct: benchmarkReturns.length === returns.length && returns.length ? round(mean(benchmarkReturns)) : null,
    placebo: placeboReturns.length ? { sampleSize: placeboReturns.length, meanReturnPct: round(mean(placeboReturns))! } : null,
    warnings,
  };
}

interface StateDocumentStore {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, version?: number): void;
}

const STORAGE_KEY = 'event-studies';

function round(value: number | null, digits = 4): number | null {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

function returnPct(from: number, to: number): number | null {
  return Number.isFinite(from) && from !== 0 && Number.isFinite(to) ? ((to / from) - 1) * 100 : null;
}

function assertBars(bars: EventStudyBar[], label: string): void {
  if (!Array.isArray(bars) || bars.length < 2) throw new Error(`${label} requires at least two bars`);
  let previous = -Infinity;
  for (const bar of bars) {
    const timestamp = Date.parse(String(bar.timestamp));
    if (!Number.isFinite(timestamp) || timestamp <= previous) throw new Error(`${label} must be strictly time-ordered`);
    if (![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) throw new Error(`${label} contains invalid OHLC values`);
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) throw new Error(`${label} contains inconsistent OHLC values`);
    previous = timestamp;
  }
}

function matchingBar(bars: EventStudyBar[] | undefined, timestamp: string): EventStudyBar | null {
  if (!bars) return null;
  const target = Date.parse(timestamp);
  return bars.find(bar => Date.parse(bar.timestamp) === target) || null;
}

function safeSourceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('sourceUrl must be a valid http(s) URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('sourceUrl must be a valid http(s) URL');
  return url.toString();
}

export function runEventStudy(input: EventStudyInput): EventStudyResult {
  assertMarketContext({ market: input.market, workspace: 'event-study', instrument: input.instrument });
  const eventAtMs = Date.parse(input.eventAt);
  if (!Number.isFinite(eventAtMs)) throw new Error('eventAt must be a valid timestamp');
  assertBars(input.bars, 'event bars');
  if (input.benchmarkBars) assertBars(input.benchmarkBars, 'benchmark bars');
  const eventIndex = input.bars.findIndex(bar => Date.parse(bar.timestamp) >= eventAtMs);
  if (eventIndex < 0) throw new Error('eventAt is after the available historical bars');
  const beforeBars = Math.max(0, Math.min(500, Math.floor(input.beforeBars ?? 20)));
  const afterBars = Math.max(1, Math.min(500, Math.floor(input.afterBars ?? 20)));
  const start = Math.max(0, eventIndex - beforeBars);
  const end = Math.min(input.bars.length - 1, eventIndex + afterBars);
  const window = input.bars.slice(start, end + 1);
  const eventBar = input.bars[eventIndex];
  const outcomeBars = input.bars.slice(eventIndex + 1, end + 1);
  const base = eventBar.close;
  const finalBar = outcomeBars[outcomeBars.length - 1] || eventBar;
  const rawReturnPct = returnPct(base, finalBar.close);
  const mfePct = outcomeBars.length ? round(Math.max(...outcomeBars.map(bar => ((bar.high / base) - 1) * 100))): null;
  const maePct = outcomeBars.length ? round(Math.min(...outcomeBars.map(bar => ((bar.low / base) - 1) * 100))): null;
  let recoveryBars: number | null = null;
  let drawdownSeen = false;
  outcomeBars.forEach((bar, index) => {
    if (bar.close < base) drawdownSeen = true;
    if (drawdownSeen && recoveryBars === null && bar.close >= base) recoveryBars = index + 1;
  });
  const benchmarkEvent = matchingBar(input.benchmarkBars, eventBar.timestamp);
  const benchmarkFinal = matchingBar(input.benchmarkBars, finalBar.timestamp);
  const benchmarkReturn = benchmarkEvent && benchmarkFinal ? returnPct(benchmarkEvent.close, benchmarkFinal.close) : null;
  const benchmarkAdjustedReturnPct = rawReturnPct !== null && benchmarkReturn !== null ? round(rawReturnPct - benchmarkReturn) : null;
  const warnings = [
    '单事件样本，不能代表稳定统计规律。',
    ...(outcomeBars.length < afterBars ? [`可用后窗口仅 ${outcomeBars.length}/${afterBars} 根K线。`] : []),
    ...(input.benchmarkBars && benchmarkAdjustedReturnPct === null ? ['基准时间索引不完整，未计算基准调整收益。'] : []),
  ];
  return {
    id: `event_study_${crypto.randomUUID()}`,
    market: input.market,
    instrument: input.instrument,
    eventAt: new Date(eventBar.timestamp).toISOString(),
    eventBar,
    window,
    rawReturnPct: round(rawReturnPct),
    benchmarkAdjustedReturnPct,
    mfePct,
    maePct,
    recoveryBars,
    sampleSize: 1,
    warnings,
    disclaimer: '这是历史事件窗口统计，不是价格预测，也不构成交易指令。',
    createdAt: new Date().toISOString(),
  };
}

export class EventStudyRepository {
  constructor(private readonly store: StateDocumentStore, private readonly key = STORAGE_KEY) {}

  save(input: Partial<EventStudyRecord> & Pick<EventStudyRecord, 'id' | 'market' | 'instrument' | 'eventAt'>): EventStudyRecord {
    assertMarketContext({ market: input.market, workspace: 'event-study', instrument: input.instrument });
    const current = this.store.get<EventStudyRecord[]>(this.key) || [];
    const record: EventStudyRecord = {
      id: input.id,
      market: input.market,
      instrument: input.instrument,
      eventAt: input.eventAt,
      eventBar: input.eventBar || { timestamp: input.eventAt, open: 0, high: 0, low: 0, close: 0 },
      window: input.window || [],
      rawReturnPct: input.rawReturnPct ?? null,
      benchmarkAdjustedReturnPct: input.benchmarkAdjustedReturnPct ?? null,
      mfePct: input.mfePct ?? null,
      maePct: input.maePct ?? null,
      recoveryBars: input.recoveryBars ?? null,
      sampleSize: input.sampleSize ?? 0,
      warnings: input.warnings || ['尚未执行事件窗口计算。'],
      disclaimer: input.disclaimer || '这是历史事件窗口统计，不是价格预测，也不构成交易指令。',
      createdAt: input.createdAt || new Date().toISOString(),
      asOf: input.asOf,
      title: input.title,
      eventCategory: input.eventCategory,
      cohort: input.cohort,
      source: input.source,
      sourceUrl: safeSourceUrl(input.sourceUrl),
      evidenceRefs: input.evidenceRefs || [],
    };
    const next = [...current.filter(item => item.id !== record.id), record].slice(-500);
    this.store.set(this.key, next, 1);
    return record;
  }

  get(id: string): EventStudyRecord | null { return (this.store.get<EventStudyRecord[]>(this.key) || []).find(item => item.id === id) || null; }

  list(market?: MarketId, instrument?: string): EventStudyRecord[] {
    return (this.store.get<EventStudyRecord[]>(this.key) || []).filter(item => (!market || item.market === market) && (!instrument || item.instrument === instrument));
  }
}
