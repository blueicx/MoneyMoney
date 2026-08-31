// ============================================
// PAPER TRADING ENGINE - Simulates trades without real money
// ============================================

import fs from 'fs';
import path from 'path';
import { config } from '../config';

export interface PaperPosition {
  id: string;
  marketId: number;
  marketTitle: string;
  outcomeIndex: 0 | 1; // 0=YES, 1=NO
  outcomeName: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice?: number;
  quantity: number;
  entryTime: string;
  exitPrice?: number;
  exitTime?: string;
  status: 'OPEN' | 'CLOSED';
  pnlUsd?: number;
  pnlPct?: number;
}

export interface PaperTradeLog {
  id: string;
  marketId: number;
  marketTitle: string;
  action: string;
  outcomeName: string;
  price: number;
  quantity: number;
  timestamp: string;
  reason: string;
}

export interface PaperPortfolio {
  startingBalance: number;
  cashBalance: number;
  positions: PaperPosition[];
  tradeLog: PaperTradeLog[];
  totalPnl: number;
  winsCount: number;
  lossesCount: number;
  maxDrawdownPct: number;
  peakEquity: number;
}

import { DATA_ROOT } from '../utils/paths';
const DATA_DIR = DATA_ROOT;
const PORTFOLIO_FILE = path.join(DATA_DIR, 'paper-portfolio.json');

export function validatePaperOrderInput(input: { price: unknown; amountUsd: unknown }): { ok: boolean; error?: string } {
  const price = Number(input.price);
  const amountUsd = Number(input.amountUsd);
  if (!Number.isFinite(price) || price <= 0 || price > 1) return { ok: false, error: '价格必须大于 0 且不超过 1' };
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { ok: false, error: '金额必须大于 0' };
  return { ok: true };
}

export function calculatePaperPortfolioValue(p: PaperPortfolio): {
  openPositionsValue: number;
  equity: number;
  unrealizedPnl: number;
} {
  const openPositionsValue = p.positions
    .filter(position => position.status === 'OPEN')
    .reduce((sum, position) => sum + position.quantity * (position.currentPrice ?? position.entryPrice), 0);
  const openCost = p.positions
    .filter(position => position.status === 'OPEN')
    .reduce((sum, position) => sum + position.quantity * position.entryPrice, 0);
  return {
    openPositionsValue: Math.round(openPositionsValue * 100) / 100,
    equity: Math.round((p.cashBalance + openPositionsValue) * 100) / 100,
    unrealizedPnl: Math.round((openPositionsValue - openCost) * 100) / 100,
  };
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function defaultPortfolio(): PaperPortfolio {
  return {
    startingBalance: 1000,
    cashBalance: 1000,
    positions: [],
    tradeLog: [],
    totalPnl: 0,
    winsCount: 0,
    lossesCount: 0,
    maxDrawdownPct: 0,
    peakEquity: 1000,
  };
}

function loadPortfolio(): PaperPortfolio {
  ensureDataDir();
  if (fs.existsSync(PORTFOLIO_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf8'));
    } catch { return defaultPortfolio(); }
  }
  return defaultPortfolio();
}

function savePortfolio(p: PaperPortfolio): void {
  ensureDataDir();
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(p, null, 2));
}

let portfolio = loadPortfolio();

export class PaperTradingEngine {

  /**
   * Portfolio risk analytics computed from closed positions.
   * Gives the assistant quantitative evidence for experience summarization.
   */
  getRiskMetrics(): {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    expectancyUsd: number;
    sharpeRatio: number;
    var95Usd: number;
    avgWinUsd: number;
    avgLossUsd: number;
    payoffRatio: number;
    maxDrawdownPct: number;
    bestTradeUsd: number;
    worstTradeUsd: number;
    equityCurve: Array<{ time: string; equity: number }>;
  } {
    const closed = portfolio.positions
      .filter(p => p.status === 'CLOSED' && typeof p.pnlUsd === 'number')
      .sort((a, b) => new Date(a.exitTime || a.entryTime).getTime() - new Date(b.exitTime || b.entryTime).getTime());

    const pnls = closed.map(p => p.pnlUsd!);
    const n = pnls.length;

    if (n === 0) {
      return {
        totalTrades: 0, winRate: 0, profitFactor: 0, expectancyUsd: 0,
        sharpeRatio: 0, var95Usd: 0, avgWinUsd: 0, avgLossUsd: 0,
        payoffRatio: 0, maxDrawdownPct: 0, bestTradeUsd: 0, worstTradeUsd: 0,
        equityCurve: [],
      };
    }

    const wins = pnls.filter(v => v > 0);
    const losses = pnls.filter(v => v <= 0);
    const grossProfit = wins.reduce((s, v) => s + v, 0);
    const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
    const mean = pnls.reduce((s, v) => s + v, 0) / n;
    const std = Math.sqrt(pnls.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n);

    // Sharpe ratio per trade (not annualized; small sample safe)
    const sharpeRatio = std > 0 ? mean / std : 0;

    // VaR at 95% confidence = 5th percentile of PnL
    const sortedPnls = [...pnls].sort((a, b) => a - b);
    const varIndex = Math.max(0, Math.floor(n * 0.05));
    const var95Usd = sortedPnls[varIndex] ?? sortedPnls[0];

    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

    // Equity curve starting from initial balance
    let runningEquity = portfolio.startingBalance;
    const equityCurve: Array<{ time: string; equity: number }> = [
      { time: closed[0]?.entryTime || new Date().toISOString(), equity: portfolio.startingBalance },
    ];
    for (const p of closed) {
      runningEquity += p.pnlUsd!;
      equityCurve.push({ time: p.exitTime || p.entryTime, equity: Math.round(runningEquity * 100) / 100 });
    }

    return {
      totalTrades: n,
      winRate: wins.length / n,
      profitFactor: Math.min(99, grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? 99 : 0),
      expectancyUsd: Math.round(mean * 100) / 100,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      var95Usd: Math.round(var95Usd * 100) / 100,
      avgWinUsd: Math.round(avgWin * 100) / 100,
      avgLossUsd: Math.round(avgLoss * 100) / 100,
      payoffRatio: Math.min(99, avgLoss > 0 ? Math.round((avgWin / avgLoss) * 100) / 100 : avgWin > 0 ? 99 : 0),
      maxDrawdownPct: Math.round(portfolio.maxDrawdownPct * 100) / 100,
      bestTradeUsd: Math.round(Math.max(...pnls) * 100) / 100,
      worstTradeUsd: Math.round(Math.min(...pnls) * 100) / 100,
      equityCurve,
    };
  }

  reset(startingBalance?: number): PaperPortfolio {
    portfolio = defaultPortfolio();
    if (startingBalance) portfolio.startingBalance = startingBalance;
    portfolio.cashBalance = portfolio.startingBalance;
    portfolio.peakEquity = portfolio.startingBalance;
    savePortfolio(portfolio);
    return portfolio;
  }

  /**
   * Monte Carlo portfolio risk simulation.
   * Bootstrap-resamples historical per-trade PnL to project future
   * max-drawdown distribution over the next `tradesPerSim` trades.
   */
  runMonteCarlo(simulations = 2000, tradesPerSim = 20): {
    simulations: number;
    tradesPerSim: number;
    sampleTrades: number;
    currentEquityUsd: number;
    maxDrawdownP5Pct: number;
    maxDrawdownP50Pct: number;
    maxDrawdownP95Pct: number;
    finalReturnP5Pct: number;
    finalReturnP50Pct: number;
    finalReturnP95Pct: number;
    ruinProbabilityPct: number;
    noteZh: string;
  } | { error: string } {
    const closed = portfolio.positions
      .filter(p => p.status === 'CLOSED' && typeof p.pnlUsd === 'number');
    if (closed.length < 5) {
      return { error: '至少需要 5 笔已平仓交易才能跑蒙特卡洛模拟' };
    }
    const pnls = closed.map(p => p.pnlUsd!);
    const currentEquity = portfolio.startingBalance + pnls.reduce((s, v) => s + v, 0);
    // Scale sampled PnL to current equity so projections stay proportional.
    const scaleFactor = Math.max(currentEquity, 1) / Math.max(portfolio.startingBalance, 1);

    const ddResults: number[] = [];
    const finalReturns: number[] = [];
    let ruinCount = 0;
    for (let sim = 0; sim < simulations; sim++) {
      let equity = currentEquity;
      let peak = equity;
      let maxDd = 0;
      for (let t = 0; t < tradesPerSim; t++) {
        const sampled = pnls[Math.floor(Math.random() * pnls.length)] * scaleFactor;
        equity += sampled;
        if (equity > peak) peak = equity;
        if (peak > 0) {
          const dd = ((peak - equity) / peak) * 100;
          if (dd > maxDd) maxDd = dd;
        }
      }
      ddResults.push(maxDd);
      finalReturns.push(((equity / currentEquity) - 1) * 100);
      if (maxDd >= 30) ruinCount++;
    }
    ddResults.sort((a, b) => a - b);
    finalReturns.sort((a, b) => a - b);
    const pct = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] ?? 0;
    return {
      simulations,
      tradesPerSim,
      sampleTrades: pnls.length,
      currentEquityUsd: Math.round(currentEquity * 100) / 100,
      maxDrawdownP5Pct: Math.round(pct(ddResults, 0.05) * 10) / 10,
      maxDrawdownP50Pct: Math.round(pct(ddResults, 0.5) * 10) / 10,
      maxDrawdownP95Pct: Math.round(pct(ddResults, 0.95) * 10) / 10,
      finalReturnP5Pct: Math.round(pct(finalReturns, 0.05) * 10) / 10,
      finalReturnP50Pct: Math.round(pct(finalReturns, 0.5) * 10) / 10,
      finalReturnP95Pct: Math.round(pct(finalReturns, 0.95) * 10) / 10,
      ruinProbabilityPct: Math.round((ruinCount / simulations) * 1000) / 10,
      noteZh: '按历史每笔盈亏随机重排，模拟未来 20 笔交易的最大回撤分布。30% 回撤视为「重创线」。',
    };
  }

  getPortfolio(): PaperPortfolio & { openPositionsValue: number; equity: number; unrealizedPnl: number; winRate: number } {
    const { openPositionsValue: openValue, equity, unrealizedPnl } = calculatePaperPortfolioValue(portfolio);
    const closed = portfolio.positions.filter(p => p.status === 'CLOSED');
    const winRate = closed.length > 0 ? portfolio.winsCount / closed.length : 0;

    // Update drawdown
    if (equity > portfolio.peakEquity) {
      portfolio.peakEquity = equity;
      savePortfolio(portfolio);
    }
    const dd = ((portfolio.peakEquity - equity) / portfolio.peakEquity) * 100;
    if (dd > portfolio.maxDrawdownPct) {
      portfolio.maxDrawdownPct = dd;
      savePortfolio(portfolio);
    }

    return { ...portfolio, openPositionsValue: openValue, equity, unrealizedPnl, winRate };
  }

  /**
   * Open a simulated position
   */
  openPosition(
    marketId: number,
    marketTitle: string,
    outcomeIndex: 0 | 1,
    outcomeName: string,
    price: number,
    amountUsd: number,
    reason: string = ''
  ): { success: boolean; message: string; position?: PaperPosition } {
    const validation = validatePaperOrderInput({ price, amountUsd });
    if (!validation.ok) return { success: false, message: validation.error || '模拟订单参数无效' };
    const qty = Math.floor(amountUsd / price);
    if (qty <= 0) return { success: false, message: '金额低于该价格可交易的最小数量' };
    if (amountUsd > portfolio.cashBalance) return { success: false, message: `模拟余额不足（可用 $${portfolio.cashBalance.toFixed(2)}）` };

    const pos: PaperPosition = {
      id: `pp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      marketId,
      marketTitle,
      outcomeIndex,
      outcomeName,
      side: 'BUY',
      entryPrice: price,
      currentPrice: price,
      quantity: qty,
      entryTime: new Date().toISOString(),
      status: 'OPEN',
    };

    portfolio.cashBalance -= qty * price;
    portfolio.positions.push(pos);
    portfolio.tradeLog.unshift({
      id: `tl_${Date.now()}`,
      marketId, marketTitle,
      action: 'BUY',
      outcomeName,
      price, quantity: qty,
      timestamp: new Date().toISOString(),
      reason,
    });

    savePortfolio(portfolio);
    return { success: true, message: `已开仓 ${outcomeName} × ${qty} @ $${price.toFixed(4)}`, position: pos };
  }

  /**
   * Close a position at current market price
   */
  closePosition(positionId: string, exitPrice: number): { success: boolean; message: string; pnl?: number } {
    if (!Number.isFinite(exitPrice) || exitPrice <= 0 || exitPrice > 1) return { success: false, message: '平仓价格必须大于 0 且不超过 1' };
    const pos = portfolio.positions.find(p => p.id === positionId && p.status === 'OPEN');
    if (!pos) return { success: false, message: '未找到持仓，或已平仓' };

    const proceeds = pos.quantity * exitPrice;
    const cost = pos.quantity * pos.entryPrice;
    const pnl = proceeds - cost;
    const pnlPct = (pnl / cost) * 100;

    pos.exitPrice = exitPrice;
    pos.currentPrice = exitPrice;
    pos.exitTime = new Date().toISOString();
    pos.status = 'CLOSED';
    pos.pnlUsd = parseFloat(pnl.toFixed(4));
    pos.pnlPct = parseFloat(pnlPct.toFixed(2));

    portfolio.cashBalance += proceeds;
    portfolio.totalPnl += pnl;

    if (pnl >= 0) portfolio.winsCount++;
    else portfolio.lossesCount++;

    portfolio.tradeLog.unshift({
      id: `tl_${Date.now()}`,
      marketId: pos.marketId,
      marketTitle: pos.marketTitle,
      action: 'SELL',
      outcomeName: pos.outcomeName,
      price: exitPrice,
      quantity: pos.quantity,
      timestamp: new Date().toISOString(),
      reason: `平仓 | 盈亏: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`,
    });

    savePortfolio(portfolio);
    return { success: true, message: `已平仓 ${pos.outcomeName} | 盈亏: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`, pnl };
  }

  markToMarket(currentPrices: Map<number, { yesPrice: number; noPrice: number }>): void {
    let changed = false;
    for (const position of portfolio.positions.filter(item => item.status === 'OPEN')) {
      const prices = currentPrices.get(position.marketId);
      const price = prices ? (position.outcomeIndex === 0 ? prices.yesPrice : prices.noPrice) : undefined;
      if (price != null && Number.isFinite(price) && price > 0 && price <= 1) {
        position.currentPrice = price;
        changed = true;
      }
    }
    if (changed) savePortfolio(portfolio);
  }

  /**
   * Check all open positions against current prices and close at stop-loss/take-profit
   */
  checkStopLossTakeProfit(currentPrices: Map<number, { yesPrice: number; noPrice: number }>): string[] {
    const messages: string[] = [];
    const slPct = 15; // Stop loss %
    const tpPct = 50; // Take profit %

    for (const pos of portfolio.positions.filter(p => p.status === 'OPEN')) {
      const prices = currentPrices.get(pos.marketId);
      if (!prices) continue;
      const currentPrice = pos.outcomeIndex === 0 ? prices.yesPrice : prices.noPrice;
      if (!currentPrice || currentPrice <= 0) continue;

      const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

      if (pnlPct <= -slPct) {
        const r = this.closePosition(pos.id, currentPrice);
        messages.push(`🛑 止损：${pos.outcomeName} on "${pos.marketTitle}" | ${r.message}`);
      } else if (pnlPct >= tpPct) {
        const r = this.closePosition(pos.id, currentPrice);
        messages.push(`🎯 止盈：${pos.outcomeName} on "${pos.marketTitle}" | ${r.message}`);
      }
    }

    return messages;
  }

  getOpenPositions(): PaperPosition[] {
    return portfolio.positions.filter(p => p.status === 'OPEN');
  }

  getClosedPositions(): PaperPosition[] {
    return portfolio.positions.filter(p => p.status === 'CLOSED').slice(-20).reverse();
  }

  getRecentTrades(count = 20): PaperTradeLog[] {
    return portfolio.tradeLog.slice(0, count);
  }
}

export const paperEngine = new PaperTradingEngine();

