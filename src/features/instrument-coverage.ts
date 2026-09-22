import type { StockDataBundle } from './stock-data-contracts';
import type { NewsItem } from './news-settings';
import type { InsiderRadarResult } from './insider-transactions';

export type CoverageStatus = 'live' | 'cached' | 'partial' | 'empty' | 'unavailable';

export interface InstrumentCoverageCapability {
  status: CoverageStatus;
  source: string;
  count: number | null;
  updatedAt: string | null;
  reason: string | null;
  coverage?: { from: string | null; to: string | null };
}

export interface StockCoverageMap {
  market: 'stocks';
  instrument: string;
  updatedAt: string;
  capabilities: Record<'quote' | 'bars' | 'filings' | 'fundamentals' | 'news' | 'insider', InstrumentCoverageCapability>;
}

type Settled<T> = PromiseSettledResult<T>;

function normalizeSymbol(value: string): string {
  const symbol = String(value || '').trim().toUpperCase().replace(/^US(?=[A-Z])/, '');
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || symbol.includes('..')) throw new Error('股票代码无效');
  return symbol;
}

function failure(source: string, result: Settled<unknown> | undefined): InstrumentCoverageCapability {
  const reason = result?.status === 'rejected' ? String(result.reason instanceof Error ? result.reason.message : result.reason) : '来源尚未检查';
  return { status: 'unavailable', source, count: null, updatedAt: null, reason };
}

function sourceStatus(bundle: StockDataBundle, source: string, hasData: boolean, emptyReason: string): InstrumentCoverageCapability {
  const snapshot = bundle.sources.find(item => item.source === source);
  if (!snapshot || snapshot.status === 'unavailable' || snapshot.status === 'unconfigured') {
    return { status: 'unavailable', source, count: null, updatedAt: snapshot?.fetchedAt || null, reason: snapshot?.error || '来源不可用' };
  }
  return {
    status: hasData ? (snapshot.status === 'stale' ? 'cached' : 'live') : 'empty',
    source,
    count: null,
    updatedAt: snapshot.fetchedAt || null,
    reason: hasData ? null : emptyReason,
  };
}

function barDate(value: unknown): string | null {
  const row = value as { time?: unknown; date?: unknown };
  if (typeof row?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row.date)) return row.date.slice(0, 10);
  const time = Number(row?.time);
  if (!Number.isFinite(time)) return null;
  const ms = time < 10_000_000_000 ? time * 1000 : time;
  const parsed = new Date(ms);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

export function buildStockCoverageMap(symbolInput: string, input: {
  overview?: Settled<StockDataBundle>;
  news?: Settled<NewsItem[]>;
  insider?: Settled<InsiderRadarResult>;
}): StockCoverageMap {
  const symbol = normalizeSymbol(symbolInput);
  const overview = input.overview;
  const capabilities = {} as StockCoverageMap['capabilities'];
  if (overview?.status !== 'fulfilled') {
    for (const key of ['quote', 'bars', 'filings', 'fundamentals'] as const) capabilities[key] = failure(`stock-${key}`, overview);
  } else {
    const bundle = overview.value;
    capabilities.quote = { ...sourceStatus(bundle, bundle.sources.find(item => /quote/i.test(item.source))?.source || 'stock-quote', Boolean(bundle.quote), '报价源没有返回该标的'), count: bundle.quote ? 1 : 0 };
    const dates = bundle.bars.map(barDate).filter((value): value is string => Boolean(value)).sort();
    capabilities.bars = { ...sourceStatus(bundle, bundle.sources.find(item => /history|bars/i.test(item.source))?.source || 'stock-bars', bundle.bars.length > 0, '历史源没有返回该标的'), count: bundle.bars.length, coverage: { from: dates[0] || null, to: dates.at(-1) || null } };
    capabilities.filings = { ...sourceStatus(bundle, bundle.sources.find(item => /submissions|filings/i.test(item.source))?.source || 'sec-edgar-submissions', bundle.filings.length > 0, 'SEC 已响应，但该标的没有返回申报'), count: bundle.filings.length };
    capabilities.fundamentals = { ...sourceStatus(bundle, bundle.sources.find(item => /companyfacts|fundamentals/i.test(item.source))?.source || 'sec-edgar-companyfacts', Boolean(bundle.fundamentals), 'SEC 已响应，但该标的没有公司事实'), count: bundle.fundamentals ? 1 : 0 };
  }
  if (input.news?.status === 'fulfilled') capabilities.news = { status: input.news.value.length ? 'live' : 'empty', source: 'Yahoo Finance', count: input.news.value.length, updatedAt: new Date().toISOString(), reason: input.news.value.length ? null : '新闻源已响应，但没有返回该标的新闻' };
  else capabilities.news = failure('Yahoo Finance', input.news);
  if (input.insider?.status === 'fulfilled') capabilities.insider = { status: input.insider.value.transactions.length ? 'live' : 'empty', source: 'SEC EDGAR Form 4', count: input.insider.value.transactions.length, updatedAt: input.insider.value.updatedAt || null, reason: input.insider.value.transactions.length ? null : `SEC 已响应；近 ${input.insider.value.windowDays} 天没有可解析交易` };
  else capabilities.insider = failure('SEC EDGAR Form 4', input.insider);
  return { market: 'stocks', instrument: `stock:us:${symbol}`, updatedAt: new Date().toISOString(), capabilities };
}
