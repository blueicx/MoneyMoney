import { assertMarketContext, type MarketId } from './research-contracts';

export interface FactorQuantile { quantile: number; count: number; averageReturn: number; }
export interface FactorAnalysis { market: string; factorId: string; rankIc: number; ir: number; stability: number; quantiles: FactorQuantile[]; }
export interface FactorCatalogEntry {
  id: string;
  name: string;
  description: string;
  market: MarketId;
  field: string;
  unit: string;
  direction: 'higher-is-better' | 'lower-is-better' | 'contextual';
  source: string;
}

const FACTOR_CATALOG: Record<MarketId, FactorCatalogEntry[]> = {
  stocks: [
    { id: 'momentum_12m', name: '12个月动量', description: '过去 12 个月风险调整后的价格趋势强度。', market: 'stocks', field: 'quote.return12m', unit: '%', direction: 'higher-is-better', source: 'quote/bars' },
    { id: 'earnings_revision', name: '盈利修正', description: '分析师盈利预期相对上一期的修正方向。', market: 'stocks', field: 'fundamentals.earningsRevision', unit: '%', direction: 'higher-is-better', source: 'fundamentals' },
    { id: 'quality_score', name: '基本面质量', description: '盈利质量、杠杆和现金流稳定性的综合研究因子。', market: 'stocks', field: 'fundamentals.qualityScore', unit: 'score', direction: 'higher-is-better', source: 'fundamentals' },
  ],
  options: [
    { id: 'iv_rank', name: '隐含波动率分位', description: '当前隐含波动率在历史区间中的位置。', market: 'options', field: 'options.ivRank', unit: 'score', direction: 'contextual', source: 'optionsChain' },
    { id: 'put_call_ratio', name: 'Put/Call 比率', description: '看跌与看涨成交或持仓的相对强度。', market: 'options', field: 'options.putCallRatio', unit: 'ratio', direction: 'contextual', source: 'optionsChain' },
    { id: 'gamma_exposure', name: 'Gamma 暴露', description: '期权链按执行价聚合后的 Gamma 暴露方向。', market: 'options', field: 'options.gammaExposure', unit: 'USD', direction: 'contextual', source: 'optionsChain' },
  ],
  crypto: [
    { id: 'funding_rate', name: '资金费率', description: '永续合约多空双方定期支付的资金费率。', market: 'crypto', field: 'derivatives.fundingRate', unit: '%', direction: 'contextual', source: 'funding' },
    { id: 'open_interest_change', name: '持仓量变化', description: '未平仓合约数量的变化，用于观察杠杆参与度。', market: 'crypto', field: 'derivatives.openInterestChange', unit: '%', direction: 'contextual', source: 'openInterest' },
    { id: 'orderbook_imbalance', name: '订单簿失衡', description: '买卖盘深度差异，反映可见流动性倾斜。', market: 'crypto', field: 'depth.imbalance', unit: 'ratio', direction: 'contextual', source: 'depth' },
  ],
  prediction: [
    { id: 'implied_probability', name: '隐含概率', description: '由市场价格推导的 YES/NO 事件概率。', market: 'prediction', field: 'quote.impliedProbability', unit: 'probability', direction: 'contextual', source: 'quote' },
    { id: 'market_liquidity', name: '市场流动性', description: '事件市场可成交深度与价差的综合指标。', market: 'prediction', field: 'depth.liquidity', unit: 'USD', direction: 'higher-is-better', source: 'depth' },
    { id: 'settlement_confidence', name: '结算证据置信度', description: '结算来源、规则和证据完整度的研究评分。', market: 'prediction', field: 'settlementEvidence.confidence', unit: 'score', direction: 'higher-is-better', source: 'settlementEvidence' },
  ],
};

export function getFactorCatalog(market: MarketId): FactorCatalogEntry[] {
  assertMarketContext({ market, workspace: 'factor-catalog' });
  return FACTOR_CATALOG[market].map(entry => ({ ...entry }));
}

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
