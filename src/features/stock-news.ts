import type { NewsItem } from './news-settings';
import crypto from 'node:crypto';

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
const cache = new Map<string, {
  at: number;
  value: NewsItem[];
  rawResponseHash: string;
  rawResponseBytes: number;
  rawResponseBase64: string;
}>();

const MAX_NEWS_RESPONSE_BYTES = 512 * 1024;

export interface StockNewsSnapshot {
  items: NewsItem[];
  status: 'live' | 'cached';
  updatedAt: string | null;
  retrievedAt: string;
  source: 'Yahoo Finance';
  contentHash: string;
  rawResponseHash: string;
  rawResponseBytes: number;
  rawResponseBase64: string;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function validUrl(value: unknown): string {
  const url = clean(value);
  return /^https?:\/\//i.test(url) ? url : '';
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
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
    // A search query can still return broad market headlines without symbol
    // metadata. Keep only records Yahoo explicitly relates to this ticker.
    return Boolean(item.title && item.url && item.publishedAt && related.includes(symbol));
  }).map(({ related: _related, ...item }) => item).slice(0, 15);
}

export async function getStockNewsSnapshot(symbolInput: string): Promise<StockNewsSnapshot> {
  const symbol = clean(symbolInput).toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error('股票代码无效');
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < NEWS_TTL_MS) {
    const retrievedAt = new Date(cached.at).toISOString();
    return {
      items: cached.value, status: 'cached', updatedAt: cached.value.map(item => item.publishedAt).filter(Boolean).sort().at(-1) || null,
      retrievedAt, source: 'Yahoo Finance', contentHash: digest({ version: 1, symbol, retrievedAt, items: cached.value }),
      rawResponseHash: cached.rawResponseHash, rawResponseBytes: cached.rawResponseBytes,
      rawResponseBase64: cached.rawResponseBase64,
    };
  }
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=15&quotesCount=0`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'MoneyMoney/1.0 (stock research; contact@moneymoney.app)' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Yahoo Finance news HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_NEWS_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('Yahoo Finance 新闻响应超过 512KB 冻结上限');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_NEWS_RESPONSE_BYTES) throw new Error('Yahoo Finance 新闻响应超过 512KB 冻结上限');
  let payload: YahooSearchResponse;
  try {
    payload = JSON.parse(bytes.toString('utf8')) as YahooSearchResponse;
  } catch {
    throw new Error('Yahoo Finance 新闻响应不是有效 JSON，不能冻结');
  }
  const result = parseYahooNewsResponse(payload, symbol);
  const freshRetrievedAt = new Date().toISOString();
  const rawResponseHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const rawResponseBase64 = bytes.toString('base64');
  cache.set(symbol, {
    at: Date.parse(freshRetrievedAt), value: result, rawResponseHash,
    rawResponseBytes: bytes.byteLength, rawResponseBase64,
  });
  return {
    items: result, status: 'live', updatedAt: result.map(item => item.publishedAt).filter(Boolean).sort().at(-1) || null,
    retrievedAt: freshRetrievedAt, source: 'Yahoo Finance', contentHash: digest({ version: 1, symbol, retrievedAt: freshRetrievedAt, items: result }),
    rawResponseHash, rawResponseBytes: bytes.byteLength, rawResponseBase64,
  };
}

export async function getStockNews(symbolInput: string): Promise<NewsItem[]> {
  return (await getStockNewsSnapshot(symbolInput)).items;
}
