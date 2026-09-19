import type { NewsItem } from './news-settings';

interface YahooNewsEntry {
  title?: unknown;
  publisher?: unknown;
  link?: unknown;
  providerPublishTime?: unknown;
  relatedTickers?: unknown;
}

interface YahooSearchResponse {
  news?: YahooNewsEntry[];
}

const NEWS_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: NewsItem[] }>();

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function validUrl(value: unknown): string {
  const url = clean(value);
  return /^https?:\/\//i.test(url) ? url : '';
}

export function parseYahooNewsResponse(payload: YahooSearchResponse, symbolInput: string): NewsItem[] {
  const symbol = clean(symbolInput).toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return [];
  const rows = Array.isArray(payload?.news) ? payload.news : [];
  return rows.map(item => {
    const related = Array.isArray(item.relatedTickers)
      ? item.relatedTickers.map(clean).map(value => value.toUpperCase()).filter(Boolean)
      : [];
    const title = clean(item.title);
    const source = clean(item.publisher) || 'Yahoo Finance';
    const url = validUrl(item.link);
    const seconds = Number(item.providerPublishTime);
    const publishedAt = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : '';
    return { title, source, url, publishedAt, related };
  }).filter(item => {
    const related = item.related as string[];
    return Boolean(item.title && item.url && item.publishedAt && (!related.length || related.includes(symbol)));
  }).map(({ related: _related, ...item }) => item).slice(0, 15);
}

export async function getStockNews(symbolInput: string): Promise<NewsItem[]> {
  const symbol = clean(symbolInput).toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error('股票代码无效');
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < NEWS_TTL_MS) return cached.value;
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=15&quotesCount=0`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'MoneyMoney/1.0 (stock research; contact@moneymoney.app)' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Yahoo Finance news HTTP ${response.status}`);
  const result = parseYahooNewsResponse(await response.json() as YahooSearchResponse, symbol);
  cache.set(symbol, { at: Date.now(), value: result });
  return result;
}
