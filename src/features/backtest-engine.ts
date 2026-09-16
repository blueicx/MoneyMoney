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
  orderType?: 'market' | 'limit' | 'stop' | 'take_profit';
  limitPrice?: number;
  stopPrice?: number;
  volume?: number;
}

export interface BacktestRules {
  maxOpenPositions?: number;
  minTradeVolume?: number;
  cooldownBars?: number;
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
  volume: number;
  strategyId?: string;
  source?: string;
  tag?: string;
  exitReason?: string;
  pnl: number;
  holdingTime?: number;
}

export interface BacktestSegmentStatistic {
  segment: number;
  fromIndex: number;
  toIndex: number;
  pnl: number;
  trades: number;
}

export interface PositionLedger {
  realizedPnl: number;
  unrealizedPnl: number;
  maxDrawdown: number;
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
  underwaterCurve?: number[];
  ledger?: PositionLedger;
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
    const minTradeVolume = this.options.rules.minTradeVolume === undefined ? 1 : Math.max(1, Number(this.options.rules.minTradeVolume));
    const cooldownBars = this.options.rules.cooldownBars === undefined ? 0 : Math.max(0, Number(this.options.rules.cooldownBars));
    let pnl = 0;
    let positions = 0;
    let totalFees = 0;
    let totalSlippage = 0;
    let lookAheadBiasDetected = false;
    const trades: BacktestTrade[] = [];
    const segments = new Map<number, BacktestSegmentStatistic>();
    const startingBalance = this.options.startingBalance ?? 1000;
    const equityCurve = [startingBalance];
    const underwaterCurve = [0];
    let cashBalance = startingBalance;
    let lastTradeIndex = -1;
    let entryIndex = -1;

    let peak = startingBalance;
    let maxDrawdown = 0;

    let positionCost = 0;

    for (const signal of [...signals].sort((left, right) => left.timeIndex - right.timeIndex)) {
      if (!Number.isInteger(signal.timeIndex) || signal.timeIndex < 0 || signal.timeIndex >= prices.length) {
        if (this.options.preventFutureData && signal.timeIndex >= prices.length) lookAheadBiasDetected = true;
        continue;
      }

      const price = signal.price ?? prices[signal.timeIndex];
      if (!Number.isFinite(price) || price <= 0) continue;

      // Order type logic
      let fillPrice = price;
      let shouldFill = true;
      let exitReason = signal.exitReason;

      if (signal.orderType === 'limit') {
        if (signal.direction === 'buy' && price > (signal.limitPrice ?? 0)) shouldFill = false;
        if (signal.direction === 'sell' && price < (signal.limitPrice ?? Infinity)) shouldFill = false;
      } else if (signal.orderType === 'stop') {
        if (signal.direction === 'buy' && price < (signal.stopPrice ?? Infinity)) shouldFill = false;
        if (signal.direction === 'sell' && price > (signal.stopPrice ?? 0)) shouldFill = false;
        if (shouldFill && !exitReason) exitReason = 'stop_loss';
      } else if (signal.orderType === 'take_profit') {
        if (signal.direction === 'sell' && price < (signal.limitPrice ?? Infinity)) shouldFill = false;
        if (signal.direction === 'buy' && price > (signal.limitPrice ?? 0)) shouldFill = false;
        if (shouldFill && !exitReason) exitReason = 'take_profit';
      }

      if (!shouldFill) continue;

      if (signal.direction === 'buy' && lastTradeIndex >= 0 && signal.timeIndex - lastTradeIndex < cooldownBars) continue;

      let volume = signal.volume ?? 1;
      if (volume < minTradeVolume) continue;

      if (signal.direction === 'buy' && positions >= maxOpenPositions) continue;
      if (signal.direction === 'sell' && positions <= 0) continue;
      if (signal.direction !== 'buy' && signal.direction !== 'sell') continue;

      const perUnitSlippage = fillPrice * this.options.slippage;
      const executionPrice = signal.direction === 'buy' ? fillPrice + perUnitSlippage : fillPrice - perUnitSlippage;

      if (signal.direction === 'buy' && cashBalance < (executionPrice + fillPrice * this.options.feeRate) * volume) {
         // partial fill based on cash
         volume = Math.floor(cashBalance / (executionPrice + fillPrice * this.options.feeRate));
         if (volume < minTradeVolume) continue;
      }

      if (signal.direction === 'sell') {
         volume = Math.min(volume, positions);
         if (volume < minTradeVolume && volume !== positions) continue; // unless closing remaining
      }

      const slippage = perUnitSlippage * volume;
      const fee = fillPrice * this.options.feeRate * volume;
      const tradeValue = executionPrice * volume;

      const tradePnl = signal.direction === 'buy' ? 0 : (executionPrice - positionCost) * volume - fee;

      if (signal.direction === 'buy') {
         const newTotalCost = positionCost * positions + tradeValue + fee;
         cashBalance -= (tradeValue + fee);
         positions += volume;
         positionCost = positions > 0 ? newTotalCost / positions : 0;
         if (positions === volume) entryIndex = signal.timeIndex;
      } else {
         cashBalance += (tradeValue - fee);
         positions -= volume;
         pnl += tradePnl;
         if (positions === 0) positionCost = 0;
      }

      totalFees += fee;
      totalSlippage += slippage;
      lastTradeIndex = signal.timeIndex;

      const trade: BacktestTrade = {
        timeIndex: signal.timeIndex, direction: signal.direction, price: fillPrice, executionPrice, fee, slippage, volume,
        ...(signal.strategyId ? { strategyId: signal.strategyId } : {}),
        ...(signal.source ? { source: signal.source } : {}),
        ...(signal.tag ? { tag: signal.tag } : {}),
        ...(exitReason ? { exitReason } : {}),
        pnl: signal.direction === 'sell' ? tradePnl : 0,
        ...(signal.direction === 'sell' ? { holdingTime: signal.timeIndex - entryIndex } : {})
      };
      trades.push(trade);

      // Update Equity
      const currentEquity = cashBalance + positions * (prices[signal.timeIndex] || fillPrice);
      equityCurve.push(currentEquity);

      if (currentEquity > peak) peak = currentEquity;
      const drawdown = peak > 0 ? (peak - currentEquity) / peak : 0;
      underwaterCurve.push(-drawdown * 100);
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      const segment = Math.floor(signal.timeIndex / segmentSize);
      const current = segments.get(segment) ?? { segment, fromIndex: segment * segmentSize, toIndex: Math.min(prices.length - 1, (segment + 1) * segmentSize - 1), pnl: 0, trades: 0 };
      if (signal.direction === 'sell') current.pnl += tradePnl;
      current.trades += 1;
      segments.set(segment, current);
    }

    const unrealizedPnl = positions * (prices[prices.length - 1] || 0) - positionCost * positions;

    const result: BacktestResult = {
      pnl, remainingPositions: positions, trades, totalFees, totalSlippage,
      segmentStatistics: [...segments.values()].sort((a, b) => a.segment - b.segment),
      experimentContext: this.options.experimentContext ?? null,
      preventFutureData: this.options.preventFutureData ?? false,
      lookAheadBiasDetected,
      cached: false,
      startingBalance,
      equityCurve,
      underwaterCurve,
      ledger: { realizedPnl: pnl, unrealizedPnl, maxDrawdown: maxDrawdown * 100 },
      metrics: calculateBacktestMetrics({ startingBalance, equityCurve, trades }),
    };
    if (cacheKey !== undefined) this.cache.set(cacheKey, cloneResult(result));
    return result;
  }
}
