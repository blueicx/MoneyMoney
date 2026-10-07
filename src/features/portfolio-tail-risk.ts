import type { PortfolioRow } from './decision-intelligence';

interface RiskOptions { asOf?: string; confidence?: number; minimumSamples?: number }
const finite = (value: number) => Number.isFinite(value);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Historical one-day loss distribution for current fixed weights, NOT a forecast or an account backtest. */
export function portfolioTailRisk(rows: PortfolioRow[], options: RiskOptions = {}) {
  const asOf = options.asOf || new Date().toISOString();
  const confidence = options.confidence ?? 0.95;
  const minimumSamples = options.minimumSamples ?? 60;
  if (!finite(Date.parse(asOf))) throw new Error('风险时点无效');
  if (!finite(confidence) || confidence < 0.9 || confidence > 0.99) throw new Error('置信水平须为 0.90–0.99');
  if (!Number.isInteger(minimumSamples) || minimumSamples < 60 || minimumSamples > 1000) throw new Error('最少样本须为 60–1000');
  const unavailable = (reason: string, samples = 0) => ({
    dataStatus: 'unavailable' as const, reason, confidence, samples, currency: null as string | null,
    varPct: null as number | null, expectedShortfallPct: null as number | null,
    varAmount: null as number | null, expectedShortfallAmount: null as number | null,
    windowStart: null as string | null, windowEnd: null as string | null,
    tailSamples: 0, instruments: rows.map(row => row.instrument), covariance: [] as number[][],
    correlations: [] as Array<Array<number | null>>, windows: null as ReturnType<typeof windows> | null,
    warnings: [reason], asOf, executionEnabled: false as const,
    method: 'historical-fixed-current-weights-1d', disclaimer: '历史统计，不是价格预测；当前仓位权重不代表历史账户收益。',
  });
  if (!rows.length) return unavailable('所选账户暂无仓位');
  const market = rows[0].market;
  const prefixes = { stocks: 'stock', crypto: 'crypto', options: 'option', prediction: 'prediction' };
  for (const row of rows) {
    if (!row.instrument.includes(':')) return unavailable('旧记录未绑定规范标的身份，未猜测市场或交易场所');
    if (row.market !== market || !row.instrument.startsWith(prefixes[row.market] + ':')) throw new Error('风险仓位市场或标的身份不一致');
    if (![row.quantity, row.price, row.quantity * row.price].every(finite) || row.quantity <= 0 || row.price <= 0) throw new Error('仓位估值无效');
  }
  if (!['stocks', 'crypto'].includes(market)) return unavailable('期权/预测合约需要非线性估值与可靠历史，未套用股票风险模型');
  const currencies = new Set(rows.map(row => row.currency));
  if (currencies.size !== 1 || !/^[A-Z]{3,8}$/.test(rows[0].currency) || rows[0].currency === 'UNKNOWN') return unavailable('缺少核验汇率或币种，不同币种不合并计算风险');
  if (rows.some(row => row.datedReturns?.some(point => !finite(point.value) || point.value < -1))) return unavailable('收益序列存在无效简单收益或未知单位口径，未估计尾部风险；其他组合指标独立展示');
  const cutoff = new Date(asOf).toISOString().slice(0, 10);
  const maps = rows.map(row => {
    const points = new Map<string, number>();
    for (const point of row.datedReturns || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date) || !finite(Date.parse(point.date)) || new Date(point.date).toISOString().slice(0, 10) !== point.date) throw new Error('收益日期无效');
      if (points.has(point.date)) throw new Error('收益日期重复');
      points.set(point.date, point.value);
    }
    return points;
  });
  const dates = [...maps[0].keys()].filter(date => date < cutoff && maps.every(map => map.has(date))).sort();
  if (dates.length < minimumSamples) return unavailable(`日期对齐历史不足：${dates.length}/${minimumSamples} 个完成日，未估计尾部风险`, dates.length);
  const values = rows.map(row => row.quantity * row.price);
  const totalValue = values.reduce((sum, value) => sum + value, 0);
  if (!finite(totalValue)) throw new Error('组合估值溢出');
  const weights = values.map(value => value / totalValue);
  const series = maps.map(map => dates.map(date => map.get(date)!));
  const means = series.map(mean);
  const covariance = series.map((left, i) => series.map((right, j) => left.reduce((sum, value, k) => sum + (value - means[i]) * (right[k] - means[j]), 0) / (dates.length - 1)));
  const correlations = covariance.map((left, i) => left.map((value, j) => {
    const denominator = Math.sqrt(covariance[i][i] * covariance[j][j]);
    return denominator ? Math.max(-1, Math.min(1, value / denominator)) : null;
  }));
  const portfolio = dates.map((_, index) => series.reduce((sum, points, i) => sum + points[index] * weights[i], 0));
  const stats = distribution(portfolio, confidence);
  const warnings = ['当前权重历史风险不是账户收益或预测；未自动创建订单。'];
  if (stats.tailSamples < 5 - 1e-9) warnings.push('尾部样本少于 5 个，ES 不稳定，请积累更多历史。');
  const periodWindows = windows(portfolio, confidence);
  if (!periodWindows.previous) warnings.push('不足 120 个共同完成日，无法比较前后 60 日风险。');
  return { ...unavailable('', dates.length), ...stats, dataStatus: 'historical' as const, reason: null,
    currency: rows[0].currency, varAmount: stats.varPct * totalValue / 100,
    expectedShortfallAmount: stats.expectedShortfallPct * totalValue / 100,
    windowStart: dates[0], windowEnd: dates.at(-1)!, covariance, correlations, windows: periodWindows, warnings };
}

function distribution(returns: number[], confidence: number) {
  const losses = returns.map(value => -value).sort((a, b) => a - b);
  const varPct = Math.max(0, losses[Math.ceil(confidence * losses.length - 1e-9) - 1]) * 100;
  const mass = losses.length * (1 - confidence);
  let remaining = mass, sum = 0;
  for (let i = losses.length - 1; i >= 0 && remaining > 1e-12; i--) {
    const weight = Math.min(1, remaining); sum += losses[i] * weight; remaining -= weight;
  }
  return { varPct, expectedShortfallPct: Math.max(0, sum / mass) * 100, tailSamples: mass };
}
function windows(returns: number[], confidence: number) {
  return { recent: { samples: 60, ...distribution(returns.slice(-60), confidence) },
    previous: returns.length >= 120 ? { samples: 60, ...distribution(returns.slice(-120, -60), confidence) } : null };
}
