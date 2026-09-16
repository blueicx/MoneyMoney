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
  orderType?: 'market' | 'limit' | 'stop' | 'take_profit' | 'cancel';
  limitPrice?: number;
  stopPrice?: number;
  volume?: number;
  timeoutBars?: number;
  status?: string;
}

export interface BacktestRules {
  maxOpenPositions?: number;
  minTradeVolume?: number;
  cooldownBars?: number;
  maxConsecutiveLosses?: number;
  maxDrawdownLimit?: number;
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

export interface ResearchLedger {
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
  underwaterCurve: number[];
  ledger: ResearchLedger;
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
    const maxConsecutiveLosses = this.options.rules.maxConsecutiveLosses !== undefined ? Number(this.options.rules.maxConsecutiveLosses) : Infinity;
    const maxDrawdownLimit = this.options.rules.maxDrawdownLimit !== undefined ? Number(this.options.rules.maxDrawdownLimit) : Infinity;

    let pnl = 0;
    let positions = 0;
    let totalFees = 0;
    let totalSlippage = 0;
    let lookAheadBiasDetected = false;
    const trades: BacktestTrade[] = [];
    const segments = new Map<number, BacktestSegmentStatistic>();
    const startingBalance = this.options.startingBalance ?? 1000;

    let cashBalance = startingBalance;
    let peak = startingBalance;
    let maxDrawdown = 0;
    let positionCost = 0;
    let entryIndex = -1;
    let equityCurve: number[] = [];
    let underwaterCurve: number[] = [];
    let lastTradeIndex = -1;
    let consecutiveLosses = 0;

    const signalMap = new Map<number, BacktestSignal[]>();
    for (const s of signals) {
      if (!Number.isInteger(s.timeIndex) || s.timeIndex < 0 || s.timeIndex >= prices.length) {
        if (this.options.preventFutureData && s.timeIndex >= prices.length) lookAheadBiasDetected = true;
        continue;
      }
      if (!signalMap.has(s.timeIndex)) signalMap.set(s.timeIndex, []);
      signalMap.get(s.timeIndex)!.push(s);
    }
    let pendingOrders: BacktestSignal[] = [];

    for (let i = 0; i < prices.length; i++) {
      const currentPrice = prices[i];
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

      let currentEquity = cashBalance + positions * currentPrice;
      if (currentEquity > peak) peak = currentEquity;
      const drawdown = peak > 0 ? (peak - currentEquity) / peak : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      if (drawdown * 100 > maxDrawdownLimit) {
         if (positions > 0) {
             const executionPrice = currentPrice - currentPrice * this.options.slippage;
             const fee = currentPrice * this.options.feeRate * positions;
             const tradePnl = (executionPrice - positionCost) * positions - fee;
             cashBalance += (executionPrice * positions - fee);
             pnl += tradePnl;
             totalFees += fee;
             totalSlippage += currentPrice * this.options.slippage * positions;
             trades.push({
                timeIndex: i, direction: 'sell', price: currentPrice, executionPrice, fee, slippage: currentPrice * this.options.slippage * positions, volume: positions,
                exitReason: 'max_drawdown_stop', pnl: tradePnl, holdingTime: i - entryIndex
             });
             positions = 0;
             positionCost = 0;
         }
         pendingOrders = [];
         break;
      }

      if (signalMap.has(i)) {
        for (const s of signalMap.get(i)!) {
          if (s.orderType === 'cancel') {
             pendingOrders = pendingOrders.filter(o => o.tag !== s.tag);
          } else {
             pendingOrders.push(s);
          }
        }
      }

      const nextPending: BacktestSignal[] = [];
      for (const order of pendingOrders) {
        if (consecutiveLosses >= maxConsecutiveLosses) {
           continue;
        }
        if (order.timeoutBars && i - order.timeIndex >= order.timeoutBars) {
           continue;
        }

        let shouldFill = false;
        if (!order.orderType || order.orderType === 'market') shouldFill = true;
        else if (order.orderType === 'limit') {
           if (order.direction === 'buy' && currentPrice <= order.limitPrice!) shouldFill = true;
           if (order.direction === 'sell' && currentPrice >= order.limitPrice!) shouldFill = true;
        } else if (order.orderType === 'stop') {
           if (order.direction === 'buy' && currentPrice >= order.stopPrice!) shouldFill = true;
           if (order.direction === 'sell' && currentPrice <= order.stopPrice!) shouldFill = true;
        } else if (order.orderType === 'take_profit') {
           if (order.direction === 'sell' && currentPrice >= order.limitPrice!) shouldFill = true;
           if (order.direction === 'buy' && currentPrice <= order.limitPrice!) shouldFill = true;
        }

        if (!shouldFill) {
           nextPending.push(order);
           continue;
        }

        if (lastTradeIndex >= 0 && i - lastTradeIndex < cooldownBars) {
           nextPending.push(order);
           continue;
        }

        let volume = order.volume ?? 1;
        if (volume < minTradeVolume) continue;

        if (order.direction === 'buy' && positions >= maxOpenPositions) {
           nextPending.push(order);
           continue;
        }
        if (order.direction === 'sell' && positions <= 0) {
           nextPending.push(order);
           continue;
        }
        if (order.direction !== 'buy' && order.direction !== 'sell') continue;

        let fillPrice = order.price ?? currentPrice;
        if (order.orderType === 'limit') {
            fillPrice = order.direction === 'buy' ? Math.min(currentPrice, order.limitPrice!) : Math.max(currentPrice, order.limitPrice!);
        }
        if (order.orderType === 'stop') {
            fillPrice = order.direction === 'buy' ? Math.max(currentPrice, order.stopPrice!) : Math.min(currentPrice, order.stopPrice!);
        }
        if (order.orderType === 'take_profit') {
            fillPrice = order.direction === 'buy' ? Math.min(currentPrice, order.limitPrice!) : Math.max(currentPrice, order.limitPrice!);
        }

        const perUnitSlippage = fillPrice * this.options.slippage;
        const executionPrice = order.direction === 'buy' ? fillPrice + perUnitSlippage : fillPrice - perUnitSlippage;

        if (order.direction === 'buy' && cashBalance < (executionPrice + fillPrice * this.options.feeRate) * volume) {
           volume = Math.floor(cashBalance / (executionPrice + fillPrice * this.options.feeRate));
           if (volume < minTradeVolume) {
               nextPending.push(order);
               continue;
           }
        }
        if (order.direction === 'sell') {
           volume = Math.min(volume, positions);
        }

        const slippage = perUnitSlippage * volume;
        const fee = fillPrice * this.options.feeRate * volume;
        const tradeValue = executionPrice * volume;
        const tradePnl = order.direction === 'buy' ? 0 : (executionPrice - positionCost) * volume - fee;

        if (order.direction === 'buy') {
           const newTotalCost = positionCost * positions + tradeValue + fee;
           cashBalance -= (tradeValue + fee);
           positions += volume;
           positionCost = positions > 0 ? newTotalCost / positions : 0;
           if (positions === volume) entryIndex = i;
        } else {
           cashBalance += (tradeValue - fee);
           positions -= volume;
           if (positions === 0) positionCost = 0;
           pnl += tradePnl;
           if (tradePnl < 0) consecutiveLosses++; else consecutiveLosses = 0;
        }

        totalFees += fee;
        totalSlippage += slippage;
        lastTradeIndex = i;

        let exitReason = order.exitReason;
        if (!exitReason) {
            if (order.orderType === 'stop') exitReason = 'stop_loss';
            if (order.orderType === 'take_profit') exitReason = 'take_profit';
        }

        const trade: BacktestTrade = {
          timeIndex: i, direction: order.direction, price: fillPrice, executionPrice, fee, slippage, volume,
          ...(order.strategyId ? { strategyId: order.strategyId } : {}),
          ...(order.source ? { source: order.source } : {}),
          ...(order.tag ? { tag: order.tag } : {}),
          ...(exitReason ? { exitReason } : {}),
          pnl: order.direction === 'sell' ? tradePnl : 0,
          ...(order.direction === 'sell' ? { holdingTime: i - entryIndex } : {})
        };
        trades.push(trade);

        const segment = Math.floor(i / segmentSize);
        const current = segments.get(segment) ?? { segment, fromIndex: segment * segmentSize, toIndex: Math.min(prices.length - 1, (segment + 1) * segmentSize - 1), pnl: 0, trades: 0 };
        if (order.direction === 'sell') current.pnl += tradePnl;
        current.trades += 1;
        segments.set(segment, current);
      }
      pendingOrders = nextPending;

      currentEquity = cashBalance + positions * currentPrice;
      equityCurve.push(currentEquity);
      const drawdownPost = peak > 0 ? (peak - currentEquity) / peak : 0;
      underwaterCurve.push(-drawdownPost * 100);
    }

    const unrealizedPnl = positions > 0 ? positions * (prices[prices.length - 1] || 0) - positionCost * positions : 0;
    const ledger = { realizedPnl: pnl, unrealizedPnl, maxDrawdown: maxDrawdown * 100 };

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
      ledger,
      metrics: calculateBacktestMetrics({ startingBalance, equityCurve, trades }),
    };
    if (cacheKey !== undefined) this.cache.set(cacheKey, cloneResult(result));
    return result;
  }
}
