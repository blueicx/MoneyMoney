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
import { DATA_ROOT, ensureDir } from '../utils/paths';
import { stateStore } from '../storage/sqlite-state';

export type AiRunnerVenue = 'Binance' | 'Predict.fun';
export type AiRunnerStatus = 'RUNNING' | 'STOPPED';

export interface AiRunnerPolicy {
  allowedSymbols: string[];
  maxTradeUsd: number;
  maxBudgetUsd: number;
  maxPositions: number;
  maxDailyLossUsd: number;
  maxDrawdownPct: number;
  minFreshnessMs: number;
  cooldownMinutes: number;
}

export interface AiRunnerTrade {
  id: string;
  action: 'BUY' | 'SELL';
  side?: 'YES' | 'NO' | 'LONG' | 'SHORT';
  price: number;
  quantity: number;
  reasonZh: string;
  timestamp: string;
}

export interface AiRunnerPosition {
  id: string;
  entryPrice: number;
  quantity: number;
  entryTime: string;
  exitPrice?: number;
  exitTime?: string;
  pnlUsd?: number;
  status: 'OPEN' | 'CLOSED';
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

function defaultPolicy(budgetUsd: number, symbol: string): AiRunnerPolicy {
  return {
    allowedSymbols: [symbol.toUpperCase()],
    maxTradeUsd: Math.max(1, Math.min(100, budgetUsd * 0.25)),
    maxBudgetUsd: budgetUsd,
    maxPositions: 1,
    maxDailyLossUsd: Math.max(1, budgetUsd * 0.1),
    maxDrawdownPct: 20,
    minFreshnessMs: 120_000,
    cooldownMinutes: 15,
  };
}

function normalizeRunner(runner: AiRunner): AiRunner {
  return {
    ...runner,
    policy: { ...defaultPolicy(runner.budgetUsd, runner.symbolOrMarketId), ...(runner.policy || {}) },
    peakEquityUsd: Number.isFinite(runner.peakEquityUsd) ? runner.peakEquityUsd : runner.budgetUsd,
  };
}

export function evaluateRunnerOpen(runner: AiRunner, cost: number, at = new Date()): { allowed: boolean; reason?: string } {
  const openCount = runner.positions.filter(position => position.status === 'OPEN').length;
  const day = at.toISOString().slice(0, 10);
  const dailyLoss = runner.positions
    .filter(position => position.status === 'CLOSED' && position.exitTime?.slice(0, 10) === day)
    .reduce((sum, position) => sum + Math.min(0, position.pnlUsd || 0), 0);
  const lastActionMs = runner.lastActionAt ? Date.parse(runner.lastActionAt) : 0;
  if (runner.status !== 'RUNNING') return { allowed: false, reason: '策略未运行' };
  if (!Number.isFinite(cost) || cost <= 0) return { allowed: false, reason: '订单金额无效' };
  if (cost > runner.cashUsd) return { allowed: false, reason: '策略可用余额不足' };
  if (cost > runner.policy.maxTradeUsd) return { allowed: false, reason: '超过策略单笔限额' };
  const committedBudget = (runner.trades || [])
    .filter(trade => trade.action === 'BUY')
    .reduce((sum, trade) => sum + Math.max(0, Number(trade.price) * Number(trade.quantity)), 0);
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
): AiRunner {
  const runners = loadRunners();
  if (runners.filter(r => r.status === 'RUNNING').length >= MAX_RUNNERS) {
    throw new Error(`同时最多运行 ${MAX_RUNNERS} 个跑单`);
  }
  const runner: AiRunner = {
    id: `ar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    venue,
    symbolOrMarketId,
    title,
    budgetUsd,
    cashUsd: budgetUsd,
    status: 'RUNNING',
    createdAt: new Date().toISOString(),
    positions: [],
    trades: [],
    policy: { ...defaultPolicy(budgetUsd, String(symbolOrMarketId)), ...(policy || {}) },
    peakEquityUsd: budgetUsd,
    strategyVersion: 'rsi-sma-v1',
  };
  runners.unshift(runner);
  saveRunners(runners);
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

function updateRunner(id: string, fn: (r: AiRunner) => void): AiRunner | null {
  const runners = loadRunners().map(normalizeRunner);
  const runner = runners.find(r => r.id === id);
  if (!runner) return null;
  fn(runner);
  saveRunners(runners);
  return runner;
}

/** Open a position inside a runner's isolated book. */
export function runnerOpenPosition(
  id: string,
  entryPrice: number,
  quantity: number,
  side: string,
  reasonZh: string,
): boolean {
  return updateRunner(id, r => {
    if (r.status !== 'RUNNING') return;
    if (!Number.isFinite(entryPrice) || !Number.isFinite(quantity) || entryPrice <= 0 || quantity <= 0) return;
    const cost = entryPrice * quantity;
    if (!evaluateRunnerOpen(r, cost).allowed) return;
    r.cashUsd -= cost;
    r.positions.push({
      id: `rp_${Date.now()}`,
      entryPrice,
      quantity,
      entryTime: new Date().toISOString(),
      status: 'OPEN',
    });
    r.lastActionAt = new Date().toISOString();
    r.trades.unshift({ id: `rt_${Date.now()}`, action: 'BUY', side: side as any, price: entryPrice, quantity, reasonZh, timestamp: r.lastActionAt });
    if (r.trades.length > MAX_TRADES_PER_RUNNER) r.trades.length = MAX_TRADES_PER_RUNNER;
  }) != null;
}

/** Close a runner's open position at exitPrice; returns realised PnL. */
export function runnerClosePosition(id: string, positionId: string, exitPrice: number, reasonZh: string): number | null {
  let pnl: number | null = null;
  updateRunner(id, r => {
    const pos = r.positions.find(p => p.id === positionId && p.status === 'OPEN');
    if (!pos) return;
    const proceeds = pos.quantity * exitPrice;
    const cost = pos.quantity * pos.entryPrice;
    pnl = parseFloat((proceeds - cost).toFixed(4));
    pos.exitPrice = exitPrice;
    pos.exitTime = new Date().toISOString();
    pos.status = 'CLOSED';
    pos.pnlUsd = pnl;
    r.cashUsd += proceeds;
    r.lastActionAt = new Date().toISOString();
    r.trades.unshift({
      id: `rt_${Date.now()}`, action: 'SELL',
      price: exitPrice, quantity: pos.quantity,
      reasonZh: `${reasonZh} | 盈亏 ${pnl! >= 0 ? '+' : ''}$${pnl!.toFixed(2)}`,
      timestamp: r.lastActionAt,
    });
    const realized = r.positions.filter(item => item.status === 'CLOSED').reduce((sum, item) => sum + (item.pnlUsd || 0), 0);
    const equity = r.cashUsd + r.positions.filter(item => item.status === 'OPEN').reduce((sum, item) => sum + item.entryPrice * item.quantity, 0);
    r.peakEquityUsd = Math.max(r.peakEquityUsd, equity);
    if (r.peakEquityUsd > 0 && ((r.peakEquityUsd - equity) / r.peakEquityUsd) * 100 >= r.policy.maxDrawdownPct) {
      r.status = 'STOPPED';
      r.circuitBreakerReason = `策略回撤超过 ${r.policy.maxDrawdownPct}%`;
    }
    if (realized <= -Math.abs(r.policy.maxDailyLossUsd)) {
      r.status = 'STOPPED';
      r.circuitBreakerReason = `策略单日亏损超过 $${r.policy.maxDailyLossUsd.toFixed(2)}`;
    }
  });
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
    runner.policy = {
      ...runner.policy,
      ...patch,
      allowedSymbols: patch.allowedSymbols?.map(value => String(value).trim().toUpperCase()).filter(Boolean) || runner.policy.allowedSymbols,
      maxTradeUsd: Math.max(1, Number(patch.maxTradeUsd ?? runner.policy.maxTradeUsd)),
      maxBudgetUsd: Math.max(1, Number(patch.maxBudgetUsd ?? runner.policy.maxBudgetUsd)),
      maxPositions: Math.max(1, Math.floor(Number(patch.maxPositions ?? runner.policy.maxPositions))),
      maxDailyLossUsd: Math.max(1, Number(patch.maxDailyLossUsd ?? runner.policy.maxDailyLossUsd)),
      maxDrawdownPct: Math.max(1, Math.min(100, Number(patch.maxDrawdownPct ?? runner.policy.maxDrawdownPct))),
      minFreshnessMs: Math.max(1_000, Number(patch.minFreshnessMs ?? runner.policy.minFreshnessMs)),
      cooldownMinutes: Math.max(0, Math.min(24 * 60, Number(patch.cooldownMinutes ?? runner.policy.cooldownMinutes))),
    };
  });
}

export function resumeAiRunner(id: string): AiRunner | null {
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
  equityUsd: number;
}

export function summarizeRunner(runner: AiRunner, currentPrice?: number): AiRunnerSummary {
  const closed = runner.positions.filter(p => p.status === 'CLOSED');
  const open = runner.positions.find(p => p.status === 'OPEN');
  const realizedPnl = closed.reduce((s, p) => s + (p.pnlUsd || 0), 0);
  const unrealized = open && currentPrice != null
    ? ((currentPrice - open.entryPrice) / open.entryPrice) * 100
    : null;
  const wins = closed.filter(p => (p.pnlUsd || 0) > 0).length;
  const equity = runner.cashUsd + (open ? open.entryPrice * open.quantity : 0);
  return {
    totalPnlUsd: parseFloat((realizedPnl + (open && currentPrice != null ? open.quantity * (currentPrice - open.entryPrice) : 0)).toFixed(2)),
    realizedPnlUsd: Math.round(realizedPnl * 100) / 100,
    unrealizedPct: unrealized != null ? Math.round(unrealized * 100) / 100 : null,
    openPositionQty: open?.quantity ?? 0,
    openEntryPrice: open?.entryPrice ?? null,
    closedCount: closed.length,
    winRatePct: closed.length > 0 ? Math.round(wins / closed.length * 100) : 0,
    equityUsd: Math.round(equity * 100) / 100,
  };
}
