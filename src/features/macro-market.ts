/**
 * Keyless macro market data for the advisor.
 * FX comes from Frankfurter's ECB time series; commodities use Tencent public
 * daily ETF quotes, and bonds/credit use Nasdaq public ETF history.
 */

export interface MacroBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MacroSeries {
  id: string;
  symbol: string;
  name: string;
  group: 'Forex' | 'Commodity' | 'Bond';
  current: number;
  changePct: number;
  bars: MacroBar[];
}

export interface MacroMarketSnapshot {
  series: MacroSeries[];
  sources: string[];
  errors: string[];
  fetchedAt: string;
}

interface CacheEntry {
  ts: number;
  value: MacroMarketSnapshot;
}

const CACHE_TTL_MS = 10 * 60_000;
let cache: CacheEntry | null = null;

const FX_PAIRS = [
  { symbol: 'EURUSD', name: '欧元 / 美元', quote: 'USD', invert: false },
  { symbol: 'GBPUSD', name: '英镑 / 美元', quote: 'GBP', invert: false },
  { symbol: 'AUDUSD', name: '澳元 / 美元', quote: 'AUD', invert: false },
  { symbol: 'USDJPY', name: '美元 / 日元', quote: 'JPY', invert: true },
  { symbol: 'USDCNY', name: '美元 / 人民币', quote: 'CNY', invert: true },
] as const;

const COMMODITY_PROXIES = [
  { symbol: 'usGLD', name: '黄金 ETF', digits: 2 },
  { symbol: 'usSLV', name: '白银 ETF', digits: 2 },
  { symbol: 'usUSO', name: '原油 ETF', digits: 2 },
  { symbol: 'usCPER', name: '铜 ETF', digits: 2 },
  { symbol: 'usDBA', name: '农业 ETF', digits: 2 },
  { symbol: 'usUNG', name: '天然气 ETF', digits: 2 },
] as const;

// Liquid ETF proxies keep the signal keyless: government duration and
// investment-grade/high-yield credit risk can both be observed from prices.
const BOND_PROXIES = [
  { symbol: 'TLT', name: '20+年美债 ETF', digits: 2 },
  { symbol: 'IEF', name: '7-10年美债 ETF', digits: 2 },
  { symbol: 'SHY', name: '1-3年美债 ETF', digits: 2 },
  { symbol: 'LQD', name: '投资级公司债 ETF', digits: 2 },
  { symbol: 'HYG', name: '高收益公司债 ETF', digits: 2 },
] as const;

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function closeOnlyBars(
  values: Array<{ date: string; close: number }>,
): MacroBar[] {
  const bars: MacroBar[] = [];
  for (let i = 0; i < values.length; i++) {
    const close = values[i].close;
    const previous = i > 0 ? values[i - 1].close : close;
    if (!Number.isFinite(close) || close <= 0) continue;
    bars.push({
      time: new Date(`${values[i].date}T00:00:00Z`).getTime(),
      open: Number.isFinite(previous) && previous > 0 ? previous : close,
      high: Math.max(Number.isFinite(previous) ? previous : close, close),
      low: Math.min(Number.isFinite(previous) && previous > 0 ? previous : close, close),
      close,
    });
  }
  return bars;
}

async function fetchFxSeries(): Promise<MacroSeries[]> {
  const startedAt = new Date(Date.now() - 240 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const url = `https://api.frankfurter.app/${startedAt}..?from=EUR&to=${[
    ...new Set(FX_PAIRS.map(pair => pair.quote)),
  ].join(',')}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Frankfurter unavailable (${response.status})`);
  const payload = await response.json() as {
    rates?: Record<string, Record<string, number>>;
  };
  const rows = Object.entries(payload.rates || {})
    .map(([date, rates]) => ({ date, rates }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 60) throw new Error('Frankfurter history too short');

  return FX_PAIRS.flatMap(pair => {
    const values = rows
      .map(row => ({
        date: row.date,
        close: pair.invert
          ? (Number.isFinite(row.rates[pair.quote]) && row.rates[pair.quote] > 0
            ? 1 / row.rates[pair.quote]
            : NaN)
          : row.rates[pair.quote],
      }))
      .filter(item => Number.isFinite(item.close) && item.close > 0);
    const bars = closeOnlyBars(values);
    const last = bars[bars.length - 1];
    const previous = bars[bars.length - 2];
    if (!last || !previous) return [];

    return [{
      id: `fx-${pair.symbol.toLowerCase()}`,
      symbol: pair.symbol,
      name: pair.name,
      group: 'Forex' as const,
      current: round(last.close),
      changePct: round((last.close - previous.close) / previous.close * 100, 3),
      bars,
    }];
  });
}

interface TencentKlinePayload {
  data?: Record<string, {
    qfqday?: string[][];
    day?: string[][];
  }>;
}

interface NasdaqHistoricalPayload {
  data?: {
    tradesTable?: {
      rows?: Array<{
        date?: string;
        open?: string;
        high?: string;
        low?: string;
        close?: string;
      }>;
    };
  };
}

async function fetchTencentBars(symbol: string): Promise<MacroBar[]> {
  // Tencent exposes US ETF daily history under its .AM market alias.
  const apiSymbol = `${symbol}.AM`;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${apiSymbol},day,,,120,qfq`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${symbol} daily data unavailable`);
  const payload = await response.json() as TencentKlinePayload;
  const rows = Object.values(payload.data || {})
    .flatMap(node => node.qfqday || node.day || [])
    .filter(row => Array.isArray(row) && row.length >= 5)
    .map(row => ({
      time: new Date(row[0]).getTime(),
      open: Number(row[1]),
      close: Number(row[2]),
      high: Number(row[3]),
      low: Number(row[4]),
    }))
    .filter(bar => [bar.time, bar.open, bar.close, bar.high, bar.low]
      .every(Number.isFinite))
    .sort((a, b) => a.time - b.time);
  if (rows.length < 60) throw new Error(`${symbol} daily history too short`);
  return rows;
}

async function fetchCommoditySeries(): Promise<MacroSeries[]> {
  const results = await Promise.allSettled(COMMODITY_PROXIES.map(async (proxy): Promise<MacroSeries> => {
    const bars = await fetchTencentBars(proxy.symbol);
    const last = bars[bars.length - 1];
    const previous = bars[bars.length - 2] || last;
    return {
      id: `commodity-${proxy.symbol.replace(/^us/, '').toLowerCase()}`,
      symbol: proxy.symbol.replace(/^us/, ''),
      name: proxy.name,
      group: 'Commodity' as const,
      current: round(last.close, proxy.digits),
      changePct: round((last.close - previous.close) / previous.close * 100, 3),
      bars,
    };
  }));

  return results
    .filter((result): result is PromiseFulfilledResult<MacroSeries> =>
      result.status === 'fulfilled')
    .map(result => result.value);
}

async function fetchNasdaqBondBars(symbol: string): Promise<MacroBar[]> {
  const now = new Date();
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - 240 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const query = new URLSearchParams({
    assetclass: 'etf',
    fromdate: fromDate,
    todate: toDate,
    limit: '120',
  });
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?${query}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Referer: 'https://www.nasdaq.com/',
      'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${symbol} history HTTP ${response.status}`);
  const payload = await response.json() as NasdaqHistoricalPayload;

  const bars = (payload.data?.tradesTable?.rows || [])
    .map(row => ({
      time: (() => {
        const parts = (row.date || '').split('/').map(Number);
        return parts.length === 3 ? Date.UTC(parts[2], parts[0] - 1, parts[1]) : NaN;
      })(),
      open: Number((row.open || '').replace(/,/g, '')),
      high: Number((row.high || '').replace(/,/g, '')),
      low: Number((row.low || '').replace(/,/g, '')),
      close: Number((row.close || '').replace(/,/g, '')),
    }))
    .filter(bar => [bar.time, bar.open, bar.high, bar.low, bar.close]
      .every(Number.isFinite))
    .sort((a, b) => a.time - b.time);
  if (bars.length < 60) throw new Error(`${symbol} daily history too short`);
  return bars;
}

async function fetchBondSeries(): Promise<MacroSeries[]> {
  const results = await Promise.allSettled(BOND_PROXIES.map(async (proxy): Promise<MacroSeries> => {
    const bars = await fetchNasdaqBondBars(proxy.symbol);
    const last = bars[bars.length - 1];
    const previous = bars[bars.length - 2] || last;
    return {
      id: `bond-${proxy.symbol.toLowerCase()}`,
      symbol: proxy.symbol,
      name: proxy.name,
      group: 'Bond' as const,
      current: round(last.close, proxy.digits),
      changePct: round((last.close - previous.close) / previous.close * 100, 3),
      bars,
    };
  }));

  return results
    .filter((result): result is PromiseFulfilledResult<MacroSeries> =>
      result.status === 'fulfilled')
    .map(result => result.value);
}

export async function getMacroMarketSnapshot(): Promise<MacroMarketSnapshot> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const [fxResult, commodityResult, bondResult] = await Promise.allSettled([
    fetchFxSeries(),
    fetchCommoditySeries(),
    fetchBondSeries(),
  ]);
  const series = [
    ...(fxResult.status === 'fulfilled' ? fxResult.value : []),
    ...(commodityResult.status === 'fulfilled' ? commodityResult.value : []),
    ...(bondResult.status === 'fulfilled' ? bondResult.value : []),
  ];

  const snapshot: MacroMarketSnapshot = {
    series,
    sources: [
      ...(fxResult.status === 'fulfilled' && fxResult.value.length
        ? ['Frankfurter / European Central Bank FX time series'] : []),
      ...(commodityResult.status === 'fulfilled' && commodityResult.value.length
        ? ['Tencent Finance public commodity-proxy ETF quotes'] : []),
      ...(bondResult.status === 'fulfilled' && bondResult.value.length
        ? ['Nasdaq public bond and credit ETF history'] : []),
    ],
    errors: [
      ...(fxResult.status === 'rejected' ? ['FX time series unavailable'] : []),
      ...(commodityResult.status === 'rejected'
        ? ['Commodity proxy data unavailable'] : []),
      ...(bondResult.status === 'rejected'
        ? ['Bond and credit proxy data unavailable'] : []),
    ],
    fetchedAt: new Date().toISOString(),
  };

  if (!series.length) throw new Error('Macro market data unavailable');
  cache = { ts: Date.now(), value: snapshot };
  return snapshot;
}

export async function getMacroCurrentPrices(
  symbols: string[],
): Promise<Map<string, number>> {
  const wanted = new Set(symbols.map(symbol => symbol.toUpperCase()));
  const snapshot = await getMacroMarketSnapshot();
  return new Map(snapshot.series
    .filter(item => wanted.has(item.symbol.toUpperCase()))
    .map(item => [item.symbol.toUpperCase(), item.current]));
}
