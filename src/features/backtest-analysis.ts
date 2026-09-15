export interface TradeLike { pnl: number; }
export interface BacktestMetrics {
  tradesCount: number;
  totalReturnPct: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  maxDrawdownBars: number;
  recoveryBars: number | null;
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function calculateBacktestMetrics(input: { startingBalance: number; equityCurve: readonly number[]; trades: readonly TradeLike[] }): BacktestMetrics {
  if (!Number.isFinite(input.startingBalance) || input.startingBalance <= 0) throw new Error('Starting balance must be positive');
  if (!input.equityCurve.length) return { tradesCount: 0, totalReturnPct: 0, winRatePct: 0, profitFactor: 0, maxDrawdownPct: 0, maxDrawdownBars: 0, recoveryBars: null };
  const wins = input.trades.filter(trade => trade.pnl > 0).reduce((sum, trade) => sum + trade.pnl, 0);
  const losses = input.trades.filter(trade => trade.pnl < 0).reduce((sum, trade) => sum + Math.abs(trade.pnl), 0);
  let peak = input.equityCurve[0]; let maxDrawdownPct = 0; let maxDrawdownBars = 0; let drawdownStart = -1; let recoveryBars: number | null = null; let currentDrawdownBars = 0;
  input.equityCurve.forEach((equity, index) => {
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
  return {
    tradesCount: input.trades.length,
    totalReturnPct: round(((input.equityCurve[input.equityCurve.length - 1] - input.startingBalance) / input.startingBalance) * 100),
    winRatePct: round(input.trades.length ? (input.trades.filter(trade => trade.pnl > 0).length / input.trades.length) * 100 : 0),
    profitFactor: round(losses ? wins / losses : wins > 0 ? 999 : 0),
    maxDrawdownPct: round(maxDrawdownPct), maxDrawdownBars, recoveryBars,
  };
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
