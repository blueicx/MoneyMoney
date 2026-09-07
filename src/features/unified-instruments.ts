import { binanceFeed, type BinanceTicker } from './binance';
import { newsFeed, type NewsItem } from './news-settings';
import { getUpcomingEventCalendar, type UpcomingEvent } from './event-calendar';
import { getCachedPredictionRadarSlice, getPredictionRadar, type PredictionMarket } from './prediction-radar';
import { getAiRuntimeConfig } from './ai-runtime-config';

export type InstrumentType = 'stock' | 'crypto' | 'prediction';

export interface InstrumentRef {
  id: string;
  type: InstrumentType;
  venue: string;
  symbol: string;
  title: string;
  aliases: string[];
  marketId?: string;
}

export interface InstrumentSearchResult extends InstrumentRef {
  subtitle?: string;
  price?: number;
  changePct?: number;
}

export interface Freshness {
  fetchedAt: string | null;
  ageMs: number | null;
  staleAfterMs: number;
  status: 'fresh' | 'stale' | 'unavailable';
}

export interface UnifiedInstrumentOverview {
  instrument: InstrumentRef;
  quote: Record<string, unknown> | null;
  marketData: Record<string, unknown> | null;
  klines: unknown[];
  events: UpcomingEvent[];
  news: NewsItem[];
  analysis: {
    status: 'ready' | 'unavailable';
    text: string;
    model?: string;
    updatedAt: string;
    cached: boolean;
  };
  freshness: Freshness;
  sourceStatus: Record<string, 'ok' | 'stale' | 'unavailable'>;
}

export const UNIFIED_AI_CACHE_TTL_MS = 15 * 60_000;
const OVERVIEW_CACHE_TTL_MS = 60_000;
const overviewCache = new Map<string, { at: number; value: UnifiedInstrumentOverview }>();
const analysisCache = new Map<string, { at: number; value: UnifiedInstrumentOverview['analysis'] }>();

type InstrumentInput = Partial<InstrumentRef> & { type: InstrumentType; venue: string; symbol: string };

function clean(value: unknown): string { return String(value ?? '').trim(); }

function normalizedVenue(type: InstrumentType, venue: string): string {
  if (type === 'stock') return clean(venue || 'us').toLowerCase();
  if (type === 'crypto') return clean(venue || 'binance').toLowerCase();
  return clean(venue || 'predictfun').toLowerCase();
}

function normalizedSymbol(type: InstrumentType, symbol: string): string {
  const value = clean(symbol);
  if (type === 'prediction') return value;
  return value.toUpperCase().replace(/^US(?=[A-Z])/, type === 'stock' ? '' : 'US');
}

export function instrumentId(input: Pick<InstrumentInput, 'type' | 'venue' | 'symbol'>): string {
  return `${input.type}:${normalizedVenue(input.type, input.venue)}:${normalizedSymbol(input.type, input.symbol)}`;
}

export function normalizeInstrumentRef(input: InstrumentInput): InstrumentRef {
  const type = input.type;
  const venue = normalizedVenue(type, input.venue);
  const symbol = normalizedSymbol(type, input.symbol);
  const aliases = Array.from(new Set((Array.isArray(input.aliases) ? input.aliases : [])
    .map(clean).filter(Boolean)));
  return {
    id: instrumentId({ type, venue, symbol }),
    type,
    venue,
    symbol,
    title: clean(input.title) || symbol,
    aliases,
    ...(clean(input.marketId) ? { marketId: clean(input.marketId) } : {}),
  };
}

export function parseInstrumentQuery(query: string): { type: InstrumentType; venue: string; symbol: string } | null {
  const value = clean(query);
  const canonical = value.match(/^(stock|crypto|prediction):([^:]+):(.+)$/i);
  if (canonical) {
    return { type: canonical[1].toLowerCase() as InstrumentType, venue: canonical[2].toLowerCase(), symbol: canonical[3] };
  }
  if (/^[A-Za-z0-9]{1,}(?:USDT|USDC)$/i.test(value) || /^(BTC|ETH|SOL|BNB|XRP|DOGE)$/i.test(value)) {
    return { type: 'crypto', venue: 'binance', symbol: /^(BTC|ETH|SOL|BNB|XRP|DOGE)$/i.test(value) ? `${value.toUpperCase()}USDT` : value.toUpperCase() };
  }
  if (/^[A-Za-z]{1,4}$/.test(value)) return { type: 'stock', venue: 'us', symbol: value.toUpperCase() };
  return null;
}

export function dedupeInstrumentRefs(items: InstrumentRef[]): InstrumentRef[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function freshnessStatus(fetchedAt: string | null | undefined, staleAfterMs: number, now = Date.now()): Freshness {
  if (!fetchedAt) return { fetchedAt: null, ageMs: null, staleAfterMs, status: 'unavailable' };
  const timestamp = new Date(fetchedAt).getTime();
  if (!Number.isFinite(timestamp)) return { fetchedAt: null, ageMs: null, staleAfterMs, status: 'unavailable' };
  const ageMs = Math.max(0, now - timestamp);
  return { fetchedAt: new Date(timestamp).toISOString(), ageMs, staleAfterMs, status: ageMs <= staleAfterMs ? 'fresh' : 'stale' };
}

function stockFromTencent(raw: string): InstrumentSearchResult | null {
  const match = raw.match(/v_\w+="([^"]+)"/);
  if (!match) return null;
  const parts = match[1].split('~');
  if (parts.length < 5) return null;
  const symbol = String(parts[2] || '').replace(/^us/i, '').replace(/\.[A-Z]+$/i, '').toUpperCase();
  if (!symbol) return null;
  return normalizeSearchResult({ type: 'stock', venue: 'us', symbol, title: parts[1], aliases: [symbol], price: Number(parts[3]) || undefined, changePct: Number(parts[32]) || undefined });
}

function normalizeSearchResult(input: InstrumentInput & { price?: number; changePct?: number; subtitle?: string }): InstrumentSearchResult {
  const ref = normalizeInstrumentRef(input);
  return { ...ref, ...(input.subtitle ? { subtitle: input.subtitle } : {}), ...(input.price != null ? { price: input.price } : {}), ...(input.changePct != null ? { changePct: input.changePct } : {}) };
}

async function fetchStockSearch(query: string): Promise<InstrumentSearchResult[]> {
  try {
    const response = await fetch(`https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(query)}&t=all`, { signal: AbortSignal.timeout(8000) });
    const text = await response.text();
    const hint = text.match(/v_hint="([^"]*)"/)?.[1] || '';
    const decoded = hint.replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
    return decoded.split('^').map(item => {
      const [market, symbol, title, alias] = item.split('~');
      if (String(market).toLowerCase() !== 'us' || !symbol || !title) return null;
      return normalizeSearchResult({ type: 'stock', venue: 'us', symbol: symbol.replace(/\.[A-Z]+$/i, ''), title, aliases: [alias || symbol], subtitle: '美股' });
    }).filter((item): item is InstrumentSearchResult => item != null).slice(0, 10);
  } catch { return []; }
}

const POPULAR_STOCKS = [
  ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'NVIDIA'], ['TSLA', 'Tesla'], ['AMZN', 'Amazon'], ['GOOG', 'Alphabet'], ['META', 'Meta'],
] as const;

async function searchStocks(query: string): Promise<InstrumentSearchResult[]> {
  const live = await fetchStockSearch(query);
  if (live.length) return live;
  const q = query.toUpperCase();
  return POPULAR_STOCKS.filter(([symbol, title]) => symbol.includes(q) || title.toUpperCase().includes(q))
    .map(([symbol, title]) => normalizeSearchResult({ type: 'stock', venue: 'us', symbol, title, aliases: [symbol], subtitle: '美股' }));
}

async function searchCrypto(query: string): Promise<InstrumentSearchResult[]> {
  const parsed = parseInstrumentQuery(query);
  if (!parsed || parsed.type !== 'crypto') return [];
  const ticker = await binanceFeed.getPrice(parsed.symbol);
  return [normalizeSearchResult({ type: 'crypto', venue: parsed.venue, symbol: parsed.symbol, title: parsed.symbol.replace(/USDT$/, '') + ' / USDT', aliases: [parsed.symbol], subtitle: 'Binance', price: ticker?.price, changePct: ticker?.change24hPct })];
}

function predictionResult(market: PredictionMarket): InstrumentSearchResult {
  return normalizeSearchResult({
    type: 'prediction', venue: 'predictfun', symbol: String(market.id), marketId: String(market.id), title: market.titleZh || market.title,
    aliases: [market.title, market.platform], subtitle: `${market.platform} · YES ${(market.yesPrice * 100).toFixed(1)}%`, price: market.yesPrice,
  });
}

export class UnifiedInstrumentService {
  async search(query: string): Promise<InstrumentSearchResult[]> {
    const q = clean(query);
    if (!q) return [];
    const parsed = parseInstrumentQuery(q);
    const [stocks, crypto] = await Promise.all([
      parsed?.type === 'crypto' ? Promise.resolve([]) : searchStocks(q),
      searchCrypto(q),
    ]);
    const radar = getCachedPredictionRadarSlice(q, 12);
    const predictions = (radar?.markets || []).map(predictionResult);
    return dedupeInstrumentRefs([...stocks, ...crypto, ...predictions]).slice(0, 20) as InstrumentSearchResult[];
  }

  async overview(ref: InstrumentRef): Promise<UnifiedInstrumentOverview> {
    const normalized = normalizeInstrumentRef(ref as InstrumentInput);
    const cached = overviewCache.get(normalized.id);
    if (cached && Date.now() - cached.at <= OVERVIEW_CACHE_TTL_MS) return cached.value;
    const emptyAnalysis = { status: 'unavailable' as const, text: 'AI 分析暂不可用，其他行情数据不受影响。', updatedAt: new Date().toISOString(), cached: false };
    let quote: Record<string, unknown> | null = null;
    let marketData: Record<string, unknown> | null = null;
    let klines: unknown[] = [];
    let fetchedAt: string | null = null;
    const sourceStatus: Record<string, 'ok' | 'stale' | 'unavailable'> = { quote: 'unavailable', market: 'unavailable', klines: 'unavailable', events: 'unavailable', news: 'unavailable' };
    try {
      if (normalized.type === 'crypto') {
        const ticker = await binanceFeed.getPrice(normalized.symbol);
        if (ticker) { quote = ticker as unknown as Record<string, unknown>; fetchedAt = new Date().toISOString(); sourceStatus.quote = 'ok'; }
        klines = await binanceFeed.getKlines(normalized.symbol, '1h', 100);
        if (klines.length) sourceStatus.klines = 'ok';
      } else if (normalized.type === 'prediction') {
        const radar = getCachedPredictionRadarSlice('', 100) || await getPredictionRadar('', 100);
        const market = radar.markets.find(item => String(item.id) === normalized.symbol);
        if (market) { marketData = market as unknown as Record<string, unknown>; quote = { yesPrice: market.yesPrice, noPrice: market.noPrice, modelProbability: market.modelProbability }; fetchedAt = radar.updatedAt; sourceStatus.market = 'ok'; sourceStatus.quote = 'ok'; }
      } else {
        const response = await fetch(`https://qt.gtimg.cn/q=us${normalized.symbol}`, { signal: AbortSignal.timeout(8000) });
        const stock = stockFromTencent(await response.text());
        if (stock) { quote = stock as unknown as Record<string, unknown>; fetchedAt = new Date().toISOString(); sourceStatus.quote = 'ok'; }
      }
    } catch { /* each source is independently optional */ }
    const [eventsResult, newsResult] = await Promise.allSettled([getUpcomingEventCalendar(7), newsFeed.getNews()]);
    const events = eventsResult.status === 'fulfilled' ? eventsResult.value.events : [];
    const news = newsResult.status === 'fulfilled' ? newsResult.value : [];
    if (eventsResult.status === 'fulfilled') sourceStatus.events = 'ok';
    if (newsResult.status === 'fulfilled' && news.length) sourceStatus.news = 'ok';
    const base: UnifiedInstrumentOverview = {
      instrument: normalized, quote, marketData, klines, events, news, analysis: emptyAnalysis,
      freshness: freshnessStatus(fetchedAt, normalized.type === 'crypto' ? 30_000 : 5 * 60_000), sourceStatus,
    };
    base.analysis = await getInstrumentAnalysis(normalized, base);
    overviewCache.set(normalized.id, { at: Date.now(), value: base });
    return base;
  }

  async timeline(ref: InstrumentRef): Promise<{ instrument: InstrumentRef; items: Array<Record<string, unknown>>; generatedAt: string }> {
    const overview = await this.overview(ref);
    const items = [
      ...overview.events.map(event => ({ kind: 'event', at: event.date, title: event.titleZh || event.title, impact: event.impact, result: event.actual ? { actual: event.actual, forecast: event.forecast } : null })),
      ...overview.news.map(item => ({ kind: 'news', at: item.publishedAt, title: item.title, source: item.source, url: item.url, sentimentScore: item.sentimentScore ?? null })),
    ].sort((a, b) => new Date(String(b.at)).getTime() - new Date(String(a.at)).getTime());
    return { instrument: overview.instrument, items, generatedAt: new Date().toISOString() };
  }
}

async function getInstrumentAnalysis(ref: InstrumentRef, overview: Omit<UnifiedInstrumentOverview, 'analysis'>): Promise<UnifiedInstrumentOverview['analysis']> {
  const cached = analysisCache.get(ref.id);
  if (cached && Date.now() - cached.at <= UNIFIED_AI_CACHE_TTL_MS) return { ...cached.value, cached: true };
  const runtime = getAiRuntimeConfig('openrouter');
  if (!runtime.configured) return { status: 'unavailable', text: '未配置 AI 密钥；行情、事件和新闻仍可正常查看。', updatedAt: new Date().toISOString(), cached: false };
  try {
    const payload = { model: runtime.model, messages: [
      { role: 'system', content: '你是谨慎的中文市场研究助手，只根据给定数据分析，不给出保证收益或自动下单建议。' },
      { role: 'user', content: JSON.stringify({ instrument: ref, quote: overview.quote, marketData: overview.marketData, events: overview.events.slice(0, 5), news: overview.news.slice(0, 5) }) },
    ], max_tokens: 500, temperature: 0.2 };
    const response = await fetch(runtime.apiUrl, { method: 'POST', headers: { authorization: `Bearer ${runtime.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => null) as any;
    const text = String(body?.choices?.[0]?.message?.content || '').trim();
    if (!response.ok || !text) throw new Error('AI 没有返回分析');
    const value = { status: 'ready' as const, text, model: runtime.model, updatedAt: new Date().toISOString(), cached: false };
    analysisCache.set(ref.id, { at: Date.now(), value });
    return value;
  } catch {
    return { status: 'unavailable', text: 'AI 分析暂时失败，其他行情数据不受影响。', updatedAt: new Date().toISOString(), cached: false };
  }
}

export const unifiedInstrumentService = new UnifiedInstrumentService();

export function tickerToQuote(ticker: BinanceTicker): Record<string, unknown> { return { ...ticker }; }
