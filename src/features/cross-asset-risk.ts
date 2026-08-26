/**
 * Cross-asset risk radar.
 *
 * CBOE's delayed index endpoint is keyless and gives the advisor a global
 * equity/volatility context that crypto-only technicals cannot see.
 */

import { binanceFeed } from './binance';

export interface CrossAssetQuote {
  symbol: string;
  labelZh: string;
  kind: 'index' | 'volatility';
  price: number;
  changePct: number;
}

export interface CrossAssetRisk {
  source: 'CBOE Delayed Index Quotes + Binance Public Data';
  fetchedAt: string;
  quotes: CrossAssetQuote[];
  crypto: Array<{
    symbol: string;
    labelZh: string;
    price: number;
    change24hPct: number;
  }>;
  averageEquityChangePct: number;
  breadthPct: number;
  vixLevel: number;
  vixChangePct: number;
  riskScore: number;
  riskLevel: 'Risk-on' | 'Neutral' | 'Risk-off' | 'Stress';
  riskLevelZh: '偏风险' | '中性' | '避险' | '高压';
  summaryZh: string;
  volatilityTerm?: VolatilityTermStructure;
}

export interface VolatilityTermPoint {
  symbol: string;
  label: string;
  labelZh: string;
  price: number;
  changePct: number;
}

export interface VolatilityTermStructure {
  source: 'CBOE Delayed Volatility Indices';
  points: VolatilityTermPoint[];
  slope9d3m: number;
  ratio9d3m: number;
  shape: 'backwardation' | 'contango' | 'flat';
  shapeZh: '近月高压' | '远月升水' | '期限平稳';
  signalZh: string;
}

interface CacheEntry {
  ts: number;
  value: CrossAssetRisk;
}

const CACHE_TTL_MS = 60_000;
let cache: CacheEntry | null = null;

const INDEX_SYMBOLS: Array<{ symbol: string; labelZh: string; kind: CrossAssetQuote['kind']; termLabel?: string }> = [
  { symbol: '_SPX', labelZh: '标普500', kind: 'index' },
  { symbol: '_NDX', labelZh: '纳指100', kind: 'index' },
  { symbol: '_DJI', labelZh: '道琼斯', kind: 'index' },
  { symbol: '_RUT', labelZh: '罗素2000', kind: 'index' },
  { symbol: '_VIX9D', labelZh: 'VIX 9日', kind: 'volatility', termLabel: '9D' },
  { symbol: '_VIX', labelZh: 'VIX 1月', kind: 'volatility', termLabel: '1M' },
  { symbol: '_VIX3M', labelZh: 'VIX 3月', kind: 'volatility', termLabel: '3M' },
  { symbol: '_VIX6M', labelZh: 'VIX 6月', kind: 'volatility', termLabel: '6M' },
  { symbol: '_VIX1Y', labelZh: 'VIX 12月', kind: 'volatility', termLabel: '12M' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildVolatilityTermStructure(quotes: CrossAssetQuote[]): VolatilityTermStructure | null {
  const bySymbol = new Map(quotes.map(quote => [quote.symbol, quote]));
  const required = ['_VIX9D', '_VIX', '_VIX3M'];
  if (!required.every(symbol => Number.isFinite(bySymbol.get(symbol)?.price))) return null;

  const points: VolatilityTermPoint[] = INDEX_SYMBOLS
    .filter(item => item.kind === 'volatility')
    .map(item => {
      const quote = bySymbol.get(item.symbol)!;
      return {
        symbol: item.symbol,
        label: item.termLabel || item.symbol,
        labelZh: item.labelZh,
        price: quote.price,
        changePct: quote.changePct,
      };
    });

  const vix9d = bySymbol.get('_VIX9D')!.price;
  const vix3m = bySymbol.get('_VIX3M')!.price;
  const slope9d3mPct = vix3m - vix9d;
  const ratio9d3m = vix9d / vix3m;
  const shape: VolatilityTermStructure['shape'] = ratio9d3m >= 1.05
    ? 'backwardation'
    : ratio9d3m <= 0.95
      ? 'contango'
      : 'flat';
  const shapeZh: VolatilityTermStructure['shapeZh'] = shape === 'backwardation'
    ? '近月高压'
    : shape === 'contango'
      ? '远月升水'
      : '期限平稳';
  const signalZh = shape === 'backwardation'
    ? `短期波动率明显高于 3 个月（9D ${round(vix9d, 2)} > 3M ${round(vix3m, 2)}），市场对即时风险定价更重；防守和保护性策略优先。`
    : shape === 'contango'
      ? `3 个月波动率高于短端（3M − 9D = +${round(slope9d3mPct, 2)} 点），即期压力可控但远期保护更贵；收益型策略可观察，仍要控制尾部风险。`
      : `9 日与 3 个月波动率接近（差 ${round(slope9d3mPct, 2)} 点），期限结构未给出额外方向信号。`;

  return {
    source: 'CBOE Delayed Volatility Indices',
    points,
    slope9d3m: round(slope9d3mPct, 3),
    ratio9d3m: round(ratio9d3m, 3),
    shape,
    shapeZh,
    signalZh,
  };
}

async function fetchCboeQuote(symbol: string): Promise<CrossAssetQuote> {
  const response = await fetch(
    `https://cdn.cboe.com/api/global/delayed_quotes/quotes/${encodeURIComponent(symbol)}.json`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new Error(`CBOE ${symbol} HTTP ${response.status}`);
  const payload: any = await response.json();
  const data = payload?.data;
  const price = Number(data?.current_price);
  const changePct = Number(data?.price_change_percent);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(changePct)) {
    throw new Error(`CBOE ${symbol} 数据不完整`);
  }
  const meta = INDEX_SYMBOLS.find(item => item.symbol === symbol);
  return {
    symbol,
    labelZh: meta?.labelZh || symbol,
    kind: meta?.kind || 'index',
    price: round(price, price > 1000 ? 2 : 3),
    changePct: round(changePct, 3),
  };
}

async function fetchOptionalCboeQuote(symbol: string): Promise<CrossAssetQuote | null> {
  try {
    return await fetchCboeQuote(symbol);
  } catch {
    return null;
  }
}

export async function getCrossAssetRisk(): Promise<CrossAssetRisk> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const [indexResults, btcResult, ethResult] = await Promise.allSettled([
    Promise.all(INDEX_SYMBOLS.map(item => fetchOptionalCboeQuote(item.symbol))),
    binanceFeed.getPrice('BTCUSDT'),
    binanceFeed.getPrice('ETHUSDT'),
  ]);

  if (indexResults.status === 'rejected') {
    throw indexResults.reason instanceof Error ? indexResults.reason : new Error('CBOE 指数数据不可用');
  }

  const quotes = indexResults.value.filter((quote): quote is CrossAssetQuote => quote !== null);
  const equityQuotes = quotes.filter(quote => quote.kind === 'index');
  const vix = quotes.find(quote => quote.symbol === '_VIX');
  if (!equityQuotes.length || !vix) throw new Error('风险雷达缺少指数或 VIX');

  const averageEquityChangePct = equityQuotes
    .reduce((sum, quote) => sum + quote.changePct, 0) / equityQuotes.length;
  const breadthPct = equityQuotes.filter(quote => quote.changePct > 0).length
    / equityQuotes.length * 100;

  const volatilityTerm = buildVolatilityTermStructure(quotes);

  const crypto: CrossAssetRisk['crypto'] = [];
  if (btcResult.status === 'fulfilled' && btcResult.value) {
    crypto.push({
      symbol: 'BTCUSDT',
      labelZh: '比特币',
      price: round(btcResult.value.price, btcResult.value.price < 10 ? 4 : 2),
      change24hPct: round(btcResult.value.change24hPct, 2),
    });
  }
  if (ethResult.status === 'fulfilled' && ethResult.value) {
    crypto.push({
      symbol: 'ETHUSDT',
      labelZh: '以太坊',
      price: round(ethResult.value.price, ethResult.value.price < 10 ? 4 : 2),
      change24hPct: round(ethResult.value.change24hPct, 2),
    });
  }
  const cryptoAverageChangePct = crypto.length
    ? crypto.reduce((sum, item) => sum + item.change24hPct, 0) / crypto.length
    : 0;

  // The score is deliberately transparent: equity breadth and trend push it up,
  // while VIX level and a rising VIX push it down.
  let riskScore = 50
    + averageEquityChangePct * 7
    + (breadthPct - 50) * 0.16
    + cryptoAverageChangePct * 0.8
    - Math.max(0, vix.price - 15) * 1.8
    - Math.max(0, vix.changePct) * 0.35;
  if (volatilityTerm?.shape === 'backwardation') {
    riskScore += clamp((volatilityTerm.ratio9d3m - 1) * 55, 0, 8);
  } else if (volatilityTerm?.shape === 'contango') {
    riskScore -= clamp(volatilityTerm.slope9d3m * 0.22, 0, 2.5);
  }
  riskScore = clamp(riskScore, 0, 100);

  const riskLevel: CrossAssetRisk['riskLevel'] = riskScore >= 62
    ? 'Risk-on'
    : riskScore >= 48
      ? 'Neutral'
      : riskScore >= 34
        ? 'Risk-off'
        : 'Stress';
  const riskLevelZh: CrossAssetRisk['riskLevelZh'] = riskScore >= 62
    ? '偏风险'
    : riskScore >= 48
      ? '中性'
      : riskScore >= 34
        ? '避险'
        : '高压';

  const termText = volatilityTerm ? `波动率期限${volatilityTerm.shapeZh}` : '';
  const summaryZh = `${termText ? termText + '；' : ''}美股均值 ${averageEquityChangePct >= 0 ? '+' : ''}${round(averageEquityChangePct, 2)}%，${breadthPct}% 指数上涨；VIX ${round(vix.price, 2)}（${vix.changePct >= 0 ? '+' : ''}${round(vix.changePct, 2)}%）。${riskLevelZh === '偏风险'
    ? '全球风险偏好偏强，但仍要避免追高。'
    : riskLevelZh === '中性'
      ? '全球风险信号混合，适合等待更清晰方向。'
      : riskLevelZh === '避险'
        ? '波动压力上升，降低仓位并优先防守。'
        : '市场进入高压状态，新仓应非常谨慎。'}`;

  const value: CrossAssetRisk = {
    source: 'CBOE Delayed Index Quotes + Binance Public Data',
    fetchedAt: new Date().toISOString(),
    quotes,
    crypto,
    volatilityTerm: volatilityTerm ?? undefined,
    averageEquityChangePct: round(averageEquityChangePct, 3),
    breadthPct: round(breadthPct, 1),
    vixLevel: round(vix.price, 2),
    vixChangePct: round(vix.changePct, 2),
    riskScore: round(riskScore, 1),
    riskLevel,
    riskLevelZh,
    summaryZh,
  };
  cache = { ts: Date.now(), value };
  return value;
}
