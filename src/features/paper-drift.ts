import type { MarketId } from './research-contracts';
import type { UnifiedPaperOrder } from './unified-paper-trading';

export interface PaperDriftSample {
  market: MarketId;
  instrumentId: string;
  strategyId: string;
  strategyVersion: string;
  experimentId: string;
  signalId: string;
  dataSnapshotId: string;
  timestamp: string;
  dataStatus: 'live' | 'delayed' | 'cached' | 'partial' | 'unavailable';
  paperPrice: number;
  paperQuantity: number;
  paperSlippageUsd: number;
  expectedSlippageUsd: number;
  paperNetPnlUsd: number;
  expectedNetPnlUsd: number;
}

export interface PaperDriftResult {
  status: 'insufficient' | 'healthy' | 'paused';
  pairedCount: number;
  slippageRatio: number | null;
  netReturnGapPp: number | null;
  reason: string;
  evaluatedAt: string;
}

interface DriftExperiment {
  experiment: { id: string; market: MarketId; instrument?: string; strategyId?: string; strategyVersion?: string };
  backtest: { trades: Array<{ direction: string; price: number; volume: number; fee: number; slippage: number; pnl: number }> };
}
interface DriftSnapshot { id: string; market: MarketId; instrument: string; asOf: string }

export function samePaperInstrument(market: MarketId, orderId: string, linkedInstrument: string): boolean {
  const actual = String(orderId || '').trim().toUpperCase();
  const linked = String(linkedInstrument || '').trim().toUpperCase();
  if (!actual || !linked) return false;
  if (actual === linked) return true;
  if (market === 'stocks' || market === 'crypto') return !linked.includes(':') && actual.split(':').at(-1) === linked;
  return false;
}

export function collectPaperDriftSamples(orders: readonly UnifiedPaperOrder[], resolve: {
  experiment: (id: string) => DriftExperiment | null;
  snapshot: (id: string) => DriftSnapshot | null;
}): PaperDriftSample[] {
  const marketForType: Record<UnifiedPaperOrder['instrumentType'], MarketId> = { stock: 'stocks', option: 'options', crypto: 'crypto', prediction: 'prediction' };
  const samples: PaperDriftSample[] = [];
  for (const order of orders) {
    if (order.side !== 'SELL' || !order.strategy || !order.strategyVersion || !order.experimentId || !order.signalId || !order.dataSnapshotId || !Number.isInteger(order.backtestTradeIndex) || (order.backtestTradeIndex ?? -1) < 0) continue;
    const market = marketForType[order.instrumentType];
    const experiment = resolve.experiment(order.experimentId);
    const snapshot = resolve.snapshot(order.dataSnapshotId);
    if (!market || !experiment || !snapshot || experiment.experiment.id !== order.experimentId ||
        experiment.experiment.market !== market || snapshot.market !== market ||
        !samePaperInstrument(market, order.instrumentId, experiment.experiment.instrument || '') ||
        !samePaperInstrument(market, order.instrumentId, snapshot.instrument) ||
        experiment.experiment.strategyId !== order.strategy || experiment.experiment.strategyVersion !== order.strategyVersion) continue;
    const trade = experiment.backtest.trades[order.backtestTradeIndex!];
    const paperTime = Date.parse(order.timestamp);
    const snapshotTime = Date.parse(snapshot.asOf);
    if (!trade || trade.direction !== 'sell' || !Number.isFinite(trade.volume) || trade.volume <= 0 ||
        !Number.isFinite(paperTime) || !Number.isFinite(snapshotTime) || snapshotTime > paperTime || paperTime - snapshotTime > 72 * 60 * 60 * 1000 ||
        !Number.isFinite(Number(order.pnlUsd))) continue;
    const factor = order.quantity / trade.volume;
    samples.push({
      market, instrumentId: order.instrumentId, strategyId: order.strategy, strategyVersion: order.strategyVersion,
      experimentId: order.experimentId, signalId: order.signalId, dataSnapshotId: order.dataSnapshotId,
      timestamp: order.timestamp, dataStatus: 'delayed', paperPrice: order.price, paperQuantity: order.quantity,
      paperSlippageUsd: Number(order.slippageUsd || 0), expectedSlippageUsd: trade.slippage * factor,
      paperNetPnlUsd: Number(order.pnlUsd) - Number(order.feeUsd || 0) - Number(order.slippageUsd || 0),
      expectedNetPnlUsd: trade.pnl * factor,
    });
  }
  return samples;
}

export function analyzePaperDrift(samples: readonly PaperDriftSample[], now = new Date()): PaperDriftResult {
  const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const eligible = samples.filter(item => {
    const time = Date.parse(item.timestamp);
    const key = `${item.market}:${item.experimentId}:${item.signalId}`;
    if (!Number.isFinite(time) || time < cutoff || time > now.getTime() ||
        !item.market || !item.instrumentId || !item.strategyId || !item.strategyVersion ||
        !item.experimentId || !item.signalId || !item.dataSnapshotId ||
        !['live', 'delayed'].includes(item.dataStatus) || seen.has(key) ||
        ![item.paperPrice, item.paperQuantity, item.paperSlippageUsd, item.expectedSlippageUsd, item.paperNetPnlUsd, item.expectedNetPnlUsd].every(Number.isFinite) ||
        item.paperPrice <= 0 || item.paperQuantity <= 0 || item.paperSlippageUsd < 0 || item.expectedSlippageUsd < 0) return false;
    seen.add(key);
    return true;
  });
  const pairedCount = eligible.length;
  const evaluatedAt = now.toISOString();
  if (pairedCount < 20) return { status: 'insufficient', pairedCount, slippageRatio: null, netReturnGapPp: null, reason: '最近30天有效配对成交不足20笔，或来源/快照不可用', evaluatedAt };
  const sum = (field: keyof PaperDriftSample) => eligible.reduce((total, item) => total + Number(item[field]), 0);
  const expectedSlippage = sum('expectedSlippageUsd');
  const slippageRatio = expectedSlippage > 0 ? sum('paperSlippageUsd') / expectedSlippage : null;
  const notional = eligible.reduce((total, item) => total + item.paperPrice * item.paperQuantity, 0);
  const netReturnGapPp = (sum('expectedNetPnlUsd') - sum('paperNetPnlUsd')) / notional * 100;
  const paused = (slippageRatio !== null && slippageRatio > 2) || netReturnGapPp > 5;
  return {
    status: paused ? 'paused' : 'healthy', pairedCount, slippageRatio, netReturnGapPp,
    reason: paused ? '模拟结果持续偏离回测，已暂停此策略信号提醒；需人工确认恢复' : '未触及策略提醒暂停门槛', evaluatedAt,
  };
}

export function analyzePaperDriftByStrategy(samples: readonly PaperDriftSample[], now = new Date()): Array<{ market: MarketId; strategyId: string; strategyVersion: string; result: PaperDriftResult }> {
  const grouped = new Map<string, PaperDriftSample[]>();
  for (const sample of samples) {
    const key = `${sample.market}\0${sample.strategyId}\0${sample.strategyVersion}`;
    const current = grouped.get(key) || [];
    current.push(sample);
    grouped.set(key, current);
  }
  return [...grouped.values()].map(group => ({ market: group[0].market, strategyId: group[0].strategyId, strategyVersion: group[0].strategyVersion, result: analyzePaperDrift(group, now) }));
}

interface StateStore { get<T>(key: string): T | null; set<T>(key: string, value: T, version?: number): void; }
export interface DriftGateRecord { market: MarketId; strategyId: string; strategyVersion: string; paused: boolean; reason: string; evaluatedAt: string; resumedAt?: string; }

export class StrategyDriftGate {
  constructor(private readonly store: StateStore, private readonly key = 'strategy-drift-gates') {}

  private records(): DriftGateRecord[] { return this.store.get<DriftGateRecord[]>(this.key) || []; }
  list(market?: MarketId): DriftGateRecord[] { return this.records().filter(item => !market || item.market === market); }
  isPaused(market: string, strategyId: string, strategyVersion: string): boolean {
    return this.records().some(item => item.market === market && item.strategyId === strategyId && item.strategyVersion === strategyVersion && item.paused);
  }
  update(market: MarketId, strategyId: string, strategyVersion: string, result: PaperDriftResult): boolean {
    if (result.status !== 'paused') return false;
    const records = this.records();
    if (this.isPaused(market, strategyId, strategyVersion)) return false;
    const next = records.filter(item => !(item.market === market && item.strategyId === strategyId && item.strategyVersion === strategyVersion));
    next.push({ market, strategyId, strategyVersion, paused: true, reason: result.reason, evaluatedAt: result.evaluatedAt });
    this.store.set(this.key, next, 1);
    return true;
  }
  resume(market: MarketId, strategyId: string, strategyVersion: string): boolean {
    const records = this.records();
    const record = records.find(item => item.market === market && item.strategyId === strategyId && item.strategyVersion === strategyVersion && item.paused);
    if (!record) return false;
    record.paused = false;
    record.resumedAt = new Date().toISOString();
    this.store.set(this.key, records, 1);
    return true;
  }
}
