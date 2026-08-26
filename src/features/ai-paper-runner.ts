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

export type AiRunnerVenue = 'Binance' | 'Predict.fun';
export type AiRunnerStatus = 'RUNNING' | 'STOPPED';

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
}

const RUNNERS_FILE = path.join(DATA_ROOT, 'ai-paper-runners.json');
const MAX_RUNNERS = 10;
const MAX_TRADES_PER_RUNNER = 200;

function loadRunners(): AiRunner[] {
  ensureDir(DATA_ROOT);
  try {
    const parsed = JSON.parse(fs.readFileSync(RUNNERS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveRunners(runners: AiRunner[]): void {
  ensureDir(DATA_ROOT);
  fs.writeFileSync(RUNNERS_FILE, JSON.stringify(runners, null, 2));
}

export function createAiRunner(
  venue: AiRunnerVenue,
  symbolOrMarketId: string,
  title: string,
  budgetUsd: number,
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
  };
  runners.unshift(runner);
  saveRunners(runners);
  return runner;
}

export function stopAiRunner(id: string): AiRunner | null {
  const runners = loadRunners();
  const runner = runners.find(r => r.id === id);
  if (!runner || runner.status === 'STOPPED') return null;
  runner.status = 'STOPPED';
  runner.stoppedAt = new Date().toISOString();
  saveRunners(runners);
  return runner;
}

export function getAiRunners(): AiRunner[] {
  return loadRunners();
}

function updateRunner(id: string, fn: (r: AiRunner) => void): AiRunner | null {
  const runners = loadRunners();
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
    const cost = entryPrice * quantity;
    if (cost > r.cashUsd) return;
    r.cashUsd -= cost;
    r.positions.push({
      id: `rp_${Date.now()}`,
      entryPrice,
      quantity,
      entryTime: new Date().toISOString(),
      status: 'OPEN',
    });
    r.trades.unshift({ id: `rt_${Date.now()}`, action: 'BUY', side: side as any, price: entryPrice, quantity, reasonZh, timestamp: new Date().toISOString() });
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
    r.trades.unshift({
      id: `rt_${Date.now()}`, action: 'SELL',
      price: exitPrice, quantity: pos.quantity,
      reasonZh: `${reasonZh} | 盈亏 ${pnl! >= 0 ? '+' : ''}$${pnl!.toFixed(2)}`,
      timestamp: new Date().toISOString(),
    });
  });
  return pnl;
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
