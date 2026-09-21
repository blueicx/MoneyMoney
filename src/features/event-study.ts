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
  source?: string;
  sourceUrl?: string;
  evidenceRefs?: string[];
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
