// ============================================
// KELLY CRITERION POSITION SIZER + BACKTESTING
// ============================================

export class KellySizer {
  /**
   * Calculate optimal position size using fractional Kelly
   * @param probability - estimated win probability (0-1)
   * @param price - current market price of YES/NO share (0-1)
   * @param bankroll - total available capital
   * @param fraction - fraction of full Kelly to use (default 0.25 = quarter Kelly)
   */
  calculate(probability: number, price: number, bankroll: number, fraction: number = 0.25): {
    kellyFraction: number;
    suggestedAmountUsd: number;
    edgePct: number;
    reasoning: string;
  } {
    const b = (1 / price) - 1; // net odds
    const p = probability;
    const q = 1 - p;

    // Full Kelly: f* = (bp - q) / b
    const fullKelly = b > 0 ? (b * p - q) / b : 0;
    const fractionalKelly = Math.max(0, Math.min(fullKelly * fraction, 0.15)); // Cap at 15% of bankroll

    const amount = bankroll * fractionalKelly;
    const edge = ((p - price) / price) * 100;

    let reasoning = '';
    if (fullKelly <= 0) {
      reasoning = '没有正期望值——不要下注';
    } else if (fractionalKelly < 0.01) {
      reasoning = '优势很小——建议最小仓位';
    } else if (edge > 20) {
      reasoning = '检测到明显优势——有充分理由建立有效仓位';
    } else {
      reasoning = `相对市场价格有 ${edge.toFixed(1)}% 优势`;
    }

    return {
      kellyFraction: parseFloat(fractionalKelly.toFixed(4)),
      suggestedAmountUsd: Math.round(amount * 100) / 100,
      edgePct: parseFloat(edge.toFixed(2)),
      reasoning,
    };
  }
}

// ============================================
// BACKTESTING ENGINE
// ============================================

import fs from 'fs';
import path from 'path';

import { DATA_ROOT } from '../utils/paths';
import { stockDataService } from './stock-data-service';
import { binanceFeed } from './binance';
const DATA_DIR = DATA_ROOT;
const HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');

export interface BacktestResult {
  strategyName: string;
  periodDays: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  avgHoldMinutes: number;
  equityCurve: Array<{ time: number; equity: number }>;
  trades: Array<{
    marketId: number;
    action: 'BUY_YES' | 'BUY_NO';
    entryPrice: number;
    exitPrice: number;
    entryTime: number;
    exitTime: number;
    pnlPct: number;
  }>;
}

export type AssetMarket = 'stocks' | 'crypto';

export interface AssetBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface AssetBacktestInput {
  market: AssetMarket;
  instrumentId: string;
  dataSource: string;
  bars: AssetBar[];
  strategy: 'momentum' | 'meanReversion';
  lookback: number;
  threshold: number;
  holding: number;
  startingBalance: number;
  feesBps?: number;
  slippageBps?: number;
}

export interface AssetBacktestResult {
  market: AssetMarket;
  instrumentId: string;
  dataSource: string;
  barCount: number;
  startTime: number;
  endTime: number;
  strategyName: string;
  periodDays: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  avgHoldMinutes: number;
  equityCurve: Array<{ time: number; equity: number }>;
  trades: Array<{
    instrumentId: string;
    side: 'long';
    entryPrice: number;
    exitPrice: number;
    entryTime: number;
    exitTime: number;
    pnlPct: number;
  }>;
}

function roundNumber(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

/**
 * A market-neutral price-bar engine for traditional assets.
 * It deliberately has a different result contract from prediction-market
 * backtests: trades are long positions in an instrument, never YES/NO bets.
 */
export function runAssetBacktest(input: AssetBacktestInput): AssetBacktestResult {
  const instrumentId = String(input.instrumentId || '').trim().toUpperCase();
  const lookback = Math.max(1, Math.floor(input.lookback));
  const holding = Math.max(1, Math.floor(input.holding));
  const threshold = Number(input.threshold);
  const startingBalance = Number(input.startingBalance);
  const feesBps = Math.max(0, Number(input.feesBps ?? 10));
  const slippageBps = Math.max(0, Number(input.slippageBps ?? 5));
  const cleanBars = input.bars
    .filter(bar => Number.isFinite(bar.time) && Number.isFinite(bar.close) && bar.close > 0)
    .sort((left, right) => left.time - right.time);

  if (!instrumentId) throw new Error('回测标的不能为空');
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('回测阈值无效');
  if (!Number.isFinite(startingBalance) || startingBalance <= 0) throw new Error('回测初始资金无效');
  if (cleanBars.length < lookback + holding + 2) throw new Error('历史数据不足，无法进行真实回测');

  const trades: AssetBacktestResult['trades'] = [];
  const equityCurve: AssetBacktestResult['equityCurve'] = [{ time: cleanBars[0].time, equity: startingBalance }];
  const returns: number[] = [];
  let balance = startingBalance;
  let peak = startingBalance;
  let maxDrawdown = 0;
  const roundTripCost = ((feesBps + slippageBps) * 2) / 10_000;

  for (let index = lookback; index + holding < cleanBars.length; index += holding) {
    const previous = cleanBars[index - lookback].close;
    const entry = cleanBars[index].close;
    const change = (entry - previous) / previous;
    const shouldEnter = input.strategy === 'momentum' ? change >= threshold : change <= -threshold;
    if (!shouldEnter) continue;

    const exitIndex = index + holding;
    const exit = cleanBars[exitIndex].close;
    const grossReturn = (exit - entry) / entry;
    const netReturn = grossReturn - roundTripCost;
    const betSize = balance * 0.05;
    const pnl = betSize * netReturn;
    balance += pnl;
    returns.push(netReturn);
    trades.push({
      instrumentId,
      side: 'long',
      entryPrice: roundNumber(entry),
      exitPrice: roundNumber(exit),
      entryTime: cleanBars[index].time,
      exitTime: cleanBars[exitIndex].time,
      pnlPct: roundNumber(netReturn * 100, 2),
    });
    equityCurve.push({ time: cleanBars[exitIndex].time, equity: roundNumber(balance, 2) });
    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - balance) / peak) * 100 : 0);
  }

  const wins = trades.filter(trade => trade.pnlPct > 0).length;
  const averageReturn = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((sum, value) => sum + Math.pow(value - averageReturn, 2), 0) / (returns.length - 1)
    : 0;
  const deviation = Math.sqrt(variance);
  const holdTimes = trades.map(trade => trade.exitTime - trade.entryTime).filter(value => value > 0);

  return {
    market: input.market,
    instrumentId,
    dataSource: input.dataSource,
    barCount: cleanBars.length,
    startTime: cleanBars[0].time,
    endTime: cleanBars[cleanBars.length - 1].time,
    strategyName: input.strategy === 'momentum' ? '动量（做多）' : '均值回归（做多）',
    periodDays: Math.round((cleanBars[cleanBars.length - 1].time - cleanBars[0].time) / 86_400_000),
    totalTrades: trades.length,
    winningTrades: wins,
    losingTrades: trades.length - wins,
    winRate: trades.length ? wins / trades.length : 0,
    totalReturnPct: roundNumber(((balance - startingBalance) / startingBalance) * 100, 2),
    maxDrawdownPct: roundNumber(maxDrawdown, 2),
    sharpeRatio: deviation > 0 ? roundNumber((averageReturn / deviation) * Math.sqrt(Math.min(returns.length, 252)), 2) : 0,
    avgHoldMinutes: holdTimes.length ? roundNumber(holdTimes.reduce((sum, value) => sum + value, 0) / holdTimes.length / 60_000, 1) : 0,
    equityCurve,
    trades: trades.slice(-50),
  };
}

interface SimplePricePoint { t: number; p: number }

function loadHistoryData(): Record<string, { title: string; yes: SimplePricePoint[]; no: SimplePricePoint[] }> {
  if (!fs.existsSync(HISTORY_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return {}; }
}

export class Backtester {

  /**
   * Run a momentum-based backtest on recorded price history
   */
  runMomentumBacktest(
    lookbackPoints: number = 10,
    threshold: number = 0.03,
    holdingPeriodPoints: number = 5,
    startingBalance: number = 1000,
    marketId?: number,
  ): BacktestResult {
    return this.runStrategyBacktest('momentum', lookbackPoints, threshold, holdingPeriodPoints, startingBalance, marketId);
  }

  /**
   * Run a mean-reversion backtest on recorded YES/NO price history.
   * A sharp move is faded instead of followed.
   */
  runMeanReversionBacktest(
    lookbackPoints: number = 10,
    threshold: number = 0.03,
    holdingPeriodPoints: number = 5,
    startingBalance: number = 1000,
    marketId?: number,
  ): BacktestResult {
    return this.runStrategyBacktest('meanReversion', lookbackPoints, threshold, holdingPeriodPoints, startingBalance, marketId);
  }

  async runStockBacktest(
    strategy: 'momentum' | 'meanReversion',
    symbol: string,
    lookback = 10,
    threshold = 0.03,
    holding = 5,
    startingBalance = 1000,
  ): Promise<AssetBacktestResult> {
    const overview = await stockDataService.overview(symbol);
    const historySnapshot = overview.snapshots.find(snapshot => snapshot.source.includes('history'));
    if (!overview.bars.length) throw new Error('股票真实 OHLCV 历史数据不可用');
    return runAssetBacktest({
      market: 'stocks',
      instrumentId: overview.symbol,
      dataSource: historySnapshot?.source || 'nasdaq-public-history',
      bars: overview.bars,
      strategy,
      lookback,
      threshold,
      holding,
      startingBalance,
    });
  }

  async runCryptoBacktest(
    strategy: 'momentum' | 'meanReversion',
    symbol: string,
    lookback = 10,
    threshold = 0.03,
    holding = 5,
    startingBalance = 1000,
  ): Promise<AssetBacktestResult> {
    const instrumentId = String(symbol || '').trim().toUpperCase().replace(/[/:_-]/g, '');
    if (!/^[A-Z0-9]{5,20}$/.test(instrumentId)) throw new Error('虚拟币交易对无效');
    const klines = await binanceFeed.getKlines(instrumentId, '1d', 1000);
    const bars: AssetBar[] = klines.map(kline => ({
      time: Number(kline.time),
      open: Number(kline.open),
      high: Number(kline.high),
      low: Number(kline.low),
      close: Number(kline.close),
      volume: Number(kline.volume),
    }));
    if (!bars.length) throw new Error('虚拟币真实 K 线历史数据不可用');
    return runAssetBacktest({
      market: 'crypto',
      instrumentId,
      dataSource: 'binance-public-klines',
      bars,
      strategy,
      lookback,
      threshold,
      holding,
      startingBalance,
    });
  }

  private runStrategyBacktest(
    strategy: 'momentum' | 'meanReversion',
    lookbackPoints: number,
    threshold: number,
    holdingPeriodPoints: number,
    startingBalance: number,
    marketId?: number,
  ): BacktestResult {
    const history = loadHistoryData();
    const trades: BacktestResult['trades'] = [];
    const equityCurve: Array<{ time: number; equity: number }> = [];
    let balance = startingBalance;
    let peak = startingBalance;
    let maxDD = 0;
    let returns: number[] = [];

    for (const [marketIdStr, market] of Object.entries(history)) {
      if (marketId != null && marketIdStr !== String(marketId)) continue;
      const yesPrices = market.yes.map(p => p.p);
      const timestamps = market.yes.map(p => p.t);
      if (yesPrices.length < lookbackPoints + holdingPeriodPoints + 1) continue;

      for (let i = lookbackPoints; i < yesPrices.length - holdingPeriodPoints; i += holdingPeriodPoints) {
        const pastPrice = yesPrices[i - lookbackPoints];
        const currentPrice = yesPrices[i];
        const change = (currentPrice - pastPrice) / pastPrice;

        let action: 'BUY_YES' | 'BUY_NO' | null = null;
        if (strategy === 'momentum') {
          if (change > threshold) action = 'BUY_YES';
          else if (change < -threshold) action = 'BUY_NO';
        } else {
          if (change < -threshold) action = 'BUY_YES';
          else if (change > threshold) action = 'BUY_NO';
        }

        if (!action || balance <= 0) continue;

        const entryPrice = action === 'BUY_YES' ? currentPrice : 1 - currentPrice;
        const exitIdx = Math.min(i + holdingPeriodPoints, yesPrices.length - 1);
        const exitYesPrice = yesPrices[exitIdx];
        const exitPrice = action === 'BUY_YES' ? exitYesPrice : 1 - exitYesPrice;

        const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        const betSize = balance * 0.05; // Risk 5% per trade
        const pnl = betSize * (pnlPct / 100);
        balance += pnl;
        returns.push(pnlPct);

        trades.push({
          marketId: parseInt(marketIdStr),
          action,
          entryPrice: parseFloat(entryPrice.toFixed(4)),
          exitPrice: parseFloat(exitPrice.toFixed(4)),
          entryTime: timestamps[i],
          exitTime: timestamps[exitIdx],
          pnlPct: parseFloat(pnlPct.toFixed(2)),
        });

        equityCurve.push({ time: timestamps[exitIdx], equity: parseFloat(balance.toFixed(2)) });
        if (balance > peak) peak = balance;
        const dd = ((peak - balance) / peak) * 100;
        if (dd > maxDD) maxDD = dd;
      }
    }

    const wins = trades.filter(t => t.pnlPct > 0).length;
    const avgReturn = returns.length > 0 ? returns.reduce((s, v) => s + v, 0) / returns.length : 0;
    const stdDev = returns.length > 1 ?
      Math.sqrt(returns.reduce((s, v) => s + Math.pow(v - avgReturn, 2), 0) / (returns.length - 1)) : 0;
    const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(Math.min(trades.length, 252)) : 0;

    const times = trades.map(t => t.exitTime - t.entryTime).filter(t => t > 0);
    const avgHoldMin = times.length > 0 ? times.reduce((s, v) => s + v, 0) / times.length / 60000 : 0;

    return {
      strategyName: strategy === 'momentum' ? 'Momentum' : 'Mean Reversion',
      periodDays: this.getPeriodDays(equityCurve),
      totalTrades: trades.length,
      winningTrades: wins,
      losingTrades: trades.length - wins,
      winRate: trades.length > 0 ? wins / trades.length : 0,
      totalReturnPct: parseFloat((((balance - startingBalance) / startingBalance) * 100).toFixed(2)),
      maxDrawdownPct: parseFloat(maxDD.toFixed(2)),
      sharpeRatio: parseFloat(sharpe.toFixed(2)),
      avgHoldMinutes: parseFloat(avgHoldMin.toFixed(1)),
      equityCurve,
      trades: trades.slice(-50),
    };
  }

  private getPeriodDays(curve: Array<{ time: number }>): number {
    if (curve.length < 2) return 0;
    return Math.round((curve[curve.length - 1].time - curve[0].time) / 86400000);
  }
}

export const kellySizer = new KellySizer();
export const backtester = new Backtester();

