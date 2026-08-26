/**
 * Cross-asset correlation and drawdown radar.
 *
 * The point is not to predict every market; it is to answer a practical
 * portfolio question: are the assets users actually hold moving together,
 * and how much pain is already embedded in recent prices?
 */

import { binanceFeed } from './binance';

export type CrossAssetGroup = 'crypto' | 'equity' | 'gold' | 'bond' | 'credit';

export interface CrossAssetCorrelationRow {
  id: string;
  symbol: string;
  nameZh: string;
  group: CrossAssetGroup;
  current: number;
  change20dPct: number;
  change60dPct: number;
  drawdown90dPct: number;
  volatility30AnnualizedPct: number;
  correlation30dToEquity: number;
  beta30dToEquity: number;
  state: 'normal' | 'correction' | 'deep-drawdown' | 'high-volatility' | 'highly-correlated';
  stateZh: string;
  adviceZh: string;
}

export interface CrossAssetCorrelationResult {
  generatedAt: string;
  asOfAt: string;
  sources: string[];
  benchmarkSymbol: 'SPY';
  returnWindowDays: 30;
  rows: CrossAssetCorrelationRow[];
  averageCryptoEquityCorrelation: number;
  defensiveHedgeStrengthPct: number;
  deepDrawdownCount: number;
  highStressCount: number;
  diversificationScore: number;
  signal: 'diversified' | 'mixed' | 'concentrated';
  signalZh: string;
  summaryZh: string;
  advisorBiasZh: string;
  regimeBoost: number;
}

interface PriceBar {
  time: number;
  close: number;
}

interface CorrelationInput {
  target: { id: string; symbol: string; nameZh: string; group: CrossAssetGroup };
  bars: PriceBar[];
}

interface NasdaqHistoricalPayload {
  data?: {
    tradesTable?: {
      rows?: Array<{
        date?: string;
        close?: string;
      }>;
    };
  };
}

const CACHE_TTL_MS = 15 * 60_000;
let cache: { ts: number; value: CrossAssetCorrelationResult } | null = null;

const ETF_TARGETS: Array<{ symbol: string; nameZh: string; group: Exclude<CrossAssetGroup, 'crypto'> }> = [
  { symbol: 'SPY', nameZh: '标普500 ETF', group: 'equity' },
  { symbol: 'QQQ', nameZh: '纳指100 ETF', group: 'equity' },
  { symbol: 'GLD', nameZh: '黄金 ETF', group: 'gold' },
  { symbol: 'TLT', nameZh: '20+年美债 ETF', group: 'bond' },
  { symbol: 'HYG', nameZh: '高收益信用 ETF', group: 'credit' },
];

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Number.isFinite(value) ? Math.round(value * factor) / factor : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cleanBars(bars: PriceBar[]): PriceBar[] {
  const byDay = new Map<number, number>();
  for (const bar of bars) {
    const day = Math.floor(bar.time / 86_400_000);
    if (day > 0 && Number.isFinite(bar.close) && bar.close > 0) {
      byDay.set(day, bar.close);
    }
  }
  return [...byDay.entries()]
    .map(([day, close]) => ({ time: day * 86_400_000, close }))
    .sort((a, b) => a.time - b.time);
}

async function fetchNasdaqEtfHistory(symbol: string): Promise<PriceBar[]> {
  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - 240 * 86_400_000).toISOString().slice(0, 10);
  const query = new URLSearchParams({
    assetclass: 'etf',
    fromdate: fromDate,
    todate: toDate,
    limit: '120',
  });
  const response = await fetch(
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?${query}`,
    {
      headers: {
        Accept: 'application/json',
        Referer: 'https://www.nasdaq.com/',
        'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0',
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error(`Nasdaq ${symbol} HTTP ${response.status}`);
  const payload = await response.json() as NasdaqHistoricalPayload;
  const bars = cleanBars((payload.data?.tradesTable?.rows || []).map(row => ({
    // MM/DD/YYYY parsing through Date is unreliable on some locales.
    time: (() => {
      const parts = String(row.date || '').split('/').map(Number);
      return parts.length === 3 ? Date.UTC(parts[2], parts[0] - 1, parts[1]) : NaN;
    })(),
    close: Number(String(row.close || '').replace(/,/g, '')),
  })));
  if (bars.length < 70) throw new Error(`Nasdaq ${symbol} history too short`);
  return bars;
}

async function fetchBinanceHistory(symbol: string): Promise<PriceBar[]> {
  const raw = await binanceFeed.getKlines(symbol, '1d', 120);
  const bars = cleanBars(raw.map(item => ({
    time: Number(item.time),
    close: Number(item.close),
  })));
  if (bars.length < 70) throw new Error(`Binance ${symbol} history too short`);
  return bars;
}

function dailyReturns(bars: PriceBar[]): Map<number, number> {
  const values = new Map<number, number>();
  for (let i = 1; i < bars.length; i++) {
    values.set(bars[i].time, (bars[i].close - bars[i - 1].close) / bars[i - 1].close);
  }
  return values;
}

function alignedReturns(
  left: Map<number, number>,
  right: Map<number, number>,
  windowDays: number,
): { left: number[]; right: number[] } {
  const days = [...left.keys()].filter(day => right.has(day)).sort((a, b) => a - b).slice(-windowDays);
  return {
    left: days.map(day => left.get(day)!),
    right: days.map(day => right.get(day)!),
  };
}

function correlation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 20) return 0;
  const meanA = left.reduce((sum, value) => sum + value, 0) / left.length;
  const meanB = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < left.length; i++) {
    const deltaA = left[i] - meanA;
    const deltaB = right[i] - meanB;
    covariance += deltaA * deltaB;
    varianceA += deltaA * deltaA;
    varianceB += deltaB * deltaB;
  }
  if (!varianceA || !varianceB) return 0;
  return clamp(covariance / Math.sqrt(varianceA * varianceB), -1, 1);
}

function beta(asset: number[], benchmark: number[]): number {
  if (asset.length !== benchmark.length || asset.length < 20) return 0;
  const meanA = asset.reduce((sum, value) => sum + value, 0) / asset.length;
  const meanB = benchmark.reduce((sum, value) => sum + value, 0) / benchmark.length;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < asset.length; i++) {
    covariance += (asset[i] - meanA) * (benchmark[i] - meanB);
    variance += (benchmark[i] - meanB) ** 2;
  }
  return variance ? clamp(covariance / variance, -5, 5) : 0;
}

function annualizedVolatility(returns: number[]): number {
  if (returns.length < 20) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function changeFromDaysAgo(bars: PriceBar[], days: number): number {
  if (!bars.length) return 0;
  const latest = bars[bars.length - 1];
  const cutoff = latest.time - days * 86_400_000;
  let previous: PriceBar | null = null;
  for (const bar of bars) {
    if (bar.time <= cutoff) previous = bar;
    else break;
  }
  if (!previous) previous = bars[0];
  return previous.close > 0 ? (latest.close - previous.close) / previous.close * 100 : 0;
}

function drawdownFromRecentHigh(bars: PriceBar[], lookbackDays = 90): number {
  if (!bars.length) return 0;
  const latest = bars[bars.length - 1];
  const cutoff = latest.time - lookbackDays * 86_400_000;
  const highs = bars.filter(bar => bar.time >= cutoff).map(bar => bar.close);
  const high = highs.length ? Math.max(...highs) : latest.close;
  return high > 0 ? (latest.close - high) / high * 100 : 0;
}

function rowStateAndAdvice(row: Omit<CrossAssetCorrelationRow, 'state' | 'stateZh' | 'adviceZh'>)
  : Pick<CrossAssetCorrelationRow, 'state' | 'stateZh' | 'adviceZh'> {
  if (row.drawdown90dPct <= -20) {
    return {
      state: 'deep-drawdown',
      stateZh: '深度回撤',
      adviceZh: '不要因为便宜就马上重仓；等止跌结构出现，再用小仓位分批试错。',
    };
  }
  if (row.volatility30AnnualizedPct >= 45) {
    return {
      state: 'high-volatility',
      stateZh: '高波动',
      adviceZh: '价格噪音放大，止损距离和仓位要重新计算，避免单笔风险过高。',
    };
  }
  if (Math.abs(row.correlation30dToEquity) >= 0.65 && row.group === 'crypto') {
    return {
      state: 'highly-correlated',
      stateZh: '与美股高度联动',
      adviceZh: '它当前更像风险资产而不是独立对冲；股票回调时大概率难以独善其身。',
    };
  }
  if (row.drawdown90dPct <= -10) {
    return {
      state: 'correction',
      stateZh: '中期回撤',
      adviceZh: '趋势压力仍在，优先观察能否收复关键均线，不抢第一根反弹。',
    };
  }
  return {
    state: 'normal',
    stateZh: '状态正常',
    adviceZh: '回撤和波动可控，可按各自技术信号执行，不需要额外恐慌。',
  };
}

function buildRow(
  target: { id: string; symbol: string; nameZh: string; group: CrossAssetGroup },
  bars: PriceBar[],
  equityReturns: Map<number, number>,
): CrossAssetCorrelationRow {
  const base = {
    id: target.id,
    symbol: target.symbol,
    nameZh: target.nameZh,
    group: target.group,
    current: round(bars[bars.length - 1].close, target.group === 'crypto' ? 2 : 2),
    change20dPct: round(changeFromDaysAgo(bars, 20)),
    change60dPct: round(changeFromDaysAgo(bars, 60)),
    drawdown90dPct: round(drawdownFromRecentHigh(bars)),
    volatility30AnnualizedPct: round(annualizedVolatility(
      alignedReturns(dailyReturns(bars), dailyReturns(bars), 30).left,
    )),
    correlation30dToEquity: round(correlation(
      ...(() => {
        const pair = alignedReturns(dailyReturns(bars), equityReturns, 30);
        return [pair.left, pair.right] as const;
      })(),
    ), 2),
    beta30dToEquity: round(beta(
      ...(() => {
        const pair = alignedReturns(dailyReturns(bars), equityReturns, 30);
        return [pair.left, pair.right] as const;
      })(),
    ), 2),
  };
  return { ...base, ...rowStateAndAdvice(base) };
}

export async function getCrossAssetCorrelationRadar(): Promise<CrossAssetCorrelationResult> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const requests: Array<Promise<CorrelationInput>> = [
    ...ETF_TARGETS.map(async target => ({ target: { ...target, id: `etf-${target.symbol.toLowerCase()}` }, bars: await fetchNasdaqEtfHistory(target.symbol) })),
    Promise.resolve({ target: { id: 'btc', symbol: 'BTC', nameZh: '比特币', group: 'crypto' as const }, bars: await fetchBinanceHistory('BTCUSDT') }),
    Promise.resolve({ target: { id: 'eth', symbol: 'ETH', nameZh: '以太坊', group: 'crypto' as const }, bars: await fetchBinanceHistory('ETHUSDT') }),
  ];
  const results = await Promise.allSettled(requests);

  const fulfilled = results
    .filter((result): result is PromiseFulfilledResult<CorrelationInput> => result.status === 'fulfilled')
    .map(result => result.value);
  const spy = fulfilled.find(item => item.target.symbol === 'SPY');
  if (!spy || fulfilled.length < 6 || !fulfilled.some(item => item.target.symbol === 'BTC')) {
    const reason = results.find(result => result.status === 'rejected');
    throw new Error(reason && reason.status === 'rejected'
      ? reason.reason instanceof Error ? reason.reason.message : '跨资产数据不足'
      : '跨资产历史数据不足');
  }

  const equityReturns = dailyReturns(spy.bars);
  const rows = fulfilled
    .map(item => buildRow(item.target, item.bars, equityReturns))
    .sort((a, b) => {
      const order: CrossAssetGroup[] = ['crypto', 'equity', 'gold', 'bond', 'credit'];
      return order.indexOf(a.group) - order.indexOf(b.group) || a.symbol.localeCompare(b.symbol);
    });

  const cryptoRows = rows.filter(row => row.group === 'crypto');
  const defensiveRows = rows.filter(row => row.group === 'gold' || row.group === 'bond');
  const averageCryptoEquityCorrelation = cryptoRows.length
    ? cryptoRows.reduce((sum, row) => sum + row.correlation30dToEquity, 0) / cryptoRows.length
    : 0;
  const defensiveHedgeStrengthPct = defensiveRows.length
    ? clamp(defensiveRows.reduce((sum, row) => sum + Math.max(0, -row.correlation30dToEquity), 0)
      / defensiveRows.length * 100, 0, 100)
    : 0;
  const deepDrawdownCount = rows.filter(row => row.state === 'deep-drawdown').length;
  const highStressCount = rows.filter(row => row.state === 'deep-drawdown' || row.state === 'high-volatility').length;

  const averageDrawdownPain = rows.reduce((sum, row) => sum + Math.max(0, -row.drawdown90dPct), 0) / rows.length;
  const rawScore = 58
    - Math.max(0, averageCryptoEquityCorrelation) * 38
    - averageDrawdownPain * 1.15
    - highStressCount * 5
    + defensiveHedgeStrengthPct * 0.12;
  const diversificationScore = round(clamp(rawScore, 0, 100), 1);
  const regimeBoost = round(clamp((diversificationScore - 50) * 0.08, -4, 4), 2);

  const signal: CrossAssetCorrelationResult['signal'] = diversificationScore >= 62
    ? 'diversified'
    : diversificationScore >= 42
      ? 'mixed'
      : 'concentrated';
  const signalZh = signal === 'diversified'
    ? '跨资产分散度较好'
    : signal === 'mixed'
      ? '跨资产联动混合'
      : '跨资产同涨同跌风险偏高';
  const advisorBiasZh = signal === 'diversified'
    ? '组合背景较分散，可以按信号执行，但仍要控制单笔风险。'
    : signal === 'mixed'
      ? '部分资产开始同向波动，新仓优先选择互补资产，避免重复暴露。'
      : '多类资产一起承压或联动过强，降低总仓位比挑选单个标的更重要。';

  const correlatedNames = cryptoRows
    .filter(row => row.state === 'highly-correlated')
    .map(row => row.nameZh);
  const painfulNames = rows
    .filter(row => row.state === 'deep-drawdown' || row.state === 'high-volatility')
    .map(row => row.state === 'high-volatility'
      ? `${row.nameZh}（年化波动 ${row.volatility30AnnualizedPct}%）`
      : `${row.nameZh}（回撤 ${row.drawdown90dPct}%）`)
    .slice(0, 3);
  const summaryZh = `BTC/ETH 与标普30日相关均值 ${round(averageCryptoEquityCorrelation, 2)}；` +
    `${deepDrawdownCount} 个资产深度回撤，${highStressCount} 个资产处于高压力；防御对冲强度 ${round(defensiveHedgeStrengthPct, 0)}%。` +
    (painfulNames.length ? `重点压力：${painfulNames.join('、')}。` : '') +
    (correlatedNames.length ? `${correlatedNames.join('、')}与美股高度联动。` : '');

  const latestTime = Math.max(...fulfilled.map(item => item.bars[item.bars.length - 1].time));
  const value: CrossAssetCorrelationResult = {
    generatedAt: new Date().toISOString(),
    asOfAt: new Date(latestTime).toISOString(),
    sources: [
      'Binance public daily klines',
      'Nasdaq public ETF daily history',
    ],
    benchmarkSymbol: 'SPY',
    returnWindowDays: 30,
    rows,
    averageCryptoEquityCorrelation: round(averageCryptoEquityCorrelation, 2),
    defensiveHedgeStrengthPct: round(defensiveHedgeStrengthPct, 1),
    deepDrawdownCount,
    highStressCount,
    diversificationScore,
    signal,
    signalZh,
    summaryZh,
    advisorBiasZh,
    regimeBoost,
  };
  cache = { ts: Date.now(), value };
  return value;
}
