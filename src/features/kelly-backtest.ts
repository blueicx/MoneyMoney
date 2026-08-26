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
    startingBalance: number = 1000
  ): BacktestResult {
    const history = loadHistoryData();
    const trades: BacktestResult['trades'] = [];
    const equityCurve: Array<{ time: number; equity: number }> = [];
    let balance = startingBalance;
    let peak = startingBalance;
    let maxDD = 0;
    let returns: number[] = [];

    for (const [marketIdStr, market] of Object.entries(history)) {
      const yesPrices = market.yes.map(p => p.p);
      const timestamps = market.yes.map(p => p.t);
      if (yesPrices.length < lookbackPoints + holdingPeriodPoints + 1) continue;

      for (let i = lookbackPoints; i < yesPrices.length - holdingPeriodPoints; i += holdingPeriodPoints) {
        const pastPrice = yesPrices[i - lookbackPoints];
        const currentPrice = yesPrices[i];
        const change = (currentPrice - pastPrice) / pastPrice;

        let action: 'BUY_YES' | 'BUY_NO' | null = null;
        if (change > threshold) action = 'BUY_YES';
        else if (change < -threshold) action = 'BUY_NO';

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
      strategyName: 'Momentum',
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

