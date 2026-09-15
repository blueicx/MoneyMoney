export const MARKET_IDS = ['stocks', 'options', 'crypto', 'prediction'] as const;
export type MarketId = typeof MARKET_IDS[number];
export type DataStatus = 'live' | 'delayed' | 'cached' | 'partial' | 'empty' | 'unavailable';

export interface MarketContext {
  market: MarketId;
  workspace: string;
  instrument?: string;
  timeframe?: string;
  dataStatus?: DataStatus;
  updatedAt?: number;
}

const MARKET_PREFIXES: Record<MarketId, readonly string[]> = {
  stocks: ['us'],
  options: ['option:', 'usoption:'],
  crypto: ['crypto:', 'binance:', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE'],
  prediction: ['prediction:', 'predict:', 'market:'],
};

function matchesMarketInstrument(market: MarketId, instrument: string): boolean {
  const value = instrument.trim();
  if (!value) return true;
  const lower = value.toLowerCase();
  if (market === 'stocks') return !/^(crypto:|binance:|prediction:|predict:|option:|usoption:)/i.test(value);
  if (market === 'options') return /^(option:|usoption:)/i.test(value);
  if (market === 'crypto') return /^(crypto:|binance:)/i.test(value) || MARKET_PREFIXES.crypto.some(prefix => value.toUpperCase().startsWith(prefix));
  return /^(prediction:|predict:|market:)/i.test(value);
}

export function assertMarketContext(input: MarketContext): MarketContext {
  if (!input || !MARKET_IDS.includes(input.market)) throw new Error('Invalid market context');
  if (!String(input.workspace || '').trim()) throw new Error('Workspace is required');
  if (input.instrument && !matchesMarketInstrument(input.market, input.instrument)) {
    throw new Error(`Instrument ${input.instrument} does not belong to market ${input.market}`);
  }
  if (input.updatedAt !== undefined && !Number.isFinite(input.updatedAt)) throw new Error('updatedAt must be finite');
  return { ...input, workspace: input.workspace.trim(), instrument: input.instrument?.trim() };
}

export type SourceType = 'official' | 'exchange' | 'vendor' | 'community' | 'internal';
export interface SourceEvidence {
  sourceName: string;
  sourceType: SourceType;
  url: string | null;
  urlStatus: 'valid' | 'missing';
  publishedAt: string | null;
  fetchedAt: string;
  status: DataStatus;
  quality: 'high' | 'medium' | 'low';
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

function isoOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function createSourceEvidence(input: Partial<SourceEvidence> & { sourceName: string; sourceType: SourceType; url?: string | null; publishedAt?: string | number | Date | null; fetchedAt?: string | number | Date }): SourceEvidence {
  if (!input.sourceName?.trim()) throw new Error('Source name is required');
  if (!['official', 'exchange', 'vendor', 'community', 'internal'].includes(input.sourceType)) throw new Error('Invalid source type');
  const url = safeHttpUrl(input.url);
  if (input.url && !url) throw new Error('Source URL must be http(s)');
  const fetchedAt = isoOrNull(input.fetchedAt) || new Date().toISOString();
  const publishedAt = isoOrNull(input.publishedAt);
  return {
    sourceName: input.sourceName.trim(), sourceType: input.sourceType, url, urlStatus: url ? 'valid' : 'missing',
    publishedAt, fetchedAt, status: input.status || 'live', quality: input.quality || 'medium',
  };
}

export interface ExperimentRecord {
  id: string;
  market: MarketId;
  instrument?: string;
  timeframe?: string;
  strategyId?: string;
  strategyVersion?: string;
  dataSource: string;
  dataFrom?: string;
  dataTo?: string;
  feeRate: number;
  slippage: number;
  seed: number;
  createdAt: string;
}

function assertDateRange(from?: string, to?: string): void {
  if (!from || !to) return;
  const start = new Date(from).getTime(); const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('Invalid experiment time range');
}

export function createExperimentRecord(input: Omit<Partial<ExperimentRecord>, 'id' | 'createdAt'> & { market: MarketId; dataSource?: string; dataFrom?: string; dataTo?: string }): ExperimentRecord {
  assertMarketContext({ market: input.market, workspace: 'experiment', instrument: input.instrument });
  assertDateRange(input.dataFrom, input.dataTo);
  const feeRate = Number(input.feeRate ?? 0); const slippage = Number(input.slippage ?? 0);
  if (!Number.isFinite(feeRate) || feeRate < 0 || !Number.isFinite(slippage) || slippage < 0) throw new Error('Invalid experiment cost model');
  const seed = Number.isInteger(input.seed) ? Number(input.seed) : 0;
  const stable = JSON.stringify({ market: input.market, instrument: input.instrument || '', timeframe: input.timeframe || '', strategyId: input.strategyId || '', strategyVersion: input.strategyVersion || '', dataSource: input.dataSource || 'unknown', dataFrom: input.dataFrom || '', dataTo: input.dataTo || '', feeRate, slippage, seed });
  let hash = 2166136261;
  for (let index = 0; index < stable.length; index += 1) hash = Math.imul(hash ^ stable.charCodeAt(index), 16777619);
  return {
    id: `exp_${(hash >>> 0).toString(36)}`,
    market: input.market, instrument: input.instrument?.trim(), timeframe: input.timeframe,
    strategyId: input.strategyId, strategyVersion: input.strategyVersion, dataSource: input.dataSource || 'unknown',
    dataFrom: input.dataFrom, dataTo: input.dataTo, feeRate, slippage, seed, createdAt: new Date().toISOString(),
  };
}

export type SignalState = 'generated' | 'confirmed' | 'paper-filled' | 'tracking' | 'invalidated' | 'closed' | 'reviewed';
export type SignalEvent = 'confirm' | 'paper-fill' | 'track' | 'invalidate' | 'close' | 'review';

const SIGNAL_TRANSITIONS: Record<SignalState, Partial<Record<SignalEvent, SignalState>>> = {
  generated: { confirm: 'confirmed' }, confirmed: { 'paper-fill': 'paper-filled' }, 'paper-filled': { track: 'tracking' },
  tracking: { invalidate: 'invalidated', close: 'closed' }, invalidated: { review: 'reviewed' }, closed: { review: 'reviewed' }, reviewed: {},
};

export function transitionSignal(state: SignalState, event: SignalEvent): SignalState {
  const next = SIGNAL_TRANSITIONS[state]?.[event];
  if (!next) throw new Error(`Invalid signal transition: ${state} -> ${event}`);
  return next;
}
