import { ResilientDataSourceAdapter, type DataSourceAdapter } from './source-adapter';

export interface CryptoKlineBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export const CRYPTO_KLINE_PERIODS: Record<string, { label: string; interval: string }> = {
  '1m': { label: '1分', interval: '1m' },
  '3m': { label: '3分', interval: '3m' },
  '5m': { label: '5分', interval: '5m' },
  '15m': { label: '15分', interval: '15m' },
  '30m': { label: '30分', interval: '30m' },
  '1h': { label: '1小时', interval: '1h' },
  '4h': { label: '4小时', interval: '4h' },
  '1d': { label: '1日', interval: '1d' },
  '1w': { label: '1周', interval: '1w' },
};

type BinanceKlineInput = { symbol?: string; period?: string; limit?: number };
type FetchLike = typeof fetch;

function normalizeSymbol(value: string): string {
  const symbol = value.trim().toUpperCase().replace(/^(CRYPTO:|BINANCE:)/, '');
  if (/^(BTC|ETH|BNB|SOL|XRP|DOGE|ADA|AVAX|DOT|LINK)$/.test(symbol)) return `${symbol}USDT`;
  return symbol;
}

export function normalizeBinanceKlines(payload: unknown): CryptoKlineBar[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((row: unknown) => {
    if (!Array.isArray(row)) return null;
    const time = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    return [time, open, high, low, close, volume].every(Number.isFinite)
      ? { time, open, high, low, close, volume }
      : null;
  }).filter((bar): bar is CryptoKlineBar => bar !== null).sort((left, right) => left.time - right.time);
}

export function createBinanceKlineAdapter(options: { fetchImpl?: FetchLike; baseUrl?: string; limit?: number } = {}): DataSourceAdapter<CryptoKlineBar[]> {
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = (options.baseUrl || 'https://data-api.binance.vision').replace(/\/$/, '');
  return new ResilientDataSourceAdapter<CryptoKlineBar[]>({
    id: 'binance-public-history',
    group: 'Binance Public 历史K线',
    ttlMs: 60_000,
    timeoutMs: 10_000,
    retries: 1,
    fetcher: async (input, signal) => {
      const source = (input || {}) as BinanceKlineInput;
      const symbol = normalizeSymbol(String(source.symbol || ''));
      const period = String(source.period || '1d').toLowerCase();
      const config = CRYPTO_KLINE_PERIODS[period];
      if (!symbol) throw new Error('Crypto symbol is required');
      if (!config) throw new Error(`Unsupported crypto period: ${period}`);
      const limit = Math.max(1, Math.min(1000, Math.trunc(Number(source.limit || options.limit || 1000))));
      const response = await fetchImpl(`${baseUrl}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(config.interval)}&limit=${limit}`, { signal });
      if (!response.ok) throw new Error(`Binance API failed with status: ${response.status}`);
      const bars = normalizeBinanceKlines(await response.json());
      if (!bars.length) throw new Error('Binance returned no historical bars');
      return bars;
    },
  });
}
