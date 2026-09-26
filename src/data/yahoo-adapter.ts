import { ResilientDataSourceAdapter, type DataSourceAdapter } from './source-adapter';
import type { StockQuote } from '../features/stock-data-contracts';

export interface StockKlineBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const STOCK_KLINE_PERIODS: Record<string, { label: string; interval: string; range: string; aggregateDays?: number }> = {
  '1m': { label: '1分', interval: '1m', range: '7d' },
  '5m': { label: '5分', interval: '5m', range: '60d' },
  '15m': { label: '15分', interval: '15m', range: '60d' },
  '1h': { label: '1小时', interval: '1h', range: '2y' },
  '1d': { label: '1日', interval: '1d', range: '5y' },
  '3d': { label: '3日', interval: '1d', range: '10y', aggregateDays: 3 },
  '5d': { label: '5日', interval: '1d', range: '10y', aggregateDays: 5 },
  '60d': { label: '60日', interval: '1d', range: '10y', aggregateDays: 60 },
  '120d': { label: '120日', interval: '1d', range: '10y', aggregateDays: 120 },
  '1y': { label: '1年', interval: '1d', range: '10y', aggregateDays: 365 },
  '5y': { label: '5年', interval: '1d', range: '10y', aggregateDays: 1825 },
} as const;

type YahooChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<Record<string, Array<number | null> | undefined>> };
    } | null>;
  };
};

export function normalizeYahooChartPayload(payload: YahooChartPayload): StockKlineBar[] {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0];
  if (!quote) return [];
  const bars = timestamps.map((timestamp, index) => {
    const rawOpen = quote.open?.[index];
    const rawHigh = quote.high?.[index];
    const rawLow = quote.low?.[index];
    const rawClose = quote.close?.[index];
    const open = Number(rawOpen);
    const high = Number(rawHigh);
    const low = Number(rawLow);
    const close = Number(rawClose);
    const volume = Number(quote.volume?.[index] ?? 0);
    if ([rawOpen, rawHigh, rawLow, rawClose].some(value => value == null) || ![timestamp, open, high, low, close].every(Number.isFinite)) return null;
    return { time: Number(timestamp) * 1000, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 };
  }).filter((bar): bar is StockKlineBar => bar !== null);
  return bars.sort((a, b) => a.time - b.time);
}

export function aggregateStockBars(bars: StockKlineBar[], bucketSize: number): StockKlineBar[] {
  if (!Number.isInteger(bucketSize) || bucketSize <= 1) return bars;
  const output: StockKlineBar[] = [];
  for (let index = 0; index < bars.length; index += bucketSize) {
    const bucket = bars.slice(index, index + bucketSize);
    if (!bucket.length) continue;
    output.push({
      time: bucket[0].time,
      open: bucket[0].open,
      high: Math.max(...bucket.map(bar => bar.high)),
      low: Math.min(...bucket.map(bar => bar.low)),
      close: bucket[bucket.length - 1].close,
      volume: bucket.reduce((sum, bar) => sum + (Number.isFinite(bar.volume) ? bar.volume : 0), 0),
    });
  }
  return output;
}

function normalizeYahooSymbol(input: string): string {
  const value = String(input || '').trim().toUpperCase().replace(/^US(?=[A-Z])/, '');
  const mainland = value.match(/^(SH|SZ|BJ)(\d{6})$/);
  if (mainland) return `${mainland[2]}.${mainland[1] === 'SH' ? 'SS' : mainland[1] === 'SZ' ? 'SZ' : 'BJ'}`;
  const hongKong = value.match(/^HK(\d{4,5})$/);
  if (hongKong) return `${hongKong[1].padStart(4, '0')}.HK`;
  return value.replace(/\.(OQ|N|A|NY|NASDAQ)$/i, '');
}

export function createYahooStockAdapter(): DataSourceAdapter<StockQuote> {
  return new ResilientDataSourceAdapter<StockQuote>({
    id: 'yahoo-finance-quote',
    group: 'Yahoo Finance',
    ttlMs: 30_000,
    timeoutMs: 2_000,
    retries: 0,
    fetcher: async (input, signal) => {
      const symbol = String((input as { symbol?: string })?.symbol || '').trim();
      if (!symbol) throw new Error('Symbol is required');
      let response;
      const headers = { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' };
      try {
        const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbol);
        response = await fetch(url, { signal, headers });
        if (!response.ok) throw new Error();
      } catch (err) {
        const url2 = 'https://query2.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbol);
        response = await fetch(url2, { signal, headers });
      }
      if (!response.ok) throw new Error('Yahoo Finance API failed with status: ' + response.status);
      const data = (await response.json()) as any;
      const quote = data.quoteResponse?.result?.[0];
      if (!quote) throw new Error('Quote not found');
      return {
        symbol: quote.symbol,
        price: quote.regularMarketPrice,
        changePct: quote.regularMarketChangePercent ?? null,
        currency: quote.currency || 'USD',
        asOf: quote.regularMarketTime ? new Date(quote.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
      };
    },
  });
}

export function createYahooStockKlineAdapter(): DataSourceAdapter<StockKlineBar[]> {
  return new ResilientDataSourceAdapter<StockKlineBar[]>({
    id: 'yahoo-finance-history',
    group: 'Yahoo Finance 历史K线',
    ttlMs: 60_000,
    timeoutMs: 8_000,
    retries: 1,
    fetcher: async (input, signal) => {
      const source = (input || {}) as { symbol?: string; period?: string };
      const symbol = normalizeYahooSymbol(String(source.symbol || ''));
      if (!symbol) throw new Error('Symbol is required');
      const period = String(source.period || '1d').toLowerCase() as keyof typeof STOCK_KLINE_PERIODS;
      const config = STOCK_KLINE_PERIODS[period];
      if (!config) throw new Error(`Unsupported stock period: ${period}`);
      const headers = { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' };
      let response: Response | undefined;
      let lastError: unknown;
      for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
        try {
          const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(config.interval)}&range=${encodeURIComponent(config.range)}&events=div%2Csplits`;
          response = await fetch(url, { signal, headers });
          if (response.ok) break;
          lastError = new Error(`Yahoo Finance API failed with status: ${response.status}`);
        } catch (error) {
          lastError = error;
        }
      }
      if (!response?.ok) throw lastError || new Error('Yahoo Finance API failed');
      const bars = normalizeYahooChartPayload(await response.json() as YahooChartPayload);
      if (!bars.length) throw new Error('Yahoo Finance returned no historical bars');
      return config.aggregateDays ? aggregateStockBars(bars, config.aggregateDays) : bars;
    },
  });
}
