export interface FactorQuantile { quantile: number; count: number; averageReturn: number; }
export interface FactorAnalysis { market: string; factorId: string; rankIc: number; ir: number; stability: number; quantiles: FactorQuantile[]; }

function rank(values: readonly number[]): number[] {
  return values.map(value => values.filter(other => other < value).length + 1);
}

function correlation(left: readonly number[], right: readonly number[]): number {
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const leftMean = mean(left), rightMean = mean(right);
  const numerator = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0);
  const denominator = Math.sqrt(left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0) * right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0));
  return denominator ? numerator / denominator : 0;
}

export function analyzeFactor(input: { market: string; factorId: string; values: readonly number[]; forwardReturns: readonly number[]; quantiles?: number }): FactorAnalysis {
  if (!input.market?.trim() || !input.factorId?.trim()) throw new Error('Factor market and id are required');
  if (!input.values.length || input.values.length !== input.forwardReturns.length) throw new Error('Factor and return samples must have the same length');
  if ([...input.values, ...input.forwardReturns].some(value => !Number.isFinite(value))) throw new Error('Factor samples must be finite');
  const quantileCount = Math.max(2, Math.min(input.values.length, Math.floor(input.quantiles ?? 5)));
  const rankIc = correlation(rank(input.values), rank(input.forwardReturns));
  const sorted = input.values.map((value, index) => ({ value, forwardReturn: input.forwardReturns[index] })).sort((a, b) => a.value - b.value);
  const quantiles = Array.from({ length: quantileCount }, (_, index) => {
    const start = Math.floor(index * sorted.length / quantileCount); const end = Math.floor((index + 1) * sorted.length / quantileCount); const slice = sorted.slice(start, end);
    return { quantile: index + 1, count: slice.length, averageReturn: slice.length ? slice.reduce((sum, item) => sum + item.forwardReturn, 0) / slice.length : 0 };
  });
  const mean = quantiles.reduce((sum, item) => sum + item.averageReturn, 0) / quantiles.length;
  const deviation = Math.sqrt(quantiles.reduce((sum, item) => sum + (item.averageReturn - mean) ** 2, 0) / quantiles.length);
  const stability = quantiles.length > 1 ? Math.max(-1, Math.min(1, rankIc)) : 0;
  return { market: input.market, factorId: input.factorId, rankIc: Number(rankIc.toFixed(4)), ir: Number((deviation ? rankIc / deviation : 0).toFixed(4)), stability: Number(stability.toFixed(4)), quantiles };
}

export function removeCorrelatedFactors<T extends { id: string; values: readonly number[] }>(factors: readonly T[], threshold = 0.9): T[] {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Correlation threshold must be between 0 and 1');
  const kept: T[] = [];
  factors.forEach(candidate => {
    if (!candidate.values.length || candidate.values.some(value => !Number.isFinite(value))) throw new Error('Factor samples must be finite');
    if (kept.some(item => item.values.length === candidate.values.length && Math.abs(correlation(item.values, candidate.values)) >= threshold)) return;
    kept.push(candidate);
  });
  return kept.map(item => ({ ...item, values: [...item.values] }));
}
