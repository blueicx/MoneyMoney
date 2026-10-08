/**
 * AI Paper Trading Runner
 * Lets the user allocate a virtual budget to a single market and have the
 * built-in signal engine autonomously open/close paper positions.
 *
 * Each runner keeps its own mini-portfolio so results are isolated from the
 * shared paper-trading account.
 */

import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { DATA_ROOT, ensureDir } from '../utils/paths';
import { stateStore } from '../storage/sqlite-state';
import { unifiedPaperLedgerStore, type UnifiedPaperInstrumentType } from './unified-paper-trading';
import type { StockQuote } from './stock-data-contracts';
import { stockQuoteObservationTime } from './stock-signal-schedule';
import type { PredictionExecutionContract } from './runner-prediction-quotes';
import { predictionOutcomeQuote, predictionSettlementRulesGate } from './runner-prediction-quotes';

export type AiRunnerVenue = 'Binance' | 'Predict.fun' | 'Stocks' | 'Options';
export type AiRunnerStatus = 'RUNNING' | 'STOPPED';
export type AiRunnerMode = 'rules' | 'ai-review' | 'ai-autonomous-paper';
export type AiRunnerTrigger = 'signal' | 'scheduled';
export type AiRunnerMarket = 'stocks' | 'options' | 'crypto' | 'prediction';

export interface AiRunnerInstrumentRef {
  venue: AiRunnerVenue;
  symbolOrMarketId: string;
  title?: string;
}

export interface AiRunnerUniverse {
  kind: 'single' | 'watchlist';
  market: AiRunnerMarket;
  instruments: readonly AiRunnerInstrumentRef[];
  hash: string;
  frozenAt: string;
  sourceWatchlistId?: string;
}

export interface AiRunnerDecisionRecord {
  id: string;
  runnerId: string;
  idempotencyKey: string;
  at: string;
  market: AiRunnerMarket;
  instrument: string;
  dataStatus: string;
  source?: string;
  dataAt?: string;
  evidence?: AiRunnerDataEvidence[];
  snapshotHash?: string;
  strategyVersion?: string;
  modelVersion?: string;
  /** Explicit outcome/position direction used to bind the paper fill to its decision. */
  side?: 'YES' | 'NO' | 'LONG' | 'SHORT';
  signals: string[];
  riskChecks: Array<{ name: string; passed: boolean; reason?: string }>;
  action: 'BUY' | 'SELL' | 'NONE' | 'REJECTED' | 'REVIEW';
  reason: string;
  orderId?: string;
}

export interface AiRunnerDataEvidence {
  dataset: 'bars' | 'quote' | 'market' | 'settlement-rules';
  source: string;
  status: string;
  dataAt?: string;
  retrievedAt?: string;
  reason?: string;
}

export interface AiRunnerModelIntent {
  action: 'BUY' | 'SELL' | 'HOLD';
  instrument: string;
  market?: AiRunnerMarket;
  side?: 'YES' | 'NO' | 'LONG';
  confidence: number;
  rationale: string;
  counterEvidence: string[];
  riskNotes: string[];
}

export interface AiRunnerPolicy {
  allowedSymbols: string[];
  maxTradeUsd: number;
  maxBudgetUsd: number;
  maxPositions: number;
  maxDailyLossUsd: number;
  maxDrawdownPct: number;
  minFreshnessMs: number;
  cooldownMinutes: number;
  maxPerInstrumentUsd?: number;
  maxInvestedUsd?: number;
  feeRateBps?: number;
  additionalSlippageBps?: number;
}

export interface AiRunnerTrade {
  id: string;
  action: 'BUY' | 'SELL';
  side?: 'YES' | 'NO' | 'LONG' | 'SHORT';
  price: number;
  quantity: number;
  reasonZh: string;
  timestamp: string;
  orderId?: string;
  feeUsd?: number;
  slippageUsd?: number;
  /** Estimated half-spread versus midpoint; fill price already crosses the spread. */
  spreadUsd?: number;
}

export interface AiRunnerPosition {
  id: string;
  instrumentId?: string;
  instrument?: AiRunnerInstrumentRef;
  side?: 'YES' | 'NO' | 'LONG' | 'SHORT';
  entryPrice: number;
  quantity: number;
  entryTime: string;
  exitPrice?: number;
  exitTime?: string;
  pnlUsd?: number;
  currentPrice?: number;
  markStatus?: 'live' | 'delayed' | 'cached' | 'stale' | 'unavailable';
  markSource?: string;
  markUpdatedAt?: string;
  maxFavorablePnlUsd?: number;
  maxAdversePnlUsd?: number;
  entryFeeUsd?: number;
  entrySlippageUsd?: number;
  exitFeeUsd?: number;
  exitSlippageUsd?: number;
  entrySpreadUsd?: number;
  exitSpreadUsd?: number;
  status: 'OPEN' | 'CLOSED';
}

export interface AiRunnerBenchmark {
  market: AiRunnerMarket;
  instrument: string;
  startPrice: number;
  currentPrice: number;
  allocationUsd: number;
  observedAt: string;
  updatedAt: string;
  source?: string;
}

export interface AiRunnerEquityPoint {
  at: string;
  equityUsd: number;
  drawdownPct: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  feeSlippageUsd: number;
  spreadCostUsd?: number;
  dataStatus: string;
  snapshotHash?: string;
}

export interface AiRunner {
  id: string;
  venue: AiRunnerVenue;
  symbolOrMarketId: string;
  title: string;
  budgetUsd: number;
  cashUsd: number;
  status: AiRunnerStatus;
  createdAt: string;
  stoppedAt?: string;
  lastRunAt?: string;
  positions: AiRunnerPosition[];
  trades: AiRunnerTrade[];
  noteZh?: string;
  policy: AiRunnerPolicy;
  peakEquityUsd: number;
  lastActionAt?: string;
  circuitBreakerReason?: string;
  manualPaused?: boolean;
  strategyVersion?: string;
  model?: string;
  mode?: AiRunnerMode;
  modelSelection?: 'fixed' | 'available-free';
  quoteSelection?: 'fixed' | 'random-valid';
  trigger?: AiRunnerTrigger;
  universe?: AiRunnerUniverse;
  accountId?: string;
  executionState?: 'ready' | 'legacy-readonly';
  aiCalls?: Array<{ at: string; model?: string; decisionId: string }>;
  lastAiCallAt?: string;
  lastDataStatus?: string;
  lastDataSource?: string;
  lastDataAt?: string;
  lastDataReason?: string;
  lastSnapshotHash?: string;
  equityHistory?: AiRunnerEquityPoint[];
  benchmarks?: Record<string, AiRunnerBenchmark>;
  comparisonControl?: { groupId: string; seed: number; temperature: 0; configHash: string };
}

interface CreateAiRunnerOptions {
  mode?: AiRunnerMode;
  trigger?: AiRunnerTrigger;
  universe?: { kind?: 'single' | 'watchlist'; instruments?: AiRunnerInstrumentRef[]; sourceWatchlistId?: string };
  model?: string;
  comparisonControl?: AiRunner['comparisonControl'];
  createdAt?: string;
  startPaused?: boolean;
}

export interface AiRunnerQuote {
  predictionContract?:PredictionExecutionContract;
  outcome?:'YES'|'NO';
  tokenId?:string;
  optionContract?: { instrumentId:string; source:string; verified:boolean; currency:string; multiplier:number; expiresAt:string };
  market?: AiRunnerMarket;
  status?: string;
  dataStatus?: string;
  price: number;
  fetchedAt?: string;
  updatedAt?: string;
  source?: string;
  reason?: string;
  bestBid?: number;
  bestAsk?: number;
  bestBidSize?: number;
  bestAskSize?: number;
}

export function selectRunnerStockQuote(symbol: string, candidates: Array<{ source: string; status?: string; quote: StockQuote | null }>, maxAgeMs: number, now = Date.now(), random = Math.random): { source: string; quote: AiRunnerQuote } | null {
  const valid = candidates.filter(row => {
    const q = row.quote;
    if (!q || q.symbol.toUpperCase() !== symbol.toUpperCase() || q.currency !== 'USD' || q.isRealTime !== true || ['stale','unavailable','degraded'].includes(row.status || '')) return false;
    const at = stockQuoteObservationTime(q.asOf);
    return at != null && at <= now && now - at <= maxAgeMs && q.price > 0 && Number.isFinite(q.price)
      && Number.isFinite(q.bestBid) && Number(q.bestBid) > 0 && Number.isFinite(q.bestAsk) && Number(q.bestAsk) >= Number(q.bestBid);
  });
  if (!valid.length) return null;
  const selected = valid[Math.min(valid.length - 1, Math.max(0, Math.floor(random() * valid.length)))];
  const at = new Date(stockQuoteObservationTime(selected.quote!.asOf)!).toISOString();
  return { source: selected.source, quote: { market:'stocks', status:'live', dataStatus:'live', source:selected.source,
    price:selected.quote!.price, bestBid:selected.quote!.bestBid, bestAsk:selected.quote!.bestAsk, updatedAt:at, fetchedAt:at } };
}

export function selectControlledStockQuote(symbol: string, candidates: Parameters<typeof selectRunnerStockQuote>[1], maxAgeMs: number, now = Date.now()) {
  return selectRunnerStockQuote(symbol, candidates, maxAgeMs, now, () => 0);
}

export interface AiRunnerMarketState {
  market: AiRunnerMarket;
  status: string;
  executionStatus?: string;
  executionReason?: string;
  instrument?: string;
  source?: string;
  dataAt?: string;
  reason?: string;
  snapshotHash?: string;
  prices?: Record<string, number>;
  outcomeQuotes?: Record<string, AiRunnerQuote>;
}

export function evaluateRunnerIndicatorEvidence(
  evidence: Pick<AiRunnerDataEvidence, 'status' | 'dataAt' | 'retrievedAt'> | undefined,
  maxAgeMs: number,
  now = new Date(),
): { allowed: boolean; reason?: string; ageMs?: number } {
  if (!evidence || !['live', 'delayed'].includes(String(evidence.status || '').toLowerCase())) return { allowed: false, reason: '指标数据不可用' };
  const dataAt = Date.parse(String(evidence.dataAt || ''));
  const retrievedAt = Date.parse(String(evidence.retrievedAt || ''));
  if (!Number.isFinite(dataAt) || !Number.isFinite(retrievedAt)) return { allowed: false, reason: '指标数据缺少可验证时间' };
  if (dataAt > now.getTime() || retrievedAt > now.getTime()) return { allowed: false, reason: '指标数据时间晚于当前决策时间' };
  const ageMs = Math.max(now.getTime() - retrievedAt, now.getTime() - dataAt);
  if (ageMs > Math.max(1_000, maxAgeMs)) return { allowed: false, reason: '指标数据已过期' };
  return { allowed: true, ageMs };
}

const RUNNERS_FILE = path.join(DATA_ROOT, 'ai-paper-runners.json');
const MAX_RUNNERS = 10;
const MAX_TRADES_PER_RUNNER = 200;

function loadRunners(): AiRunner[] {
  ensureDir(DATA_ROOT);
  const stored = stateStore.get<AiRunner[]>('ai-paper-runners');
  if (stored) return stored;
  try {
    const parsed = JSON.parse(fs.readFileSync(RUNNERS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveRunners(runners: AiRunner[]): void {
  ensureDir(DATA_ROOT);
  stateStore.set('ai-paper-runners', runners, 1);
}

function venueMarket(venue: AiRunnerVenue): AiRunnerMarket {
  if (venue === 'Stocks') return 'stocks';
  if (venue === 'Options') return 'options';
  if (venue === 'Binance') return 'crypto';
  return 'prediction';
}

export function freezeAiRunnerUniverse(
  source: AiRunnerInstrumentRef[],
  options: { kind?: 'single' | 'watchlist'; sourceWatchlistId?: string } = {},
  at = new Date(),
): AiRunnerUniverse {
  if (!Array.isArray(source) || source.length < 1) throw new Error('跑单标的范围不能为空');
  const kind = options.kind || (source.length > 1 ? 'watchlist' : 'single');
  if (!['single', 'watchlist'].includes(kind)) throw new Error('跑单范围类型无效');
  if (kind === 'single' && source.length !== 1) throw new Error('单标的跑单只能选择一个标的');
  if (kind === 'watchlist' && (source.length < 1 || source.length > 5)) throw new Error('自选组跑单最多允许 5 个标的');
  const market = venueMarket(source[0].venue);
  if (source.some(item => venueMarket(item.venue) !== market)) throw new Error('跑单标的不能跨市场');
  const normalized = source.map(item => {
    if (!['Stocks', 'Options', 'Binance', 'Predict.fun'].includes(item.venue)) throw new Error('跑单市场无效');
    const symbolOrMarketId = String(item.symbolOrMarketId || '').trim().toUpperCase();
    if (!symbolOrMarketId) throw new Error('跑单标的标识不能为空');
    if (item.venue === 'Stocks' && !/^[A-Z][A-Z0-9.:-]{0,19}$/.test(symbolOrMarketId)) throw new Error('股票标的格式无效');
    if (item.venue === 'Binance' && !/^[A-Z0-9]{1,20}USDT$/.test(symbolOrMarketId)) throw new Error('当前跑单只支持 USDT 计价的币安现货交易对，以避免把其他计价币误当美元');
    if (item.venue === 'Predict.fun' && !/^[A-Z0-9:_-]{1,80}$/.test(symbolOrMarketId)) throw new Error('预测市场 ID 格式无效');
    return Object.freeze({ venue: item.venue, symbolOrMarketId, ...(item.title ? { title: String(item.title).slice(0, 160) } : {}) });
  });
  const identities = normalized.map(item => `${item.venue}:${item.symbolOrMarketId}`);
  if (new Set(identities).size !== identities.length) throw new Error('自选组中存在重复标的');
  const instruments = Object.freeze(normalized.slice().sort((a, b) => `${a.venue}:${a.symbolOrMarketId}`.localeCompare(`${b.venue}:${b.symbolOrMarketId}`)));
  const identity = JSON.stringify({ version: 1, kind, market, sourceWatchlistId: options.sourceWatchlistId || null, instruments: instruments.map(({ venue, symbolOrMarketId }) => ({ venue, symbolOrMarketId })) });
  return Object.freeze({
    kind, market, instruments,
    hash: createHash('sha256').update(identity).digest('hex'),
    frozenAt: at.toISOString(),
    ...(options.sourceWatchlistId ? { sourceWatchlistId: String(options.sourceWatchlistId) } : {}),
  });
}

export function normalizeAiRunnerStockKlines(rows: unknown[][]): unknown[][] {
  return rows.flatMap(row => {
    if (!Array.isArray(row) || row.length < 5) return [];
    const time = new Date(String(row[0])).getTime();
    const open = Number(row[1]);
    const close = Number(row[2]);
    const high = Number(row[3]);
    const low = Number(row[4]);
    const volume = Number(row[5] || 0);
    if (![time, open, close, high, low, volume].every(Number.isFinite) || Math.min(open, close, high, low) <= 0 || volume < 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high)) return [];
    return [[time, open, high, low, close, volume]];
  });
}

export function getAiRunnerRiskDefaults(budgetUsd: number, kind: 'single' | 'watchlist' = 'single'): AiRunnerPolicy {
  const budget = Math.max(1, Number(budgetUsd) || 1);
  const watchlist = kind === 'watchlist';
  return {
    allowedSymbols: [],
    maxTradeUsd: Math.max(1, Math.min(watchlist ? budget * 0.2 : 100, budget * (watchlist ? 0.2 : 0.25))),
    maxBudgetUsd: watchlist ? budget * 0.8 : budget,
    maxPositions: watchlist ? 5 : 1,
    maxDailyLossUsd: Math.max(1, budget * 0.1),
    maxDrawdownPct: 20,
    minFreshnessMs: 120_000,
    cooldownMinutes: 15,
    feeRateBps: 10,
    additionalSlippageBps: 0,
    ...(watchlist ? { maxPerInstrumentUsd: budget * 0.2, maxInvestedUsd: budget * 0.8 } : { maxPerInstrumentUsd: budget, maxInvestedUsd: budget }),
  };
}

function defaultPolicy(budgetUsd: number, symbol: string, kind: 'single' | 'watchlist' = 'single'): AiRunnerPolicy {
  return { ...getAiRunnerRiskDefaults(budgetUsd, kind), allowedSymbols: [symbol.toUpperCase()] };
}

function normalizeRunnerPolicy(
  base: AiRunnerPolicy,
  patch: Partial<AiRunnerPolicy>,
  budgetUsd: number,
  universe: AiRunnerUniverse,
): AiRunnerPolicy {
  const bounded = (key: keyof AiRunnerPolicy, fallback: number, min: number, max: number): number => {
    const raw = patch[key];
    const value = raw == null ? fallback : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`跑单风险参数 ${String(key)} 无效`);
    return Math.max(min, Math.min(max, value));
  };
  const maxBudgetUsd = bounded('maxBudgetUsd', base.maxBudgetUsd, 1, budgetUsd);
  const maxInvestedUsd = Math.min(maxBudgetUsd, bounded('maxInvestedUsd', base.maxInvestedUsd ?? base.maxBudgetUsd, 1, budgetUsd));
  const maxPerInstrumentUsd = Math.min(maxInvestedUsd, bounded('maxPerInstrumentUsd', base.maxPerInstrumentUsd ?? maxBudgetUsd, 1, budgetUsd));
  const positionLimit = universe.kind === 'single' ? 1 : universe.instruments.length;
  const maxPositions = Math.floor(bounded('maxPositions', base.maxPositions, 1, Math.max(1, Math.min(5, positionLimit))));
  return {
    ...base,
    ...patch,
    allowedSymbols: universe.instruments.map(item => item.symbolOrMarketId),
    maxBudgetUsd,
    maxInvestedUsd,
    maxPerInstrumentUsd,
    maxTradeUsd: Math.min(maxBudgetUsd, maxInvestedUsd, maxPerInstrumentUsd, bounded('maxTradeUsd', base.maxTradeUsd, 1, budgetUsd)),
    maxPositions,
    maxDailyLossUsd: bounded('maxDailyLossUsd', base.maxDailyLossUsd, 1, budgetUsd),
    maxDrawdownPct: bounded('maxDrawdownPct', base.maxDrawdownPct, 1, 100),
    minFreshnessMs: bounded('minFreshnessMs', base.minFreshnessMs, 1_000, 60 * 60_000),
    cooldownMinutes: bounded('cooldownMinutes', base.cooldownMinutes, 0, 24 * 60),
    feeRateBps: bounded('feeRateBps', base.feeRateBps ?? 10, 0, 500),
    additionalSlippageBps: bounded('additionalSlippageBps', base.additionalSlippageBps ?? 0, 0, 1_000),
  };
}

export function evaluateRunnerQuoteGate(
  policy: Pick<AiRunnerPolicy, 'minFreshnessMs'>,
  quote: AiRunnerQuote,
  now = new Date(),
): { allowed: boolean; reason?: string; ageMs?: number; status: string } {
  const status = String(quote.dataStatus || quote.status || 'unavailable').toLowerCase();
  if (status === 'failed' || status === 'unavailable' || status === 'empty' || status === 'unsupported') return { allowed: false, reason: status === 'failed' ? '行情来源不可用' : (quote.reason || '行情来源不可用'), status };
  if (status === 'cached') return { allowed: false, reason: '缓存报价不能触发新订单', status };
  if (!['live', 'delayed'].includes(status)) return { allowed: false, reason: quote.reason || '行情来源不可用', status };
  if (!Number.isFinite(quote.price) || quote.price <= 0) return { allowed: false, reason: '报价价格无效', status };
  const fetchedAt = Date.parse(String(quote.fetchedAt || quote.updatedAt || ''));
  const ageMs = now.getTime() - fetchedAt;
  if (!Number.isFinite(fetchedAt) || ageMs < 0) return { allowed: false, reason: '报价时间无效', status };
  if (ageMs > Math.max(1_000, policy.minFreshnessMs)) return { allowed: false, reason: '报价已过期', ageMs, status };
  return { allowed: true, ageMs, status };
}

export function resolveRunnerFill(
  policy: Pick<AiRunnerPolicy, 'minFreshnessMs'>,
  quote: AiRunnerQuote,
  action: 'BUY' | 'SELL',
  now = new Date(),
  quantity?: number,
): { allowed: boolean; reason?: string; price?: number; bestBid?: number; bestAsk?: number; midpoint?: number } {
  const gate = evaluateRunnerQuoteGate(policy, quote, now);
  if (!gate.allowed) return gate;
  if (quote.market === 'prediction') {
    const settlementGate = predictionSettlementRulesGate(quote);
    // Opening adds settlement-rule exposure; reducing an already-held, verified
    // outcome may still use the validated live book even while new entries wait.
    if (action === 'BUY' && !settlementGate.allowed) return { allowed: false, reason: settlementGate.reason };
    const verifiedQuote = predictionOutcomeQuote(quote, quote.outcome, now, policy.minFreshnessMs);
    if (!['live', 'delayed'].includes(String(verifiedQuote.dataStatus || verifiedQuote.status || ''))) {
      return { allowed: false, reason: verifiedQuote.reason || '预测市场 outcome 合约身份未核验' };
    }
    quote = verifiedQuote;
  }
  if (quote.market === 'options') {
    const c = quote.optionContract;
    if (!c || c.verified !== true || !c.source?.trim() || !/^option:[^:]+:.+/.test(c.instrumentId) || c.currency !== 'USD' || !Number.isFinite(c.multiplier) || c.multiplier <= 0 || !Number.isFinite(Date.parse(c.expiresAt)) || Date.parse(c.expiresAt) <= now.getTime()) return { allowed:false,reason:'期权合约身份、币种、乘数或到期信息尚未核验' };
    const identity = /^option:(?:us|cboe):([A-Z][A-Z0-9.]{0,9}):(\d{4}-\d{2}-\d{2}):(\d+(?:\.\d+)?):([CP])$/.exec(c.instrumentId);
    const date = identity?.[2], day = date ? Date.parse(date+'T00:00:00Z') : NaN;
    if (!identity || !Number.isFinite(day) || new Date(day).toISOString().slice(0,10)!==date || Number(identity[3])<=0 || new Date(c.expiresAt).toISOString().slice(0,10)!==date) return { allowed:false,reason:'期权必须是完整合约身份，行权价和到期日必须与来源一致' };
  }
  const bestBid = Number(quote.bestBid);
  const bestAsk = Number(quote.bestAsk);
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestBid <= 0 || bestAsk < bestBid) {
    return { allowed: false, reason: '盘口缺少有效买卖价，无法确认模拟成交' };
  }
  if (quote.market === 'prediction') {
    const visibleSize = action === 'BUY' ? Number(quote.bestAskSize) : Number(quote.bestBidSize);
    if (!Number.isFinite(visibleSize) || visibleSize <= 0) return { allowed: false, reason: '预测市场订单簿缺少所选方向的顶层可见深度' };
    if (quantity != null && (!Number.isFinite(quantity) || quantity <= 0 || quantity > visibleSize + 1e-9)) {
      return { allowed: false, reason: `模拟数量超过顶层可见深度（可见 ${visibleSize}，请求 ${quantity}）` };
    }
  }
  const price = action === 'BUY' ? bestAsk : bestBid;
  if (price <= 0 || (quote.market === 'prediction' && price >= 1)) return { allowed: false, reason: '盘口价格超出市场结算范围' };
  return { allowed: true, price, bestBid, bestAsk, midpoint: (bestBid + bestAsk) / 2 };
}

export function calculateRunnerExecutionCosts(
  policy: Pick<AiRunnerPolicy, 'feeRateBps' | 'additionalSlippageBps'>,
  quote: AiRunnerQuote,
  action: 'BUY' | 'SELL',
  quantity: number,
): { feeUsd: number; slippageUsd: number; spreadUsd: number } {
  const fill = resolveRunnerFill({ minFreshnessMs: Number.MAX_SAFE_INTEGER }, quote, action, new Date(quote.fetchedAt || quote.updatedAt || Date.now()), quantity);
  if (!fill.allowed || fill.price == null || fill.midpoint == null || !Number.isFinite(quantity) || quantity <= 0) throw new Error(fill.reason || '模拟成本参数无效');
  if (quote.market === 'options' && !Number.isSafeInteger(quantity)) throw new Error('期权合约数量必须为正整数');
  const multiplier = quote.market === 'options' ? quote.optionContract!.multiplier : 1;
  const notional = fill.price * quantity * multiplier;
  const feeUsd = notional * Math.max(0, Number(policy.feeRateBps) || 0) / 10_000;
  const additionalSlippage = notional * Math.max(0, Number(policy.additionalSlippageBps) || 0) / 10_000;
  return {
    feeUsd: Math.round(feeUsd * 1_000_000) / 1_000_000,
    // A buy fills at ask and a sell at bid, so spread cost is already reflected in fill-to-fill PnL.
    // Keep it as an evidence metric, not another cash deduction.
    slippageUsd: Math.round(additionalSlippage * 1_000_000) / 1_000_000,
    spreadUsd: Math.round((Math.abs(quote.bestAsk! - quote.bestBid!) / 2 * quantity * multiplier) * 1_000_000) / 1_000_000,
  };
}

export function isAiRunnerCallAllowed(
  runner: Pick<AiRunner, 'aiCalls'>,
  configured: boolean,
  now = new Date(),
): { allowed: boolean; reason?: string; callsToday: number } {
  if (!configured) return { allowed: false, reason: '未配置 OpenRouter，AI 跑单不可用', callsToday: 0 };
  const day = now.toISOString().slice(0, 10);
  const callsToday = (runner.aiCalls || []).filter(item => {
    const timestamp = Date.parse(item.at);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day;
  }).length;
  return callsToday >= 24
    ? { allowed: false, reason: '已达到该跑单每日 24 次 AI 调用上限', callsToday }
    : { allowed: true, callsToday };
}

export function evaluateAiRunnerTrigger(
  runner: Pick<AiRunner, 'mode' | 'trigger' | 'lastAiCallAt'>,
  candidateSignal: boolean,
  now = new Date(),
): { allowed: boolean; reason?: string; nextAllowedAt?: string } {
  if (runner.mode === 'rules') return { allowed: false, reason: '规则模式不调用 AI' };
  const scheduled = (runner.trigger || 'scheduled') === 'scheduled';
  if (!scheduled && !candidateSignal) return { allowed: false, reason: '当前没有候选信号' };
  const cooldownMs = scheduled ? 60 * 60_000 : 15 * 60_000;
  const previous = runner.lastAiCallAt ? Date.parse(runner.lastAiCallAt) : Number.NaN;
  if (Number.isFinite(previous)) {
    const elapsed = now.getTime() - previous;
    if (elapsed < 0) return { allowed: false, reason: '上次 AI 执行时间晚于当前时间' };
    if (elapsed < cooldownMs) {
      const nextAllowedAt = new Date(previous + cooldownMs).toISOString();
      return {
        allowed: false,
        reason: scheduled ? '定时 AI 扫描每小时最多一次' : '候选信号触发至少间隔 15 分钟',
        nextAllowedAt,
      };
    }
  }
  return { allowed: true };
}

export function validateAiRunnerModelIntent(
  input: unknown,
  runner: Pick<AiRunner, 'universe'>,
): { ok: true; intent: AiRunnerModelIntent } | { ok: false; reason: string } {
  let value: unknown = input;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return { ok: false, reason: 'AI 意图格式无效' }; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'AI 意图格式无效' };
  const row = value as Record<string, unknown>;
  const allowedKeys = new Set(['action', 'instrument', 'side', 'confidence', 'rationale', 'counterEvidence', 'riskNotes', 'market']);
  if (Object.keys(row).some(key => !allowedKeys.has(key))) return { ok: false, reason: 'AI 意图包含未允许的字段' };
  const action = String(row.action || '').toUpperCase();
  if (!['BUY', 'SELL', 'HOLD'].includes(action)) return { ok: false, reason: 'AI 意图动作无效' };
  const instrument = String(row.instrument || '').trim().toUpperCase();
  const frozen = runner.universe?.instruments || [];
  const matched = frozen.find(item => item.symbolOrMarketId === instrument);
  if (!matched) return { ok: false, reason: 'AI 意图标的不在冻结范围内' };
  if (row.market != null && String(row.market) !== runner.universe?.market) return { ok: false, reason: 'AI 意图市场与冻结范围不一致' };
  const confidence = Number(row.confidence);
  const rationale = String(row.rationale || '').trim();
  const list = (value: unknown) => Array.isArray(value) && value.length <= 6 && value.every(item => typeof item === 'string' && item.trim().length <= 240);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1 || rationale.length < 8 || rationale.length > 500 || !list(row.counterEvidence) || !list(row.riskNotes)) {
    return { ok: false, reason: 'AI 意图字段未通过结构校验' };
  }
  const side = row.side == null ? undefined : String(row.side).toUpperCase();
  if (side && (runner.universe?.market === 'prediction' ? !['YES', 'NO'].includes(side) : side !== 'LONG')) {
    return { ok: false, reason: 'AI 意图方向超出允许范围' };
  }
  return {
    ok: true,
    intent: {
      action: action as AiRunnerModelIntent['action'], instrument,
      ...(row.market != null ? { market: runner.universe?.market } : {}),
      ...(side ? { side: side as AiRunnerModelIntent['side'] } : {}),
      confidence, rationale,
      counterEvidence: (row.counterEvidence as string[]).map(item => item.trim()).filter(Boolean),
      riskNotes: (row.riskNotes as string[]).map(item => item.trim()).filter(Boolean),
    },
  };
}

function normalizeRunner(runner: AiRunner): AiRunner {
  const accountId = runner.accountId || `ai-runner:${runner.id}`;
  const account = runner.accountId ? unifiedPaperLedgerStore.getRunnerAccount(accountId) : null;
  const expectedOpen = new Map<string, number>();
  for (const position of Array.isArray(runner.positions) ? runner.positions.filter(item => item.status === 'OPEN') : []) {
    const instrument = position.instrument || { venue: runner.venue, symbolOrMarketId: runner.symbolOrMarketId };
    const ledgerIdentity = toLedgerInstrument(instrument.venue, instrument.symbolOrMarketId);
    const outcome = instrument.venue === 'Predict.fun' ? (position.side === 'NO' ? 'NO' : 'YES') : '';
    const key = `${ledgerIdentity.instrumentId}:${outcome}`;
    expectedOpen.set(key, (expectedOpen.get(key) || 0) + Number(position.quantity || 0));
  }
  const actualOpen = new Map<string, number>();
  for (const position of account?.positions || []) {
    const key = `${position.instrumentId}:${position.instrumentType === 'prediction' ? position.outcome || '' : ''}`;
    actualOpen.set(key, (actualOpen.get(key) || 0) + Number(position.quantity || 0));
  }
  const tradesLinked = Array.isArray(runner.trades) && runner.trades.every(trade => Boolean(trade.orderId && account?.orders.some(order => order.id === trade.orderId)));
  const positionsLinked = expectedOpen.size === actualOpen.size && [...expectedOpen].every(([key, quantity]) => Math.abs(quantity - (actualOpen.get(key) || 0)) < 1e-6);
  const ledgerVerified = Boolean(account && account.runnerId === runner.id && Math.abs(account.cash - Number(runner.cashUsd)) < 0.01 && tradesLinked && positionsLinked);
  const legacy = !ledgerVerified;
  const venue: AiRunnerVenue = ['Binance', 'Predict.fun', 'Stocks', 'Options'].includes(runner.venue) ? runner.venue : 'Stocks';
  const universe = runner.universe || freezeAiRunnerUniverse([
    { venue, symbolOrMarketId: String(runner.symbolOrMarketId || ''), title: runner.title },
  ], { kind: 'single' }, new Date(runner.createdAt || Date.now()));
  return {
    ...runner,
    mode: runner.mode || 'rules',
    trigger: runner.trigger || 'scheduled',
    universe,
    accountId,
    executionState: runner.executionState === 'legacy-readonly' || legacy ? 'legacy-readonly' : (runner.executionState || 'ready'),
    policy: { ...defaultPolicy(runner.budgetUsd, runner.symbolOrMarketId, universe.kind), ...(runner.policy || {}) },
    peakEquityUsd: Number.isFinite(runner.peakEquityUsd) ? runner.peakEquityUsd : runner.budgetUsd,
  };
}

export function evaluateRunnerOpen(runner: AiRunner, cost: number, at = new Date(), instrumentId?: string): { allowed: boolean; reason?: string } {
  const openCount = runner.positions.filter(position => position.status === 'OPEN').length;
  const day = at.toISOString().slice(0, 10);
  const dailyLoss = runner.positions
    .filter(position => position.status === 'CLOSED' && position.exitTime?.slice(0, 10) === day)
    .reduce((sum, position) => {
      const costs = Number(position.entryFeeUsd || 0) + Number(position.entrySlippageUsd || 0)
        + Number(position.exitFeeUsd || 0) + Number(position.exitSlippageUsd || 0);
      return sum + Math.min(0, Number(position.pnlUsd || 0) - costs);
    }, 0);
  const lastActionMs = runner.lastActionAt ? Date.parse(runner.lastActionAt) : 0;
  if (runner.status !== 'RUNNING') return { allowed: false, reason: '策略未运行' };
  if (runner.executionState === 'legacy-readonly') return { allowed: false, reason: '旧跑单无法核验到账本，当前为只读历史' };
  if (!Number.isFinite(cost) || cost <= 0) return { allowed: false, reason: '订单金额无效' };
  if (cost > runner.cashUsd) return { allowed: false, reason: '策略可用余额不足' };
  if (cost > runner.policy.maxTradeUsd) return { allowed: false, reason: '超过策略单笔限额' };
  const committedBudget = runner.positions
    .filter(position => position.status === 'OPEN')
    .reduce((sum, position) => sum + position.entryPrice * position.quantity, 0);
  if (runner.universe?.kind === 'watchlist' && instrumentId) {
    const instrumentExposure = runner.positions
      .filter(position => position.status === 'OPEN' && position.instrumentId === instrumentId)
      .reduce((sum, position) => sum + position.entryPrice * position.quantity, 0);
    if (instrumentExposure + cost > (runner.policy.maxPerInstrumentUsd ?? runner.policy.maxTradeUsd)) return { allowed: false, reason: '超过单标的投入上限' };
  }
  if (runner.universe?.kind === 'watchlist' && committedBudget + cost > (runner.policy.maxInvestedUsd ?? runner.policy.maxBudgetUsd)) return { allowed: false, reason: '超过组合总投入上限' };
  if (committedBudget + cost > runner.policy.maxBudgetUsd) return { allowed: false, reason: '超过策略预算' };
  if (openCount >= runner.policy.maxPositions) return { allowed: false, reason: '达到策略最大持仓数' };
  if (dailyLoss <= -Math.abs(runner.policy.maxDailyLossUsd)) return { allowed: false, reason: '触发策略单日亏损熔断' };
  if (lastActionMs && at.getTime() - lastActionMs < runner.policy.cooldownMinutes * 60_000) return { allowed: false, reason: '处于策略冷却时间' };
  return { allowed: true };
}

export function createAiRunner(
  venue: AiRunnerVenue,
  symbolOrMarketId: string,
  title: string,
  budgetUsd: number,
  policy?: Partial<AiRunnerPolicy>,
  options: CreateAiRunnerOptions = {},
): AiRunner {
  if (!Number.isFinite(budgetUsd) || budgetUsd < 1) throw new Error('跑单预算必须是至少 $1 的有限数值');
  if (options.mode != null && !['rules', 'ai-review', 'ai-autonomous-paper'].includes(options.mode)) throw new Error('跑单模式无效');
  if (options.trigger != null && !['scheduled', 'signal'].includes(options.trigger)) throw new Error('AI 触发方式无效');
  const runners = loadRunners();
  if (runners.filter(r => r.status === 'RUNNING').length >= MAX_RUNNERS) {
    throw new Error(`同时最多运行 ${MAX_RUNNERS} 个跑单`);
  }
  const requestedInstruments = options.universe?.instruments?.length
    ? options.universe.instruments
    : [{ venue, symbolOrMarketId, title }];
  const frozenUniverse = freezeAiRunnerUniverse(requestedInstruments, {
    kind: options.universe?.kind,
    sourceWatchlistId: options.universe?.sourceWatchlistId,
  });
  if (frozenUniverse.market === 'options') throw new Error('期权缺少满足模拟撮合要求的合约身份与买卖价数据，当前不可启动跑单');
  const primary = frozenUniverse.instruments[0];
  const id = `ar_${randomUUID()}`;
  const accountId = `ai-runner:${id}`;
  const runner: AiRunner = {
    id,
    accountId,
    venue: primary.venue,
    symbolOrMarketId: primary.symbolOrMarketId,
    title: primary.title || primary.symbolOrMarketId,
    budgetUsd,
    cashUsd: budgetUsd,
    status: options.startPaused ? 'STOPPED' : 'RUNNING',
    createdAt: options.createdAt || new Date().toISOString(),
    positions: [],
    trades: [],
    policy: normalizeRunnerPolicy(
      defaultPolicy(budgetUsd, primary.symbolOrMarketId, frozenUniverse.kind),
      policy || {}, budgetUsd, frozenUniverse,
    ),
    peakEquityUsd: budgetUsd,
    strategyVersion: options.mode === 'ai-review' ? 'ai-review-v1' : options.mode === 'ai-autonomous-paper' ? 'ai-autonomous-paper-v1' : 'rsi-sma-v1',
    mode: options.mode || 'rules',
    trigger: options.trigger || 'scheduled',
    universe: frozenUniverse,
    executionState: 'ready',
    ...(options.model ? { model: options.model } : {}),
    ...(options.comparisonControl ? { comparisonControl: options.comparisonControl } : {}),
  };
  stateStore.transaction(() => {
    runners.unshift(runner);
    saveRunners(runners);
    unifiedPaperLedgerStore.ensureRunnerAccount(accountId, id, budgetUsd);
  });
  return runner;
}

export function stopAiRunner(id: string): AiRunner | null {
  const runners = loadRunners().map(normalizeRunner);
  const runner = runners.find(r => r.id === id);
  if (!runner || runner.status === 'STOPPED') return null;
  runner.status = 'STOPPED';
  runner.stoppedAt = new Date().toISOString();
  runner.manualPaused = false;
  saveRunners(runners);
  return runner;
}

export function getAiRunners(): AiRunner[] {
  return loadRunners().map(normalizeRunner);
}

const RUNNER_DATA_STATUSES = new Set(['live', 'delayed', 'cached', 'partial', 'empty', 'unavailable', 'unsupported', 'failed', 'historical', 'stale']);

export function updateAiRunnerMarketState(id: string, input: AiRunnerMarketState, now = new Date()): AiRunner | null {
  return updateRunner(id, runner => {
    const scope = runner.universe?.market || venueMarket(runner.venue);
    if (input.market !== scope) {
      runner.lastDataStatus = 'unavailable';
      runner.lastDataReason = '行情市场与跑单冻结市场不一致，已拒绝估值';
      runner.lastRunAt = now.toISOString();
      return;
    }
    const status = RUNNER_DATA_STATUSES.has(String(input.status).toLowerCase()) ? String(input.status).toLowerCase() : 'unavailable';
    const dataAtMs = Date.parse(String(input.dataAt || ''));
    const ageMs = now.getTime() - dataAtMs;
    const freshStatus = ['live', 'delayed'].includes(status) && Number.isFinite(dataAtMs) && ageMs >= 0 && ageMs <= runner.policy.minFreshnessMs;
    const effectiveStatus = ['live', 'delayed'].includes(status) && !freshStatus ? 'stale' : status;
    const prices = new Map<string, number>();
    const positionMarks: Record<string, { status: 'live' | 'delayed' | 'stale' | 'unavailable'; source?: string; updatedAt?: string }> = {};
    if (freshStatus) {
      for (const position of runner.positions.filter(item => item.status === 'OPEN')) {
        const symbol = String(position.instrument?.symbolOrMarketId || runner.symbolOrMarketId).toUpperCase();
        const raw = input.prices?.[symbol] ?? input.prices?.[position.instrumentId || ''];
        const explicitlyTargeted = input.instrument?.toUpperCase() === symbol
          || Object.prototype.hasOwnProperty.call(input.prices || {}, symbol)
          || Object.prototype.hasOwnProperty.call(input.prices || {}, position.instrumentId || '');
        const instrumentId = position.instrumentId || toLedgerInstrument(position.instrument?.venue || runner.venue, symbol).instrumentId;
        let price = Number(raw);
        let selectedQuote: AiRunnerQuote | undefined;
        if (scope === 'prediction') {
          if (!explicitlyTargeted && !input.outcomeQuotes?.[instrumentId]) continue;
          const candidate = input.outcomeQuotes?.[instrumentId];
          selectedQuote = candidate?.market === 'prediction' && candidate.predictionContract?.instrumentId === instrumentId
            ? predictionOutcomeQuote(candidate, position.side, now, runner.policy.minFreshnessMs) : undefined;
          if (!selectedQuote || !['live', 'delayed'].includes(selectedQuote.dataStatus || selectedQuote.status || '')) {
            position.markStatus = selectedQuote?.status === 'stale' ? 'stale' : 'unavailable';
            positionMarks[`${instrumentId}:${position.side}`] = { status: position.markStatus, source: position.markSource, updatedAt: position.markUpdatedAt };
            continue;
          }
          price = selectedQuote.price;
        }
        if (Number.isFinite(price) && price > 0) {
          const markPrice = price;
          if (scope === 'prediction' && (markPrice <= 0 || markPrice >= 1)) {
            position.markStatus = 'unavailable';
            continue;
          }
          position.currentPrice = markPrice;
          position.markStatus = (selectedQuote?.dataStatus || selectedQuote?.status || effectiveStatus) as AiRunnerPosition['markStatus'];
          position.markSource = selectedQuote?.source || input.source;
          position.markUpdatedAt = selectedQuote?.updatedAt || input.dataAt;
          const unrealized = (markPrice - position.entryPrice) * position.quantity;
          position.maxFavorablePnlUsd = Math.max(Number(position.maxFavorablePnlUsd || 0), unrealized, 0);
          position.maxAdversePnlUsd = Math.min(Number(position.maxAdversePnlUsd || 0), unrealized, 0);
          prices.set(scope === 'prediction' ? `${instrumentId}:${position.side === 'NO' ? 'NO' : 'YES'}` : instrumentId, markPrice);
          if (scope === 'prediction') positionMarks[`${instrumentId}:${position.side}`] = { status: position.markStatus as 'live' | 'delayed', source: position.markSource, updatedAt: position.markUpdatedAt };
        } else if (explicitlyTargeted || (!input.instrument && runner.universe?.kind !== 'watchlist')) {
          position.markStatus = 'unavailable';
        }
      }
    } else if (effectiveStatus !== 'live' && effectiveStatus !== 'delayed') {
      for (const position of runner.positions.filter(item => item.status === 'OPEN')) {
        const symbol = String(position.instrument?.symbolOrMarketId || runner.symbolOrMarketId).toUpperCase();
        const explicitlyTargeted = input.instrument?.toUpperCase() === symbol;
        if (explicitlyTargeted || (!input.instrument && runner.universe?.kind !== 'watchlist')) {
          position.markStatus = effectiveStatus === 'cached' ? 'cached' : effectiveStatus === 'stale' ? 'stale' : 'unavailable';
          if (scope === 'prediction') {
            const instrumentId = position.instrumentId || toLedgerInstrument(position.instrument?.venue || runner.venue, symbol).instrumentId;
            positionMarks[`${instrumentId}:${position.side}`] = { status: effectiveStatus === 'stale' ? 'stale' : 'unavailable', source: position.markSource, updatedAt: position.markUpdatedAt };
          }
        }
      }
    }
    const openPositions = runner.positions.filter(position => position.status === 'OPEN');
    const markStatuses = openPositions.map(position => position.markStatus || 'unavailable');
    const hasFreshMark = markStatuses.some(mark => mark === 'live' || mark === 'delayed');
    const allFreshMarks = markStatuses.length > 0 && markStatuses.every(mark => mark === 'live' || mark === 'delayed');
    const ledgerStatus: 'live' | 'delayed' | 'cached' | 'stale' | 'unavailable' | 'partial' = !openPositions.length
      ? (['live', 'delayed', 'cached', 'stale', 'unavailable'].includes(effectiveStatus) ? effectiveStatus as typeof ledgerStatus : 'unavailable')
      : allFreshMarks
        ? (markStatuses.includes('delayed') ? 'delayed' : 'live')
        : hasFreshMark ? 'partial'
          : markStatuses.includes('stale') ? 'stale'
            : markStatuses.includes('cached') ? 'cached' : 'unavailable';
    const accountId = runner.accountId || `ai-runner:${runner.id}`;
    unifiedPaperLedgerStore.markRunnerAccountPrices(accountId, prices, {
      status: ledgerStatus, source: input.source, updatedAt: input.dataAt || now.toISOString(),
      positionStatus: (['live', 'delayed', 'cached', 'stale', 'unavailable'].includes(effectiveStatus) ? effectiveStatus : 'unavailable') as 'live' | 'delayed' | 'cached' | 'stale' | 'unavailable',
      positionMarks,
      reason: freshStatus ? undefined : (input.reason || (effectiveStatus === 'stale' ? '报价过期，保留上次估值' : undefined)),
    });
    const valuationFresh = freshStatus && (scope !== 'prediction' || !openPositions.length || allFreshMarks);
    runner.lastDataStatus = scope === 'prediction' && openPositions.length ? ledgerStatus : effectiveStatus;
    runner.lastDataSource = input.source;
    runner.lastDataAt = input.dataAt;
    runner.lastDataReason = input.executionStatus === 'unsupported'
      ? (input.executionReason || input.reason || '当前报价仅供只读估值，不满足纸面执行能力门槛')
      : valuationFresh ? undefined : (input.reason || (scope === 'prediction' ? '所持 outcome 缺少新鲜、已核验的独立报价，保留最后估值' : effectiveStatus === 'stale' ? '报价过期，保留上次估值' : undefined));
    runner.lastRunAt = now.toISOString();
    if (input.snapshotHash) runner.lastSnapshotHash = input.snapshotHash;
    if (freshStatus) {
      const symbol = String(runner.universe?.instruments.find(item => Object.prototype.hasOwnProperty.call(input.prices || {}, item.symbolOrMarketId))?.symbolOrMarketId || runner.symbolOrMarketId).toUpperCase();
      const mark = Number(input.prices?.[symbol]);
      if (Number.isFinite(mark) && mark > 0) {
        const benchmarks = { ...(runner.benchmarks || {}) };
        const allocationUsd = runner.budgetUsd / Math.max(1, runner.universe?.instruments.length || 1);
        const existing = benchmarks[symbol];
        benchmarks[symbol] = existing
          ? { ...existing, currentPrice: mark, updatedAt: input.dataAt || now.toISOString(), source: input.source }
          : { market: scope, instrument: symbol, startPrice: mark, currentPrice: mark, allocationUsd, observedAt: input.dataAt || now.toISOString(), updatedAt: input.dataAt || now.toISOString(), source: input.source };
        runner.benchmarks = benchmarks;
      }
    }
    const open = runner.positions.filter(position => position.status === 'OPEN');
    const equity = runner.cashUsd + open.reduce((sum, position) => sum + Number(position.currentPrice ?? position.entryPrice) * position.quantity, 0);
    runner.peakEquityUsd = Math.max(Number(runner.peakEquityUsd || runner.budgetUsd), equity);
    const drawdownPct = runner.peakEquityUsd > 0 ? Math.max(0, (runner.peakEquityUsd - equity) / runner.peakEquityUsd * 100) : 0;
    const realizedPnlUsd = runner.positions.filter(position => position.status === 'CLOSED').reduce((sum, position) => sum + Number(position.pnlUsd || 0), 0);
    const unrealizedPnlUsd = open.reduce((sum, position) => sum + (Number(position.currentPrice ?? position.entryPrice) - position.entryPrice) * position.quantity, 0);
    const feeSlippageUsd = runner.trades.reduce((sum, trade) => sum + Math.abs(Number(trade.feeUsd) || 0) + Math.abs(Number(trade.slippageUsd) || 0), 0);
    const spreadCostUsd = runner.trades.reduce((sum, trade) => sum + Math.abs(Number(trade.spreadUsd) || 0), 0);
    const point: AiRunnerEquityPoint = {
      at: now.toISOString(), equityUsd: Math.round(equity * 100) / 100, drawdownPct: Math.round(drawdownPct * 100) / 100,
      realizedPnlUsd: Math.round(realizedPnlUsd * 100) / 100, unrealizedPnlUsd: Math.round(unrealizedPnlUsd * 100) / 100,
      feeSlippageUsd: Math.round(feeSlippageUsd * 100) / 100, dataStatus: runner.lastDataStatus, snapshotHash: input.snapshotHash,
      spreadCostUsd: Math.round(spreadCostUsd * 100) / 100,
    };
    const history = runner.equityHistory || [];
    const last = history[history.length - 1];
    runner.equityHistory = last && last.dataStatus === point.dataStatus && Date.parse(point.at) - Date.parse(last.at) < 1_000
      ? [...history.slice(0, -1), point]
      : [...history, point].slice(-2_000);
    if (valuationFresh && runner.status === 'RUNNING' && drawdownPct >= runner.policy.maxDrawdownPct) {
      runner.status = 'STOPPED';
      runner.stoppedAt = now.toISOString();
      runner.circuitBreakerReason = `策略回撤超过 ${runner.policy.maxDrawdownPct}%`;
    }
    const today = now.toISOString().slice(0, 10);
    const dailyLoss = runner.positions.filter(position => position.status === 'CLOSED' && position.exitTime?.slice(0, 10) === today)
      .reduce((sum, position) => {
        const costs = Number(position.entryFeeUsd || 0) + Number(position.entrySlippageUsd || 0)
          + Number(position.exitFeeUsd || 0) + Number(position.exitSlippageUsd || 0);
        return sum + Math.min(0, (Number(position.pnlUsd) || 0) - costs);
      }, 0);
    if (valuationFresh && runner.status === 'RUNNING' && dailyLoss <= -Math.abs(runner.policy.maxDailyLossUsd)) {
      runner.status = 'STOPPED';
      runner.stoppedAt = now.toISOString();
      runner.circuitBreakerReason = `策略单日亏损超过 $${runner.policy.maxDailyLossUsd.toFixed(2)}`;
    }
  });
}

export function recordAiRunnerModelCall(id: string, call: { at: string; model?: string; decisionId: string }): AiRunner | null {
  return updateRunner(id, runner => {
    if (!call.decisionId.trim() || !Number.isFinite(Date.parse(call.at))) throw new Error('AI 调用记录无效');
    const calls = runner.aiCalls || [];
    if (calls.some(item => item.decisionId === call.decisionId)) return;
    const quota = isAiRunnerCallAllowed(runner, true, new Date(call.at));
    if (!quota.allowed) throw new Error(quota.reason || 'AI 调用次数超限');
    runner.aiCalls = [{ ...call }, ...calls].slice(0, 500);
    runner.lastAiCallAt = call.at;
  });
}

function updateRunner(id: string, fn: (r: AiRunner) => void): AiRunner | null {
  return stateStore.transaction(() => {
    const runners = loadRunners().map(normalizeRunner);
    const runner = runners.find(r => r.id === id);
    if (!runner) return null;
    fn(runner);
    saveRunners(runners);
    return runner;
  });
}

export function updateAiRunnerRouting(id: string, patch: { modelSelection: 'fixed' | 'available-free'; quoteSelection: 'fixed' | 'random-valid' }): AiRunner | null {
  if (!['fixed', 'available-free'].includes(patch.modelSelection) || !['fixed', 'random-valid'].includes(patch.quoteSelection)) throw new Error('模型或报价选择模式无效');
  return updateRunner(id, runner => {
    if (runner.comparisonControl) throw new Error('对照实验必须保留固定模型和共享行情');
    runner.modelSelection = patch.modelSelection;
    runner.quoteSelection = patch.quoteSelection;
  });
}

function toLedgerInstrument(venue: AiRunnerVenue, symbolOrMarketId: string): { instrumentType: UnifiedPaperInstrumentType; instrumentId: string } {
  const symbol = String(symbolOrMarketId || '').trim().toUpperCase();
  if (venue === 'Stocks') return { instrumentType: 'stock', instrumentId: `stock:us:${symbol}` };
  if (venue === 'Options') return { instrumentType: 'option', instrumentId: `option:us:${symbol}` };
  if (venue === 'Predict.fun') return { instrumentType: 'prediction', instrumentId: `prediction:predictfun:${symbol}` };
  return { instrumentType: 'crypto', instrumentId: `crypto:binance:${symbol}` };
}

function resolveRunnerInstrument(runner: AiRunner, requested?: AiRunnerInstrumentRef): AiRunnerInstrumentRef | null {
  const frozen = runner.universe?.instruments || [];
  const instrument = requested || frozen[0] || { venue: runner.venue, symbolOrMarketId: runner.symbolOrMarketId, title: runner.title };
  if (!frozen.some(item => item.venue === instrument.venue && item.symbolOrMarketId === instrument.symbolOrMarketId)) return null;
  return instrument;
}

export interface AiRunnerFillCosts { feeUsd?: number; slippageUsd?: number; spreadUsd?: number; dataSnapshotId?: string; signalId?: string; source?: string; dataAt?: string; quote?: AiRunnerQuote }

/** Open a position inside a runner's isolated book. */
export function runnerOpenPosition(
  id: string,
  entryPrice: number,
  quantity: number,
  side: string,
  reasonZh: string,
  requestedInstrument?: AiRunnerInstrumentRef,
  costs: AiRunnerFillCosts = {},
): boolean {
  let opened = false;
  try {
    updateRunner(id, r => {
      if (r.status !== 'RUNNING' || r.executionState === 'legacy-readonly') return;
      if (!Number.isFinite(entryPrice) || !Number.isFinite(quantity) || entryPrice <= 0 || quantity <= 0) return;
      const instrument = resolveRunnerInstrument(r, requestedInstrument);
      if (!instrument || instrument.venue === 'Options') return;
      const ledgerInstrument = toLedgerInstrument(instrument.venue, instrument.symbolOrMarketId);
      if (!costs.quote) return;
      const fill = resolveRunnerFill(r.policy, costs.quote, 'BUY', new Date(), quantity);
      if (!fill.allowed || fill.price !== entryPrice) return;
      const executionCosts = calculateRunnerExecutionCosts(r.policy, costs.quote, 'BUY', quantity);
      const cost = entryPrice * quantity + executionCosts.feeUsd + executionCosts.slippageUsd;
      if (!evaluateRunnerOpen(r, cost, new Date(), ledgerInstrument.instrumentId).allowed) return;
      const accountId = r.accountId || `ai-runner:${r.id}`;
      const timestamp = new Date().toISOString();
      const orderId = `ai-paper:${r.id}:${randomUUID()}`;
      const outcome = instrument.venue === 'Predict.fun' ? (side === 'NO' ? 'NO' : 'YES') : undefined;
      const account = unifiedPaperLedgerStore.applyRunnerOrder(accountId, r.id, {
        id: orderId,
        ...ledgerInstrument,
        title: instrument.title || instrument.symbolOrMarketId,
        side: (instrument.venue === 'Predict.fun' ? outcome : 'BUY') as any,
        ...(outcome ? { outcome } : {}),
        price: entryPrice, quantity, timestamp,
        strategy: 'ai-runner', strategyVersion: r.strategyVersion,
        dataSnapshotId: costs.dataSnapshotId,
        signalId: costs.signalId,
        feeUsd: executionCosts.feeUsd,
        slippageUsd: executionCosts.slippageUsd,
        spreadUsd: executionCosts.spreadUsd,
        reason: reasonZh,
      }, r.budgetUsd);
      const positionId = `rp_${randomUUID()}`;
      r.cashUsd = account.cash;
      r.positions.push({
        id: positionId,
        instrumentId: ledgerInstrument.instrumentId,
        instrument,
        side: (outcome || 'LONG') as AiRunnerPosition['side'],
        entryPrice, currentPrice: entryPrice, quantity,
        entryTime: timestamp,
        markStatus: (costs.quote.dataStatus || costs.quote.status || 'unavailable') as AiRunnerPosition['markStatus'], markSource: costs.source, markUpdatedAt: costs.dataAt || timestamp,
        entryFeeUsd: executionCosts.feeUsd, entrySlippageUsd: executionCosts.slippageUsd,
        entrySpreadUsd: executionCosts.spreadUsd,
        status: 'OPEN',
      });
      r.lastActionAt = timestamp;
      r.trades.unshift({ id: `rt_${randomUUID()}`, orderId, action: 'BUY', side: side as any, price: entryPrice, quantity, reasonZh, timestamp, feeUsd: executionCosts.feeUsd, slippageUsd: executionCosts.slippageUsd, spreadUsd: executionCosts.spreadUsd });
      if (r.trades.length > MAX_TRADES_PER_RUNNER) r.trades.length = MAX_TRADES_PER_RUNNER;
      opened = true;
    });
  } catch { return false; }
  return opened;
}

/** Close a runner's open position at exitPrice; returns realised PnL. */
export function runnerClosePosition(id: string, positionId: string, exitPrice: number, reasonZh: string, costs: AiRunnerFillCosts = {}): number | null {
  let pnl: number | null = null;
  try {
    updateRunner(id, r => {
      if (r.executionState === 'legacy-readonly' || !Number.isFinite(exitPrice) || exitPrice <= 0) return;
      const pos = r.positions.find(p => p.id === positionId && p.status === 'OPEN');
      if (!pos) return;
      const instrument = pos.instrument || r.universe?.instruments.find(item => item.symbolOrMarketId === r.symbolOrMarketId) || { venue: r.venue, symbolOrMarketId: r.symbolOrMarketId, title: r.title };
      if (instrument.venue === 'Options') return;
      const ledgerInstrument = toLedgerInstrument(instrument.venue, instrument.symbolOrMarketId);
      if (!costs.quote) return;
      const fill = resolveRunnerFill(r.policy, costs.quote, 'SELL', new Date(), pos.quantity);
      if (!fill.allowed || fill.price !== exitPrice) return;
      const executionCosts = calculateRunnerExecutionCosts(r.policy, costs.quote, 'SELL', pos.quantity);
      const timestamp = new Date().toISOString();
      const orderId = `ai-paper:${r.id}:${randomUUID()}`;
      const account = unifiedPaperLedgerStore.applyRunnerOrder(r.accountId || `ai-runner:${r.id}`, r.id, {
        id: orderId,
        ...ledgerInstrument,
        title: instrument.title || instrument.symbolOrMarketId,
        side: 'SELL',
        ...(instrument.venue === 'Predict.fun' ? { outcome: pos.side === 'NO' ? 'NO' : 'YES' } : {}),
        price: exitPrice, quantity: pos.quantity, timestamp,
        strategy: 'ai-runner', strategyVersion: r.strategyVersion,
        feeUsd: executionCosts.feeUsd,
        slippageUsd: executionCosts.slippageUsd,
        spreadUsd: executionCosts.spreadUsd,
        dataSnapshotId: costs.dataSnapshotId,
        signalId: costs.signalId,
        reason: reasonZh,
      }, r.budgetUsd);
      const proceeds = pos.quantity * exitPrice;
      const grossPnl = (exitPrice - pos.entryPrice) * pos.quantity;
      pnl = parseFloat(grossPnl.toFixed(4));
      pos.exitPrice = exitPrice;
      pos.exitTime = timestamp;
      pos.status = 'CLOSED';
      pos.pnlUsd = pnl;
      pos.exitFeeUsd = executionCosts.feeUsd;
      pos.exitSlippageUsd = executionCosts.slippageUsd;
      pos.exitSpreadUsd = executionCosts.spreadUsd;
      pos.currentPrice = exitPrice;
      r.cashUsd = account.cash;
      r.lastActionAt = timestamp;
      r.trades.unshift({
        id: `rt_${randomUUID()}`, orderId, action: 'SELL',
        side: pos.side, price: exitPrice, quantity: pos.quantity,
        reasonZh: `${reasonZh} | 盈亏 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
        timestamp, feeUsd: executionCosts.feeUsd, slippageUsd: executionCosts.slippageUsd, spreadUsd: executionCosts.spreadUsd,
      });
      if (r.trades.length > MAX_TRADES_PER_RUNNER) r.trades.length = MAX_TRADES_PER_RUNNER;
      const closeDay = timestamp.slice(0, 10);
      const realizedToday = r.positions.filter(item => item.status === 'CLOSED' && item.exitTime?.slice(0, 10) === closeDay).reduce((sum, item) => {
        const totalCosts = Number(item.entryFeeUsd || 0) + Number(item.entrySlippageUsd || 0)
          + Number(item.exitFeeUsd || 0) + Number(item.exitSlippageUsd || 0);
        return sum + (Number(item.pnlUsd) || 0) - totalCosts;
      }, 0);
      const equity = account.cash + account.positions.reduce((sum, item) => sum + item.currentPrice * item.quantity, 0);
      r.peakEquityUsd = Math.max(r.peakEquityUsd, equity);
      if (r.peakEquityUsd > 0 && ((r.peakEquityUsd - equity) / r.peakEquityUsd) * 100 >= r.policy.maxDrawdownPct) {
        r.status = 'STOPPED';
        r.circuitBreakerReason = `策略回撤超过 ${r.policy.maxDrawdownPct}%`;
      }
      if (realizedToday <= -Math.abs(r.policy.maxDailyLossUsd)) {
        r.status = 'STOPPED';
        r.circuitBreakerReason = `策略单日亏损超过 $${r.policy.maxDailyLossUsd.toFixed(2)}`;
      }
    });
  } catch { return null; }
  return pnl;
}

export function pauseAiRunner(id: string, reason = '手动暂停'): AiRunner | null {
  return updateRunner(id, runner => {
    if (runner.status === 'RUNNING') {
      runner.status = 'STOPPED';
      runner.circuitBreakerReason = reason;
      runner.stoppedAt = new Date().toISOString();
      runner.manualPaused = true;
    }
  });
}

export function updateAiRunnerPolicy(id: string, patch: Partial<AiRunnerPolicy>): AiRunner | null {
  return updateRunner(id, runner => {
    if (runner.comparisonControl) throw new Error('受控对照风险与成本配置固定；请创建新的对照实验');
    const universe = runner.universe || freezeAiRunnerUniverse([{ venue: runner.venue, symbolOrMarketId: runner.symbolOrMarketId }]);
    runner.policy = normalizeRunnerPolicy(runner.policy, patch, runner.budgetUsd, universe);
  });
}

export function resumeAiRunner(id: string): AiRunner | null {
  if (getAiRunners().find(row => row.id === id)?.comparisonControl) return null;
  return updateRunner(id, runner => {
    const wasManualPaused = runner.manualPaused;
    if (wasManualPaused || !runner.circuitBreakerReason) {
      runner.status = 'RUNNING';
      runner.stoppedAt = undefined;
      runner.manualPaused = false;
      if (wasManualPaused) runner.circuitBreakerReason = undefined;
    }
  });
}

export function resetAiRunnerCircuit(id: string): AiRunner | null {
  return updateRunner(id, runner => {
    runner.circuitBreakerReason = undefined;
    runner.manualPaused = false;
    runner.status = 'STOPPED';
    runner.stoppedAt = new Date().toISOString();
  });
}

export interface AiRunnerSummary {
  totalPnlUsd: number;
  realizedPnlUsd: number;
  unrealizedPct: number | null;
  openPositionQty: number;
  openEntryPrice: number | null;
  closedCount: number;
  winRatePct: number;
  winRateReliable: boolean;
  equityUsd: number;
  unrealizedPnlUsd: number;
  feeSlippageUsd: number;
  spreadCostUsd: number;
  valuationStatus?: string;
  valuationReason?: string;
  benchmarkPnlUsd: number | null;
  benchmarkReturnPct: number | null;
  benchmarkCount: number;
  benchmarkExpectedCount: number;
  benchmarkReason?: string;
  maxDrawdownPct: number;
}

/** Only the group coordinator may enable all arms for an explicit sampled round. */
export function activateAiRunnerComparison(groupId: string, ids: string[]): void {
  stateStore.transaction(() => {
    const runners = loadRunners().map(normalizeRunner);
    const selected = ids.map(id => runners.find(row => row.id === id));
    if (selected.length !== 3 || selected.some(row => !row || row.comparisonControl?.groupId !== groupId
      || row.executionState !== 'ready' || (!!row.circuitBreakerReason && !row.manualPaused))) throw new Error('对照账户缺失、未核验或处于熔断状态');
    selected.forEach(row => { if(row!.manualPaused)row!.circuitBreakerReason=undefined;row!.status = 'RUNNING'; row!.stoppedAt = undefined; row!.manualPaused = false; });
    saveRunners(runners);
  });
}

export function summarizeRunner(runner: AiRunner, currentPrice?: number): AiRunnerSummary {
  const closed = runner.positions.filter(p => p.status === 'CLOSED');
  const open = runner.positions.filter(p => p.status === 'OPEN');
  const realizedPnl = closed.reduce((s, p) => s + (p.pnlUsd || 0), 0);
  const unrealizedPnl = open.reduce((sum, position) => {
    const mark = currentPrice != null && position.instrumentId === toLedgerInstrument(runner.venue, runner.symbolOrMarketId).instrumentId
      ? currentPrice : Number(position.currentPrice ?? position.entryPrice);
    return sum + (mark - position.entryPrice) * position.quantity;
  }, 0);
  const wins = closed.filter(p => (p.pnlUsd || 0) > 0).length;
  const equity = runner.cashUsd + open.reduce((sum, position) => {
    const mark = currentPrice != null && position.instrumentId === toLedgerInstrument(runner.venue, runner.symbolOrMarketId).instrumentId
      ? currentPrice : Number(position.currentPrice ?? position.entryPrice);
    return sum + mark * position.quantity;
  }, 0);
  const costs = runner.trades.reduce((sum, trade) => sum + Math.abs(Number(trade.feeUsd) || 0) + Math.abs(Number(trade.slippageUsd) || 0), 0);
  const spreadCost = runner.trades.reduce((sum, trade) => sum + Math.abs(Number(trade.spreadUsd) || 0), 0);
  const entry = open[0];
  const entryMark = entry ? (currentPrice != null && entry.instrumentId === toLedgerInstrument(runner.venue, runner.symbolOrMarketId).instrumentId ? currentPrice : Number(entry.currentPrice ?? entry.entryPrice)) : null;
  const unrealizedPct = entry && entryMark != null ? ((entryMark - entry.entryPrice) / entry.entryPrice) * 100 : null;
  const benchmarkRows = Object.values(runner.benchmarks || {});
  const benchmarkPnl = benchmarkRows.reduce((sum, item) => sum + item.allocationUsd * (item.currentPrice / item.startPrice - 1), 0);
  const predictionMarket = (runner.universe?.market || venueMarket(runner.venue)) === 'prediction';
  const expectedBenchmarks = predictionMarket ? 0 : Math.max(1, runner.universe?.instruments.length || 1);
  const benchmarkComplete = expectedBenchmarks > 0 && benchmarkRows.length >= expectedBenchmarks;
  const account = unifiedPaperLedgerStore.getRunnerAccount(runner.accountId || `ai-runner:${runner.id}`);
  return {
    totalPnlUsd: parseFloat((realizedPnl + unrealizedPnl - costs).toFixed(2)),
    realizedPnlUsd: Math.round(realizedPnl * 100) / 100,
    unrealizedPct: unrealizedPct != null ? Math.round(unrealizedPct * 100) / 100 : null,
    openPositionQty: open.reduce((sum, position) => sum + position.quantity, 0),
    openEntryPrice: entry?.entryPrice ?? null,
    closedCount: closed.length,
    winRatePct: closed.length > 0 ? Math.round(wins / closed.length * 100) : 0,
    winRateReliable: closed.length >= 20,
    equityUsd: Math.round(equity * 100) / 100,
    unrealizedPnlUsd: Math.round(unrealizedPnl * 100) / 100,
    feeSlippageUsd: Math.round(costs * 100) / 100,
    spreadCostUsd: Math.round(spreadCost * 100) / 100,
    valuationStatus: account?.valuationStatus || runner.lastDataStatus,
    valuationReason: account?.valuationReason || runner.lastDataReason,
    benchmarkPnlUsd: benchmarkComplete ? Math.round(benchmarkPnl * 100) / 100 : null,
    benchmarkReturnPct: benchmarkComplete && runner.budgetUsd > 0 ? Math.round(benchmarkPnl / runner.budgetUsd * 10_000) / 100 : null,
    benchmarkCount: benchmarkRows.length,
    benchmarkExpectedCount: expectedBenchmarks,
    benchmarkReason: predictionMarket ? 'YES/NO 方向不同，当前没有可验证的同方向持有基准' : benchmarkComplete ? undefined : '等待所有冻结标的获得首次有效报价后再比较',
    maxDrawdownPct: Math.round(Math.max(0, ...((runner.equityHistory || []).map(point => point.drawdownPct))) * 100) / 100,
  };
}

const RUNNER_HISTORY_PREFIX = 'ai-paper-runner-history:';
const MAX_RUNNER_HISTORY = 2_000;

export function appendAiRunnerDecision(record: AiRunnerDecisionRecord): AiRunnerDecisionRecord {
  if (!record.runnerId || !record.idempotencyKey) throw new Error('跑单决策缺少标识');
  return stateStore.transaction(() => {
    const key = `${RUNNER_HISTORY_PREFIX}${record.runnerId}`;
    const rows = stateStore.get<AiRunnerDecisionRecord[]>(key) || [];
    const prior = rows.find(item => item.idempotencyKey === record.idempotencyKey);
    if (prior) return prior;
    const normalized: AiRunnerDecisionRecord = {
      ...record,
      id: record.id || randomUUID(),
      signals: Array.isArray(record.signals) ? record.signals.map(String).slice(0, 20) : [],
      riskChecks: Array.isArray(record.riskChecks) ? record.riskChecks.slice(0, 30) : [],
      evidence: Array.isArray(record.evidence) ? record.evidence.slice(0, 8).map(item => ({
        dataset: item.dataset, source: String(item.source || '').slice(0, 120), status: String(item.status || '').slice(0, 32),
        dataAt: item.dataAt ? String(item.dataAt).slice(0, 40) : undefined,
        retrievedAt: item.retrievedAt ? String(item.retrievedAt).slice(0, 40) : undefined,
        reason: item.reason ? String(item.reason).slice(0, 240) : undefined,
      })) : [],
      reason: String(record.reason || '').slice(0, 500),
    };
    stateStore.set(key, [normalized, ...rows].slice(0, MAX_RUNNER_HISTORY), 1);
    return normalized;
  });
}

export function listAiRunnerHistory(runnerId: string, cursor?: string, limit = 50): { data: AiRunnerDecisionRecord[]; nextCursor: string | null } {
  const rows = stateStore.get<AiRunnerDecisionRecord[]>(`${RUNNER_HISTORY_PREFIX}${runnerId}`) || [];
  const bounded = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  const start = cursor ? Math.max(0, rows.findIndex(item => item.id === cursor) + 1) : 0;
  const page = rows.slice(start, start + bounded);
  return { data: page, nextCursor: start + bounded < rows.length && page.length ? page[page.length - 1].id : null };
}
