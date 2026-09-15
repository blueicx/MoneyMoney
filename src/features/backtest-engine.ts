import { calculateBacktestMetrics, type BacktestMetrics } from './backtest-analysis';

export type BacktestDirection = 'buy' | 'sell';

export interface BacktestSignal {
  timeIndex: number;
  direction: BacktestDirection;
  strategyId?: string;
  source?: string;
  price?: number;
  tag?: string;
  exitReason?: string;
}

export interface BacktestRules {
  maxOpenPositions?: number;
  [key: string]: unknown;
}

export interface ExperimentContext {
  marketId: string;
  instrumentId?: string;
  timeframe?: string;
  strategyId?: string;
  strategyVersion?: string;
  dataSource?: string;
  dataFrom?: string;
  dataTo?: string;
  dataSnapshotId?: string;
  seed?: number;
  costModel?: string;
}

export interface BacktestOptions {
  marketId: string;
  rules: BacktestRules;
  feeRate: number;
  slippage: number;
  rejectOnInsufficientSamples?: boolean;
  preventFutureData?: boolean;
  useCache?: boolean;
  experimentContext?: ExperimentContext | null;
  segmentSize?: number;
  startingBalance?: number;
}

export interface BacktestTrade {
  timeIndex: number;
  direction: BacktestDirection;
  price: number;
  executionPrice: number;
  fee: number;
  slippage: number;
  strategyId?: string;
  source?: string;
  tag?: string;
  exitReason?: string;
  pnl: number;
}

export interface BacktestSegmentStatistic {
  segment: number;
  fromIndex: number;
  toIndex: number;
  pnl: number;
  trades: number;
}

export interface BacktestResult {
  pnl: number;
  remainingPositions: number;
  trades: BacktestTrade[];
  totalFees: number;
  totalSlippage: number;
  segmentStatistics: BacktestSegmentStatistic[];
  experimentContext: ExperimentContext | null;
  preventFutureData: boolean;
  lookAheadBiasDetected: boolean;
  cached: boolean;
  startingBalance: number;
  equityCurve: number[];
  metrics: BacktestMetrics;
}

function cloneResult(result: BacktestResult): BacktestResult {
  return JSON.parse(JSON.stringify(result)) as BacktestResult;
}

export class BacktestEngine {
  private readonly cache = new Map<string, BacktestResult>();

  constructor(private readonly options: BacktestOptions) {
    if (!Number.isFinite(options.feeRate) || options.feeRate < 0) throw new Error('feeRate must be a non-negative number');
    if (!Number.isFinite(options.slippage) || options.slippage < 0) throw new Error('slippage must be a non-negative number');
    if (options.startingBalance !== undefined && (!Number.isFinite(options.startingBalance) || options.startingBalance <= 0)) throw new Error('startingBalance must be positive');
  }

  run(prices: number[], signals: readonly BacktestSignal[], explicitCacheKey?: string): BacktestResult {
    if (this.options.rejectOnInsufficientSamples && prices.length < 100) throw new Error('Insufficient samples');
    if (prices.some(price => !Number.isFinite(price) || price <= 0)) throw new Error('Prices must be positive finite numbers');

    const cacheKey = explicitCacheKey ?? (this.options.useCache ? JSON.stringify({ prices, signals, options: this.options }) : undefined);
    if (cacheKey !== undefined) {
      const cached = this.cache.get(cacheKey);
      if (cached) return { ...cloneResult(cached), cached: true };
    }

    const segmentSize = Math.max(1, Math.floor(this.options.segmentSize ?? 50));
    const maxOpenPositions = this.options.rules.maxOpenPositions === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(Number(this.options.rules.maxOpenPositions)));
    let pnl = 0;
    let positions = 0;
    let totalFees = 0;
    let totalSlippage = 0;
    let lookAheadBiasDetected = false;
    const trades: BacktestTrade[] = [];
    const segments = new Map<number, BacktestSegmentStatistic>();
    const startingBalance = this.options.startingBalance ?? 1000;
    const equityCurve = [startingBalance];

    for (const signal of [...signals].sort((left, right) => left.timeIndex - right.timeIndex)) {
      if (!Number.isInteger(signal.timeIndex) || signal.timeIndex < 0 || signal.timeIndex >= prices.length) {
        if (this.options.preventFutureData && signal.timeIndex >= prices.length) lookAheadBiasDetected = true;
        continue;
      }
      const price = signal.price ?? prices[signal.timeIndex];
      if (!Number.isFinite(price) || price <= 0) continue;
      if (signal.direction === 'buy' && positions >= maxOpenPositions) continue;
      if (signal.direction === 'sell' && positions <= 0) continue;
      if (signal.direction !== 'buy' && signal.direction !== 'sell') continue;

      const slippage = price * this.options.slippage;
      const fee = price * this.options.feeRate;
      const executionPrice = signal.direction === 'buy' ? price + slippage : price - slippage;
      const tradePnl = signal.direction === 'buy' ? -(executionPrice + fee) : executionPrice - fee;
      positions += signal.direction === 'buy' ? 1 : -1;
      pnl += tradePnl;
      totalFees += fee;
      totalSlippage += slippage;
      const trade: BacktestTrade = {
        timeIndex: signal.timeIndex, direction: signal.direction, price, executionPrice, fee, slippage,
        ...(signal.strategyId ? { strategyId: signal.strategyId } : {}),
        ...(signal.source ? { source: signal.source } : {}),
        ...(signal.tag ? { tag: signal.tag } : {}),
        ...(signal.exitReason ? { exitReason: signal.exitReason } : {}),
        pnl: tradePnl,
      };
      trades.push(trade);
      equityCurve.push((equityCurve[equityCurve.length - 1] ?? startingBalance) + tradePnl);

      const segment = Math.floor(signal.timeIndex / segmentSize);
      const current = segments.get(segment) ?? { segment, fromIndex: segment * segmentSize, toIndex: Math.min(prices.length - 1, (segment + 1) * segmentSize - 1), pnl: 0, trades: 0 };
      current.pnl += tradePnl;
      current.trades += 1;
      segments.set(segment, current);
    }

    const result: BacktestResult = {
      pnl, remainingPositions: positions, trades, totalFees, totalSlippage,
      segmentStatistics: [...segments.values()].sort((a, b) => a.segment - b.segment),
      experimentContext: this.options.experimentContext ?? null,
      preventFutureData: this.options.preventFutureData ?? false,
      lookAheadBiasDetected,
      cached: false,
      startingBalance,
      equityCurve,
      metrics: calculateBacktestMetrics({ startingBalance, equityCurve, trades }),
    };
    if (cacheKey !== undefined) this.cache.set(cacheKey, cloneResult(result));
    return result;
  }
}
