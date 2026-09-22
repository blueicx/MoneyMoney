// ============================================
// PAPER TRADING ENGINE - Simulates trades without real money
// ============================================

import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { config } from '../config';
import { stateStore } from '../storage/sqlite-state';
import { unifiedPaperLedgerStore, calculateUnifiedPerformance, type UnifiedPaperLedger, type UnifiedPaperOrder } from './unified-paper-trading';

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
  const stored = stateStore.get<PaperPortfolio>('paper-portfolio');
  if (stored) return stored;
  if (fs.existsSync(PORTFOLIO_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf8'));
    } catch { return defaultPortfolio(); }
  }
  return defaultPortfolio();
}

function savePortfolio(p: PaperPortfolio): void {
  ensureDataDir();
  stateStore.set('paper-portfolio', p, 1);
}

let portfolio = loadPortfolio();

export class PaperTradingEngine {

  previewOpen(marketId: number, price: number, amountUsd: number): { ok: boolean; message: string } {
    const validation = validatePaperOrderInput({ price, amountUsd });
    if (!validation.ok) return { ok: false, message: validation.error || '模拟订单参数无效' };
    if (amountUsd > portfolio.cashBalance) return { ok: false, message: `模拟余额不足（可用 $${portfolio.cashBalance.toFixed(2)}）` };
    if (!Number.isFinite(marketId)) return { ok: false, message: '市场 ID 无效' };
    return { ok: true, message: '模拟订单参数有效' };
  }

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
  runMonteCarlo(simulations = 2000, tradesPerSim = 20, seed = 42): {
    seed: number;
    snapshotHash: string;
    algorithm: string;
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
    if (!Number.isInteger(simulations) || simulations < 1 || simulations > 10_000 ||
        !Number.isInteger(tradesPerSim) || tradesPerSim < 1 || tradesPerSim > 100 ||
        !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      return { error: '模拟次数须为 1–10000、交易数须为 1–100 的整数，随机种子须为 uint32' };
    }
    const closed = portfolio.positions
      .filter(p => p.status === 'CLOSED' && typeof p.pnlUsd === 'number');
    if (closed.length < 5) {
      return { error: '至少需要 5 笔已平仓交易才能跑蒙特卡洛模拟' };
    }
    const pnls = closed.map(p => p.pnlUsd!);
    const currentEquity = portfolio.startingBalance + pnls.reduce((s, v) => s + v, 0);
    if (!Number.isFinite(currentEquity) || currentEquity <= 0 || pnls.some(value => !Number.isFinite(value))) return { error: '权益或历史盈亏无效，无法计算收益分布' };
    const snapshotHash = createHash('sha256').update(JSON.stringify({ startingBalance: portfolio.startingBalance, trades: closed.map(p => ({ id: p.id, pnlUsd: p.pnlUsd, exitTime: p.exitTime })) })).digest('hex');
    let randomState = seed >>> 0;
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    };
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
        const sampled = pnls[Math.floor(random() * pnls.length)] * scaleFactor;
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
      seed,
      snapshotHash,
      algorithm: 'bootstrap-lcg32-v1',
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
      noteZh: `按历史每笔盈亏有放回抽样，模拟 ${tradesPerSim} 笔交易的最大回撤分布。30% 回撤视为「重创线」。历史压力测试，不是预测。`,
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

class UnifiedPredictionPaperAdapter {
  constructor() { unifiedPaperLedgerStore.migrateLegacyPredictionPortfolio(portfolio); }

  private ledger(): UnifiedPaperLedger {
    const value = unifiedPaperLedgerStore.get() as Partial<UnifiedPaperLedger>;
    return { startingCash: Number(value.startingCash) || 0, cash: Number(value.cash) || 0, positions: Array.isArray(value.positions) ? value.positions : [], orders: Array.isArray(value.orders) ? value.orders : [], realizedPnl: Number(value.realizedPnl) || 0, peakEquity: Number(value.peakEquity) || Number(value.cash) || 0, maxDrawdownPct: Number(value.maxDrawdownPct) || 0 };
  }
  private predictionOrders(): UnifiedPaperOrder[] { return this.ledger().orders.filter(order => order.instrumentType === 'prediction'); }
  private positionId(instrumentId: string, outcome: 'YES' | 'NO'): string { return `${instrumentId}:${outcome}`; }
  private toPosition(position: UnifiedPaperLedger['positions'][number]): PaperPosition {
    const instrumentId = String(position.instrumentId || 'prediction:predictfun:0');
    const parts = instrumentId.split(':');
    const marketId = Number(parts.at(-1));
    const outcomeIndex = position.outcome === 'NO' ? 1 : 0;
    return { id: this.positionId(instrumentId, position.outcome || 'YES'), marketId: Number.isFinite(marketId) ? marketId : 0, marketTitle: position.title || instrumentId, outcomeIndex, outcomeName: position.outcome || 'YES', side: 'BUY', entryPrice: position.averageEntryPrice || 0, currentPrice: position.currentPrice || position.averageEntryPrice || 0, quantity: position.quantity || 0, entryTime: position.openedAt || new Date(0).toISOString(), status: 'OPEN' };
  }
  private closedPositions(): PaperPosition[] {
    return this.predictionOrders().filter(order => order.side === 'SELL' && Number.isFinite(order.pnlUsd)).map(order => {
      const outcome = order.outcome || 'YES';
      const qty = order.quantity;
      const entryPrice = qty > 0 ? order.price - Number(order.pnlUsd) / qty : order.price;
      return { id: this.positionId(order.instrumentId, outcome), marketId: Number(order.instrumentId.split(':').at(-1)) || 0, marketTitle: order.title || order.instrumentId, outcomeIndex: outcome === 'NO' ? 1 : 0, outcomeName: outcome, side: 'BUY', entryPrice, currentPrice: order.price, quantity: qty, entryTime: order.timestamp, exitPrice: order.price, exitTime: order.timestamp, status: 'CLOSED', pnlUsd: Number(order.pnlUsd), pnlPct: entryPrice ? Number(order.pnlUsd) / (entryPrice * qty) * 100 : 0 };
    });
  }
  private allClosedOrders() { return this.ledger().orders.filter(order => order.side === 'SELL' && Number.isFinite(order.pnlUsd)); }

  previewOpen(_marketId: number, price: number, amountUsd: number): { ok: boolean; message: string } {
    const validation = validatePaperOrderInput({ price, amountUsd });
    if (!validation.ok) return { ok: false, message: validation.error || '模拟订单参数无效' };
    const qty = Math.floor(amountUsd / price);
    if (qty <= 0) return { ok: false, message: '金额低于该价格可交易的最小数量' };
    if (amountUsd > calculateUnifiedPerformance(this.ledger()).cash) return { ok: false, message: '模拟余额不足' };
    return { ok: true, message: '模拟订单参数有效' };
  }
  getPortfolio(): PaperPortfolio & { openPositionsValue: number; equity: number; unrealizedPnl: number; winRate: number } {
    const performance = calculateUnifiedPerformance(this.ledger());
    const closed = this.closedPositions();
    const positions = this.ledger().positions.filter(position => position.instrumentType === 'prediction').map(position => this.toPosition(position));
    const tradeLog = this.predictionOrders().map(order => ({ id: order.id || '', marketId: Number(order.instrumentId.split(':').at(-1)) || 0, marketTitle: order.title || order.instrumentId, action: order.side === 'SELL' ? 'SELL' : 'BUY', outcomeName: order.outcome || order.side, price: order.price, quantity: order.quantity, timestamp: order.timestamp, reason: order.reason || '' }));
    return { startingBalance: this.ledger().startingCash, cashBalance: performance.cash, positions: [...positions, ...closed], tradeLog, totalPnl: performance.totalPnl, winsCount: closed.filter(item => (item.pnlUsd || 0) > 0).length, lossesCount: closed.filter(item => (item.pnlUsd || 0) < 0).length, maxDrawdownPct: performance.maxDrawdownPct, peakEquity: this.ledger().peakEquity, openPositionsValue: performance.equity - performance.cash, equity: performance.equity, unrealizedPnl: performance.unrealizedPnl, winRate: closed.length ? closed.filter(item => (item.pnlUsd || 0) > 0).length / closed.length : 0 };
  }
  getRiskMetrics() {
    const pnls = this.allClosedOrders().map(order => Number(order.pnlUsd));
    const wins = pnls.filter(value => value > 0); const losses = pnls.filter(value => value < 0);
    const mean = pnls.length ? pnls.reduce((sum, value) => sum + value, 0) / pnls.length : 0;
    const variance = pnls.length > 1 ? pnls.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (pnls.length - 1) : 0;
    return { totalTrades: pnls.length, winRate: pnls.length ? wins.length / pnls.length : 0, profitFactor: losses.length ? Math.min(99, Math.abs(wins.reduce((s, v) => s + v, 0) / losses.reduce((s, v) => s + v, 0))) : wins.length ? 99 : 0, expectancyUsd: mean, sharpeRatio: variance > 0 ? mean / Math.sqrt(variance) : 0, var95Usd: pnls.length ? [...pnls].sort((a, b) => a - b)[Math.floor(pnls.length * 0.05)] : 0, avgWinUsd: wins.length ? wins.reduce((s, v) => s + v, 0) / wins.length : 0, avgLossUsd: losses.length ? Math.abs(losses.reduce((s, v) => s + v, 0) / losses.length) : 0, payoffRatio: wins.length && losses.length ? wins.reduce((s, v) => s + v, 0) / wins.length / Math.abs(losses.reduce((s, v) => s + v, 0) / losses.length) : 0, maxDrawdownPct: this.ledger().maxDrawdownPct, bestTradeUsd: pnls.length ? Math.max(...pnls) : 0, worstTradeUsd: pnls.length ? Math.min(...pnls) : 0, equityCurve: [] };
  }
  reset(startingBalance = 1000): PaperPortfolio { unifiedPaperLedgerStore.reset(startingBalance); return this.getPortfolio(); }
  runMonteCarlo(simulations = 2000, tradesPerSim = 20, seed = 42) { return runUnifiedMonteCarlo(this.allClosedOrders().map(order => Number(order.pnlUsd)), this.ledger().startingCash, simulations, tradesPerSim, seed); }
  openPosition(marketId: number, marketTitle: string, outcomeIndex: 0 | 1, outcomeName: string, price: number, amountUsd: number, reason = ''): { success: boolean; message: string; position?: PaperPosition } {
    const preview = this.previewOpen(marketId, price, amountUsd); if (!preview.ok) return { success: false, message: preview.message };
    const quantity = Math.floor(amountUsd / price); const outcome = outcomeIndex === 0 ? 'YES' : 'NO';
    try { const ledger = unifiedPaperLedgerStore.apply({ id: `prediction:${marketId}:${outcome}:${Date.now()}`, instrumentId: `prediction:predictfun:${marketId}`, instrumentType: 'prediction', title: marketTitle, side: outcome, outcome, price, quantity, timestamp: new Date().toISOString(), reason }); const position = ledger.positions.find(item => item.instrumentId.endsWith(`:${marketId}`) && item.outcome === outcome); return { success: true, message: `已开仓 ${outcomeName} × ${quantity} @ $${price.toFixed(4)}`, position: position ? this.toPosition(position) : undefined }; } catch (error: any) { return { success: false, message: error?.message || '模拟撮合失败' }; }
  }
  closePosition(positionId: string, exitPrice: number): { success: boolean; message: string; pnl?: number } {
    const match = String(positionId).match(/^(prediction:[^:]+:\d+):(YES|NO)$/); if (!match) return { success: false, message: '持仓标识无效' };
    const position = this.ledger().positions.find(item => item.instrumentId === match[1] && item.outcome === match[2]); if (!position) return { success: false, message: '未找到持仓，或已平仓' };
    try { const ledger = unifiedPaperLedgerStore.apply({ id: `prediction:close:${Date.now()}`, instrumentId: position.instrumentId, instrumentType: 'prediction', title: position.title, side: 'SELL', outcome: match[2] as 'YES' | 'NO', price: exitPrice, quantity: position.quantity, timestamp: new Date().toISOString(), reason: '平仓' }); const order = ledger.orders[0]; return { success: true, message: `已平仓 ${match[2]} | 盈亏: ${(order.pnlUsd || 0) >= 0 ? '+' : ''}$${(order.pnlUsd || 0).toFixed(2)}`, pnl: order.pnlUsd }; } catch (error: any) { return { success: false, message: error?.message || '平仓失败' }; }
  }
  markToMarket(currentPrices: Map<number, { yesPrice: number; noPrice: number }>): void { const prices = new Map<string, number>(); for (const position of this.ledger().positions.filter(item => item.instrumentType === 'prediction')) { const value = currentPrices.get(Number(position.instrumentId.split(':').at(-1))); const price = position.outcome === 'NO' ? value?.noPrice : value?.yesPrice; if (price != null) prices.set(position.instrumentId + ':' + position.outcome, price); } unifiedPaperLedgerStore.markPrices(prices); }
  checkStopLossTakeProfit(currentPrices: Map<number, { yesPrice: number; noPrice: number }>): string[] { const messages: string[] = []; for (const position of this.getOpenPositions()) { const value = currentPrices.get(position.marketId); const price = position.outcomeIndex === 1 ? value?.noPrice : value?.yesPrice; if (!price) continue; const change = (price - position.entryPrice) / position.entryPrice * 100; if (change <= -15 || change >= 50) { const result = this.closePosition(position.id, price); messages.push(`${change <= -15 ? '🛑 止损' : '🎯 止盈'}：${position.outcomeName} | ${result.message}`); } } return messages; }
  getOpenPositions(): PaperPosition[] { return this.ledger().positions.filter(item => item.instrumentType === 'prediction').map(item => this.toPosition(item)); }
  getClosedPositions(): PaperPosition[] { return this.closedPositions().slice(-20).reverse(); }
  getRecentTrades(count = 20): PaperTradeLog[] { return this.getPortfolio().tradeLog.slice(0, count); }
}

export function runUnifiedMonteCarlo(pnls: number[], startingBalance: number, simulations: number, tradesPerSim: number, seed: number): any {
  if (pnls.length < 5) return { error: '至少需要 5 笔已平仓交易才能跑蒙特卡洛模拟' };
  if (!Number.isInteger(simulations) || simulations < 1 || simulations > 10000 || !Number.isInteger(tradesPerSim) || tradesPerSim < 1 || tradesPerSim > 100 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return { error: '模拟参数无效' };
  let state = seed >>> 0; const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const equity = startingBalance + pnls.reduce((sum, value) => sum + value, 0); const dd: number[] = []; const returns: number[] = [];
  for (let i = 0; i < simulations; i++) { let current = equity; let peak = equity; let max = 0; for (let j = 0; j < tradesPerSim; j++) { current += pnls[Math.floor(random() * pnls.length)]; peak = Math.max(peak, current); max = Math.max(max, peak ? (peak - current) / peak * 100 : 0); } dd.push(max); returns.push((current / equity - 1) * 100); }
  const percentile = (values: number[], ratio: number) => values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * ratio))] || 0;
  return { seed, snapshotHash: createHash('sha256').update(JSON.stringify({ startingBalance, pnls })).digest('hex'), algorithm: 'bootstrap-lcg32-v1', simulations, tradesPerSim, sampleTrades: pnls.length, currentEquityUsd: equity, maxDrawdownP5Pct: percentile(dd, .05), maxDrawdownP50Pct: percentile(dd, .5), maxDrawdownP95Pct: percentile(dd, .95), finalReturnP5Pct: percentile(returns, .05), finalReturnP50Pct: percentile(returns, .5), finalReturnP95Pct: percentile(returns, .95), ruinProbabilityPct: dd.filter(value => value >= 30).length / simulations * 100, noteZh: `按历史每笔盈亏有放回抽样，模拟 ${tradesPerSim} 笔交易的最大回撤分布。历史压力测试，不是预测。` };
}

export const paperEngine = new UnifiedPredictionPaperAdapter();

