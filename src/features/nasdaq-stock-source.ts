import type { StockBar, StockQuote } from './stock-data-contracts';
import { ResilientDataSourceAdapter, type DataSourceAdapter } from '../data/source-adapter';

type NasdaqPayload = { data?: any };
type NasdaqFetch = (input: string, init?: RequestInit) => Promise<Response>;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function numeric(value: unknown): number | null {
  const parsed = Number(text(value).replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUsDate(value: unknown): number | null {
  const match = text(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const time = Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  return Number.isFinite(time) ? time : null;
}

function keyedAdapter<T>(
  id: string,
  group: string,
  keyFor: (input: unknown) => string,
  create: () => ResilientDataSourceAdapter<T>,
): DataSourceAdapter<T> {
  const adapters = new Map<string, ResilientDataSourceAdapter<T>>();
  return {
    id,
    group,
    fetch(input?: unknown) {
      const key = keyFor(input);
      if (!key) throw new Error(`${id} requires an instrument key`);
      let adapter = adapters.get(key);
      if (!adapter) {
        adapter = create();
        adapters.set(key, adapter);
        if (adapters.size > 500) adapters.delete(adapters.keys().next().value as string);
      }
      return adapter.fetch(input);
    },
  };
}

export function parseNasdaqQuotePayload(symbolInput: string, payload: NasdaqPayload): StockQuote {
  const symbol = text(symbolInput).toUpperCase();
  const primary = payload?.data?.primaryData;
  const price = numeric(primary?.lastSalePrice);
  if (!symbol || price == null || price < 0) throw new Error('Nasdaq quote payload is invalid');
  return {
    symbol,
    price,
    changePct: numeric(primary?.percentageChange),
    currency: 'USD',
    asOf: text(primary?.lastTradeTimestamp) || null,
  };
}

export function parseNasdaqHistoricalPayload(payload: NasdaqPayload): StockBar[] {
  const rows = Array.isArray(payload?.data?.tradesTable?.rows) ? payload.data.tradesTable.rows : [];
  const parsed: Array<StockBar | null> = rows.map((row: any) => {
    const time = parseUsDate(row?.date);
    const open = numeric(row?.open);
    const high = numeric(row?.high);
    const low = numeric(row?.low);
    const close = numeric(row?.close);
    const volume = numeric(row?.volume);
    if (time == null || open == null || high == null || low == null || close == null) return null;
    return { time, open, high, low, close, volume } satisfies StockBar;
  });
  return parsed.filter((row: StockBar | null): row is StockBar => row != null)
    .sort((a, b) => a.time - b.time);
}

export interface NasdaqAdapterOptions {
  quoteTtlMs?: number;
  barsTtlMs?: number;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}

export function createNasdaqStockAdapters(fetchImpl: NasdaqFetch = fetch, options: NasdaqAdapterOptions = {}) {
  const request = (path: string, signal: AbortSignal) => fetchImpl(`https://api.nasdaq.com/api/${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'MoneyMoney/1.0 stock research' },
    signal,
  });
  const common = {
    timeoutMs: options.timeoutMs ?? 10_000,
    retries: options.retries ?? 2,
    backoffMs: options.backoffMs ?? 250,
  };
  const quote = keyedAdapter<StockQuote>(
    'nasdaq-public-quote',
    '股票行情',
    input => text((input as { symbol?: string })?.symbol).toUpperCase(),
    () => new ResilientDataSourceAdapter<StockQuote>({
      id: 'nasdaq-public-quote',
      group: '股票行情',
      ttlMs: options.quoteTtlMs ?? 10 * 60_000,
      ...common,
      fetcher: async (input, signal) => {
        const symbol = text((input as { symbol?: string })?.symbol).toUpperCase();
        const response = await request(`quote/${encodeURIComponent(symbol)}/info?assetclass=stocks`, signal);
        if (!response.ok) throw new Error(`Nasdaq HTTP ${response.status}`);
        return parseNasdaqQuotePayload(symbol, await response.json() as NasdaqPayload);
      },
    }),
  );
  const bars = keyedAdapter<StockBar[]>(
    'nasdaq-public-history',
    '股票行情',
    input => {
      const value = input as { symbol?: string; from?: string };
      const symbol = text(value?.symbol).toUpperCase();
      const from = text(value?.from) || new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
      return symbol ? `${symbol}:${from}` : '';
    },
    () => new ResilientDataSourceAdapter<StockBar[]>({
      id: 'nasdaq-public-history',
      group: '股票行情',
      ttlMs: options.barsTtlMs ?? 15 * 60_000,
      ...common,
      fetcher: async (input, signal) => {
        const value = input as { symbol?: string; from?: string };
        const symbol = text(value?.symbol).toUpperCase();
        const from = text(value?.from) || new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
        const response = await request(`quote/${encodeURIComponent(symbol)}/historical?assetclass=stocks&fromdate=${encodeURIComponent(from)}&limit=100`, signal);
        if (!response.ok) throw new Error(`Nasdaq HTTP ${response.status}`);
        return parseNasdaqHistoricalPayload(await response.json() as NasdaqPayload);
      },
    }),
  );
  return { quote, bars };
}
