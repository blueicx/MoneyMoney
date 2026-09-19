export interface TradeLike { pnl: number; }
export interface BacktestMetrics {
  tradesCount: number;
  totalReturnPct: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  maxDrawdownBars: number;
  recoveryBars: number | null;
  cagrPct?: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  pnlRatio?: number;
  alpha?: number | null;
  alphaReason?: string;
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function calculateBacktestMetrics(input: { startingBalance: number; equityCurve: readonly number[]; trades: readonly TradeLike[], benchmarkReturnPct?: number }): BacktestMetrics {
  if (!Number.isFinite(input.startingBalance) || input.startingBalance <= 0) throw new Error('Starting balance must be positive');
  if (!input.equityCurve.length) return { tradesCount: 0, totalReturnPct: 0, winRatePct: 0, profitFactor: 0, maxDrawdownPct: 0, maxDrawdownBars: 0, recoveryBars: null };
  const winningTrades = input.trades.filter(trade => trade.pnl > 0);
  const losingTrades = input.trades.filter(trade => trade.pnl < 0);
  const wins = winningTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const losses = losingTrades.reduce((sum, trade) => sum + Math.abs(trade.pnl), 0);
  const avgWin = winningTrades.length ? wins / winningTrades.length : 0;
  const avgLoss = losingTrades.length ? losses / losingTrades.length : 0;

  let peak = input.equityCurve[0]; let maxDrawdownPct = 0; let maxDrawdownBars = 0; let drawdownStart = -1; let recoveryBars: number | null = null; let currentDrawdownBars = 0;
  const returns: number[] = [];
  input.equityCurve.forEach((equity, index) => {
    if (index > 0 && input.equityCurve[index - 1] > 0) returns.push((equity - input.equityCurve[index - 1]) / input.equityCurve[index - 1]);
    if (!Number.isFinite(equity)) return;
    if (equity >= peak) {
      if (drawdownStart >= 0 && recoveryBars === null) recoveryBars = index - drawdownStart;
      peak = equity; currentDrawdownBars = 0; drawdownStart = -1;
      return;
    }
    const drawdown = ((equity - peak) / peak) * 100;
    if (drawdownStart < 0) drawdownStart = index;
    currentDrawdownBars += 1;
    if (drawdown < maxDrawdownPct) { maxDrawdownPct = drawdown; maxDrawdownBars = currentDrawdownBars; }
  });

  const totalReturnPct = ((input.equityCurve[input.equityCurve.length - 1] - input.startingBalance) / input.startingBalance) * 100;
  const avgReturn = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdDev = returns.length ? Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length) : 0;
  const downReturns = returns.filter(r => r < 0);
  const downStdDev = downReturns.length ? Math.sqrt(downReturns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / downReturns.length) : 0;

  const annFactor = 252;
  const sharpeRatio = stdDev === 0 ? 0 : (avgReturn * annFactor) / (stdDev * Math.sqrt(annFactor));
  const sortinoRatio = downStdDev === 0 ? 0 : (avgReturn * annFactor) / (downStdDev * Math.sqrt(annFactor));
  const endValue = Math.max(0, input.equityCurve[input.equityCurve.length - 1]);
  const cagrPct = input.equityCurve.length > 1 ? (Math.pow(endValue / input.startingBalance, 252 / input.equityCurve.length) - 1) * 100 : 0;

  const alpha = input.benchmarkReturnPct !== undefined ? round(totalReturnPct - input.benchmarkReturnPct) : null;
  const alphaReason = alpha === null ? 'benchmark unavailable' : undefined;

  return {
    tradesCount: input.trades.length,
    totalReturnPct: round(totalReturnPct),
    winRatePct: round(input.trades.length ? (winningTrades.length / input.trades.length) * 100 : 0),
    profitFactor: round(losses ? wins / losses : wins > 0 ? 999 : 0),
    maxDrawdownPct: round(maxDrawdownPct), maxDrawdownBars, recoveryBars,
    cagrPct: round(cagrPct),
    sharpeRatio: round(sharpeRatio),
    sortinoRatio: round(sortinoRatio),
    pnlRatio: round(avgLoss ? avgWin / avgLoss : avgWin > 0 ? 999 : 0),
    alpha,
    ...(alphaReason ? { alphaReason } : {})
  } as BacktestMetrics;
}

export interface WalkForwardFold { trainStart: number; trainEnd: number; testStart: number; testEnd: number; }
export function createWalkForwardFolds(input: { length: number; trainSize: number; testSize: number; step?: number; purge?: number; embargo?: number }): WalkForwardFold[] {
  const length = Math.floor(input.length); const trainSize = Math.floor(input.trainSize); const testSize = Math.floor(input.testSize);
  const step = Math.max(1, Math.floor(input.step ?? testSize)); const purge = Math.max(0, Math.floor(input.purge ?? 0)); const embargo = Math.max(0, Math.floor(input.embargo ?? 0));
  if (length <= 0 || trainSize <= 0 || testSize <= 0) return [];
  const folds: WalkForwardFold[] = [];
  for (let trainStart = 0; ; trainStart += step) {
    const trainEnd = trainStart + trainSize - 1; const testStart = trainEnd + purge + embargo + 1; const testEnd = testStart + testSize - 1;
    if (testEnd >= length) break;
    folds.push({ trainStart, trainEnd, testStart, testEnd });
  }
  return folds;
}

export interface ParameterResult { market: string; parameters: Record<string, number | string | boolean>; score: number; }
export function compareParameterGrid(input: { market: string; parameters: Record<string, readonly (number | string | boolean)[]>; evaluate: (parameters: Record<string, number | string | boolean>) => number }): ParameterResult[] {
  if (!input.market?.trim()) throw new Error('Market is required');
  const keys = Object.keys(input.parameters);
  const rows: ParameterResult[] = [];
  const visit = (index: number, parameters: Record<string, number | string | boolean>) => {
    if (index >= keys.length) { rows.push({ market: input.market, parameters: { ...parameters }, score: Number(input.evaluate({ ...parameters })) || 0 }); return; }
    for (const value of input.parameters[keys[index]] || []) visit(index + 1, { ...parameters, [keys[index]]: value });
  };
  visit(0, {});
  return rows.sort((left, right) => right.score - left.score || JSON.stringify(left.parameters).localeCompare(JSON.stringify(right.parameters)));
}
