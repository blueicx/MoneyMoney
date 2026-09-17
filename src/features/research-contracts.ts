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
  if (market === 'stocks') {
    if (/^(crypto:|binance:|prediction:|predict:|option:|usoption:)/i.test(value)) return false;
    return !/^(BTC|ETH|BNB|SOL|XRP|DOGE)(USDT|USDC)?$/i.test(value);
  }
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

export interface StrategyDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  market: MarketId;
  cycle: string;
  capability: string[];
  source: string;
  availability: string;
}

export function createStrategyDefinition(input: Partial<StrategyDefinition>): StrategyDefinition {
  if (!input.id || !input.version) throw new Error('Strategy ID and version are required');
  assertMarketContext({ market: input.market as MarketId, workspace: 'strategy' });
  return {
    id: input.id,
    name: input.name || input.id,
    version: input.version,
    description: input.description,
    market: input.market as MarketId,
    cycle: input.cycle || 'unknown',
    capability: Array.isArray(input.capability) ? input.capability : [],
    source: input.source || 'unknown',
    availability: input.availability || 'unknown'
  };
}

export interface DataSourceDefinition {
  id: string;
  name: string;
  type: SourceType;
  quality: 'high' | 'medium' | 'low';
  market: MarketId;
  cycle: string;
  capability: string[];
  source: string;
  availability: string;
}

export function createDataSourceDefinition(input: Partial<DataSourceDefinition>): DataSourceDefinition {
  if (!input.id || !input.name) throw new Error('DataSource ID and name are required');
  assertMarketContext({ market: input.market as MarketId, workspace: 'datasource' });
  return {
    id: input.id,
    name: input.name,
    type: input.type || 'internal',
    quality: input.quality || 'medium',
    market: input.market as MarketId,
    cycle: input.cycle || 'unknown',
    capability: Array.isArray(input.capability) ? input.capability : [],
    source: input.source || 'unknown',
    availability: input.availability || 'unknown'
  };
}

export type JobStatus = 'queued' | 'running' | 'paused' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled';
export interface ResearchJob {
  id: string;
  market: MarketId;
  workspace: string;
  status: JobStatus;
  progress: number;
  errorReason?: string;
  inputSummary: string;
  strategyVersion?: string;
  dataSnapshotId?: string;
  artifactHash?: string;
  createdAt: string;
  updatedAt: string;
}

export function createResearchJob(input: Partial<ResearchJob>): ResearchJob {
  assertMarketContext({ market: input.market as MarketId, workspace: input.workspace as string });
  const now = new Date().toISOString();
  return {
    id: input.id || `job_${Date.now()}_${Math.floor(Math.random()*1000)}`,
    market: input.market as MarketId,
    workspace: input.workspace as string,
    status: input.status || 'queued',
    progress: input.progress || 0,
    errorReason: input.errorReason,
    inputSummary: input.inputSummary || '',
    strategyVersion: input.strategyVersion,
    dataSnapshotId: input.dataSnapshotId,
    artifactHash: input.artifactHash,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

export interface ArtifactManifest { id: string; jobId: string; hash: string; uri: string; createdAt: string; }
export function createArtifactManifest(input: Partial<ArtifactManifest>): ArtifactManifest {
  if (!input.id || !input.jobId || !input.uri) throw new Error('Artifact ID, jobId and uri are required');
  return { id: input.id, jobId: input.jobId, hash: input.hash || '', uri: input.uri, createdAt: input.createdAt || new Date().toISOString() };
}
export interface ReviewRecord { id: string; targetId: string; reviewer: string; outcome: 'approved' | 'rejected' | 'needs_work'; notes?: string; createdAt: string; }
export function createReviewRecord(input: Partial<ReviewRecord>): ReviewRecord {
  if (!input.id || !input.targetId || !input.reviewer) throw new Error('ReviewRecord ID, targetId and reviewer are required');
  return { id: input.id, targetId: input.targetId, reviewer: input.reviewer, outcome: input.outcome || 'needs_work', notes: input.notes, createdAt: input.createdAt || new Date().toISOString() };
}
export interface SignalLifecycle { signalId: string; state: SignalState; history: { state: SignalState, at: string }[]; }
export function createSignalLifecycle(input: Partial<SignalLifecycle>): SignalLifecycle {
  if (!input.signalId) throw new Error('SignalLifecycle signalId is required');
  return { signalId: input.signalId, state: input.state || 'generated', history: Array.isArray(input.history) ? input.history : [] };
}

// newly added domain contracts
export interface InstrumentRef { id: string; symbol: string; exchange?: string; context: MarketContext; }
export function createInstrumentRef(input: Partial<InstrumentRef>): InstrumentRef {
  if (!input.id || !input.symbol || !input.context) throw new Error('InstrumentRef requires id, symbol, and context');
  return { id: input.id, symbol: input.symbol, exchange: input.exchange, context: assertMarketContext(input.context) };
}

export interface DataSnapshot { id: string; context: MarketContext; fromTime: string; toTime: string; hash: string; }
export function createDataSnapshot(input: Partial<DataSnapshot>): DataSnapshot {
  if (!input.id || !input.context || !input.fromTime || !input.toTime || !input.hash) throw new Error('DataSnapshot requires id, context, fromTime, toTime, hash');
  return { id: input.id, context: assertMarketContext(input.context), fromTime: input.fromTime, toTime: input.toTime, hash: input.hash };
}

export interface FeatureSpec { id: string; context: MarketContext; parameters: Record<string, unknown>; version: string; }
export function createFeatureSpec(input: Partial<FeatureSpec>): FeatureSpec {
  if (!input.id || !input.context || !input.version) throw new Error('FeatureSpec requires id, context, version');
  return { id: input.id, context: assertMarketContext(input.context), parameters: input.parameters || {}, version: input.version };
}

export interface OrderEvent { id: string; context: MarketContext; orderType: string; status: string; price: number; amount: number; timestamp: string; }
export function createOrderEvent(input: Partial<OrderEvent>): OrderEvent {
  if (!input.id || !input.context || !input.orderType || !input.status || input.price === undefined || input.amount === undefined) throw new Error('OrderEvent missing required fields');
  return { id: input.id, context: assertMarketContext(input.context), orderType: input.orderType, status: input.status, price: input.price, amount: input.amount, timestamp: input.timestamp || new Date().toISOString() };
}

export interface PaperPosition { id: string; context: MarketContext; instrument: string; averagePrice: number; amount: number; unrealizedPnl: number; }
export function createPaperPosition(input: Partial<PaperPosition>): PaperPosition {
  if (!input.id || !input.context || !input.instrument || input.averagePrice === undefined || input.amount === undefined) throw new Error('PaperPosition missing required fields');
  return { id: input.id, context: assertMarketContext(input.context), instrument: input.instrument, averagePrice: input.averagePrice, amount: input.amount, unrealizedPnl: input.unrealizedPnl || 0 };
}

export interface EvidenceBundle { id: string; context: MarketContext; artifacts: string[]; createdAt: string; }
export function createEvidenceBundle(input: Partial<EvidenceBundle>): EvidenceBundle {
  if (!input.id || !input.context) throw new Error('EvidenceBundle requires id and context');
  return { id: input.id, context: assertMarketContext(input.context), artifacts: input.artifacts || [], createdAt: input.createdAt || new Date().toISOString() };
}

export interface LineageRef { id: string; context: MarketContext; sourceId: string; derivedId: string; operation: string; }
export function createLineageRef(input: Partial<LineageRef>): LineageRef {
  if (!input.id || !input.context || !input.sourceId || !input.derivedId || !input.operation) throw new Error('LineageRef requires id, context, sourceId, derivedId, operation');
  return { id: input.id, context: assertMarketContext(input.context), sourceId: input.sourceId, derivedId: input.derivedId, operation: input.operation };
}

export interface AlertDelivery {
  id: string;
  context: MarketContext;
  alertId: string;
  status: string;
  channel?: 'web' | 'telegram';
  payload?: { message?: string; chatId?: string };
  attempts?: number;
  lastError?: string;
  lastAttemptAt?: string;
  deliveredAt?: string;
}
export function createAlertDelivery(input: Partial<AlertDelivery>): AlertDelivery {
  if (!input.id || !input.context || !input.alertId || !input.status) throw new Error('AlertDelivery requires id, context, alertId, status');
  return {
    id: input.id, context: assertMarketContext(input.context), alertId: input.alertId, status: input.status,
    channel: input.channel, payload: input.payload, attempts: input.attempts ?? 0,
    lastError: input.lastError, lastAttemptAt: input.lastAttemptAt, deliveredAt: input.deliveredAt,
  };
}
