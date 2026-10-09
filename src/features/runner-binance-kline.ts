const BINANCE_DATA_API = 'https://data-api.binance.vision';

export function buildRunnerBinanceKlineUrl(rawSymbol: string): URL {
  const symbol = String(rawSymbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}USDT$/.test(symbol)) {
    throw new Error('AI 跑单 K 线仅支持 Binance USDT 现货标的');
  }
  const url = new URL('/api/v3/klines', BINANCE_DATA_API);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', '1h');
  url.searchParams.set('limit', '20');
  return url;
}

export async function fetchRunnerBinanceKlines(
  symbol: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<unknown[][]> {
  const response = await fetcher(buildRunnerBinanceKlineUrl(symbol), { signal });
  if (!response.ok) throw new Error(`Binance K 线 HTTP ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row))) {
    throw new Error('Binance K 线响应格式无效');
  }
  return rows as unknown[][];
}
