import { ResilientDataSourceAdapter, type DataSourceAdapter, type SourceSnapshot, type SourceStatus } from '../data/source-adapter';
import { createNasdaqStockAdapters } from './nasdaq-stock-source';
import { loadSecCompanyFacts, loadSecSubmissions } from './sec-edgar-client';
import type { StockBar, StockCompanyFacts, StockDataBundle, StockFiling, StockQuote } from './stock-data-contracts';

type Adapter<T> = Pick<DataSourceAdapter<T>, 'id' | 'fetch'>;

export interface StockDataDependencies {
  quote: Adapter<StockQuote>;
  bars: Adapter<StockBar[]>;
  filings: Adapter<StockFiling[]>;
  fundamentals: Adapter<StockCompanyFacts | null>;
}

export interface StockDataServiceOptions {
  cacheTtlMs?: number;
}

function validSymbol(value: string): string {
  const symbol = String(value || '').trim().toUpperCase().replace(/^US(?=[A-Z])/, '');
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || symbol.includes('..')) throw new Error('股票代码无效');
  return symbol;
}

function failedSnapshot<T>(id: string, error: unknown): SourceSnapshot<T> {
  const now = new Date().toISOString();
  return { data: null, source: id, fetchedAt: now, expiresAt: now, latencyMs: null, status: 'failed', error: String(error), consecutiveFailures: 1 };
}

function emptyValue(id: string, snapshot: SourceSnapshot<unknown>): unknown {
  if (snapshot.data != null) return snapshot.data;
  if (id.includes('history')) return [];
  if (id.includes('submissions')) return [];
  return null;
}

function createDefaultStockDataDependencies(): StockDataDependencies {
  const nasdaq = createNasdaqStockAdapters();
  const filings = new ResilientDataSourceAdapter<StockFiling[]>({
    id: 'sec-edgar-submissions',
    group: 'SEC 公司申报',
    ttlMs: 12 * 60 * 60_000,
    timeoutMs: 15_000,
    retries: 2,
    fetcher: async (input) => (await loadSecSubmissions(String((input as { symbol?: string })?.symbol || ''))).filings,
  });
  const fundamentals = new ResilientDataSourceAdapter<StockCompanyFacts | null>({
    id: 'sec-edgar-companyfacts',
    group: 'SEC 公司事实',
    ttlMs: 12 * 60 * 60_000,
    timeoutMs: 15_000,
    retries: 2,
    fetcher: async (input) => loadSecCompanyFacts(String((input as { symbol?: string })?.symbol || '')),
  });
  return { quote: nasdaq.quote, bars: nasdaq.bars, filings, fundamentals };
}

export class StockDataService {
  private readonly dependencies: StockDataDependencies;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { at: number; value: StockDataBundle }>();

  constructor(dependencies: Partial<StockDataDependencies> = {}, options: StockDataServiceOptions = {}) {
    const defaults = createDefaultStockDataDependencies();
    this.dependencies = { ...defaults, ...dependencies };
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
  }

  async overview(symbolInput: string): Promise<StockDataBundle> {
    const symbol = validSymbol(symbolInput);
    const hit = this.cache.get(symbol);
    if (hit && Date.now() - hit.at <= this.cacheTtlMs) return hit.value;
    const input = { symbol };
    const entries: Array<[string, Promise<SourceSnapshot<unknown>>]> = [
      ['quote', this.read(this.dependencies.quote, input, 'nasdaq-public-quote')],
      ['bars', this.read(this.dependencies.bars, input, 'nasdaq-public-history')],
      ['filings', this.read(this.dependencies.filings, input, 'sec-edgar-submissions')],
      ['fundamentals', this.read(this.dependencies.fundamentals, input, 'sec-edgar-companyfacts')],
    ];
    const settled = await Promise.all(entries.map(async ([key, promise]) => [key, await promise] as const));
    const snapshots = settled.map(([, snapshot]) => snapshot);
    const snapshotByKey = new Map(settled);
    const value: StockDataBundle = {
      symbol,
      quote: emptyValue('quote', snapshotByKey.get('quote')!) as StockQuote | null,
      bars: emptyValue('history', snapshotByKey.get('bars')!) as StockBar[],
      filings: emptyValue('submissions', snapshotByKey.get('filings')!) as StockFiling[],
      fundamentals: emptyValue('companyfacts', snapshotByKey.get('fundamentals')!) as StockCompanyFacts | null,
      snapshots,
      sources: snapshots,
      sourceStatus: Object.fromEntries(snapshots.map(snapshot => [snapshot.source, snapshot.status])) as Record<string, SourceStatus>,
    };
    this.cache.set(symbol, { at: Date.now(), value });
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value as string);
    return value;
  }

  private async read<T>(adapter: Adapter<T>, input: { symbol: string }, fallbackId: string): Promise<SourceSnapshot<T>> {
    try {
      const snapshot = await adapter.fetch(input);
      return snapshot.source ? snapshot : { ...snapshot, source: adapter.id || fallbackId };
    } catch (error) {
      return failedSnapshot<T>(adapter.id || fallbackId, error);
    }
  }
}

export const stockDataService = new StockDataService();
