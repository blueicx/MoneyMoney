import { binanceFeed, type BinanceTicker } from './binance';
import type { NewsItem } from './news-settings';
import { getStockNewsSnapshot } from './stock-news';
import { getUpcomingEventCalendar, type UpcomingEvent } from './event-calendar';
import { getCachedPredictionRadarSlice, getPredictionRadar, type PredictionMarket } from './prediction-radar';
import { getAiRuntimeConfig } from './ai-runtime-config';
import { filterInstrumentResults, type MarketScope } from './market-scope';
import { stockDataService } from './stock-data-service';
import { getEquityOptionsSnapshot } from './options-market';
import type { StockFiling } from './stock-data-contracts';

export type InstrumentType = 'stock' | 'option' | 'crypto' | 'prediction';

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

export type InstrumentSectionStatus = 'live' | 'cached' | 'degraded' | 'unavailable';
export type InstrumentSourceStatus = 'ok' | 'stale' | 'partial' | 'unavailable';

export interface InstrumentOverviewSection {
  id: 'quote' | 'history' | 'events' | 'news' | 'analysis' | 'timeline';
  label: string;
  status: InstrumentSectionStatus;
  reason?: string;
}

export interface OverviewDataStatus {
  state: InstrumentSectionStatus;
  reason: string | null;
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
  sourceStatus: Record<string, InstrumentSourceStatus>;
  sectionReasons?: Partial<Record<InstrumentOverviewSection['id'] | 'filings', string>>;
  sections: InstrumentOverviewSection[];
  timeline: Array<Record<string, unknown>>;
  status: OverviewDataStatus;
}

export const UNIFIED_AI_CACHE_TTL_MS = 15 * 60_000;
const OVERVIEW_CACHE_TTL_MS = 60_000;
const overviewCache = new Map<string, { at: number; value: UnifiedInstrumentOverview }>();
const analysisCache = new Map<string, { at: number; value: UnifiedInstrumentOverview['analysis'] }>();

type InstrumentInput = Partial<InstrumentRef> & { type: InstrumentType; venue: string; symbol: string };

function clean(value: unknown): string { return String(value ?? '').trim(); }

function normalizedVenue(type: InstrumentType, venue: string): string {
  if (type === 'stock') return clean(venue || 'us').toLowerCase();
  if (type === 'option') return clean(venue || 'cboe').toLowerCase();
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
  const canonical = value.match(/^(stock|option|crypto|prediction):([^:]+):(.+)$/i);
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

export function overviewDataStatus(sourceStatus: Record<string, InstrumentSourceStatus>): OverviewDataStatus {
  const statuses = Object.values(sourceStatus);
  const hasOk = statuses.includes('ok');
  const hasStale = statuses.includes('stale');
  const hasPartial = statuses.includes('partial');
  const hasUnavailable = statuses.includes('unavailable');
  if (!hasOk && hasStale && !hasPartial && !hasUnavailable) return { state: 'cached', reason: '当前仅有缓存数据' };
  if (!hasOk) return { state: hasPartial ? 'degraded' : hasStale ? 'cached' : 'unavailable', reason: hasPartial ? '部分来源可用或数据缺失' : '当前没有可用数据源' };
  if (hasStale || hasUnavailable || hasPartial) return { state: 'degraded', reason: '部分数据源不可用、部分成功或已过期' };
  return { state: 'live', reason: null };
}

export function summarizeTimelineAvailability(input: {
  market: MarketScope;
  itemCount: number;
  sourceStatus: Record<string, InstrumentSourceStatus>;
  sectionReasons?: Partial<Record<InstrumentOverviewSection['id'] | 'filings' | 'secForm4' | 'sec13f', string>>;
}): { dataStatus: 'live' | 'cached' | 'partial' | 'empty' | 'unavailable' | 'unsupported'; reason: string | null; sourceStatuses: Record<string, InstrumentSourceStatus> } {
  const sourceKeys = ['events', 'news', 'filings', 'secForm4', 'sec13f'] as const;
  const sourceStatuses = Object.fromEntries(sourceKeys
    .filter(key => input.sourceStatus[key])
    .map(key => [key, input.sourceStatus[key]])) as Record<string, InstrumentSourceStatus>;
  if (input.market !== 'stocks') {
    return { dataStatus: 'unsupported', reason: input.sectionReasons?.events || '当前市场不支持标的事件与新闻时间线', sourceStatuses };
  }
  const statuses = Object.values(sourceStatuses);
  const good = statuses.filter(status => status === 'ok' || status === 'stale').length;
  const failed = Object.entries(sourceStatuses).filter(([, status]) => status === 'unavailable' || status === 'partial').map(([key]) => key);
  const failureReasons = failed.map(key => `${key}: ${input.sectionReasons?.[key as typeof sourceKeys[number]] || '来源不可用'}`);
  const staleReasons = Object.entries(sourceStatuses)
    .filter(([key, status]) => status === 'stale' && input.sectionReasons?.[key as typeof sourceKeys[number]])
    .map(([key]) => `${key}: ${input.sectionReasons?.[key as typeof sourceKeys[number]]}`);
  const emptyReasons = Object.entries(sourceStatuses)
    .filter(([key, status]) => status === 'ok' && input.sectionReasons?.[key as typeof sourceKeys[number]])
    .map(([key]) => `${key}: ${input.sectionReasons?.[key as typeof sourceKeys[number]]}`);
  const diagnostics = [...failureReasons, ...staleReasons];
  if (input.itemCount > 0) {
    return {
      dataStatus: failed.length ? 'partial' : statuses.includes('ok') ? 'live' : 'cached',
      reason: diagnostics.length ? `${failureReasons.length ? '部分来源不可用；' : ''}${diagnostics.join('；')}` : null,
      sourceStatuses,
    };
  }
  if (good && failed.length) return { dataStatus: 'partial', reason: diagnostics.join('；'), sourceStatuses };
  if (good) {
    const explanations = [...staleReasons, ...emptyReasons];
    return { dataStatus: statuses.includes('stale') ? 'cached' : 'empty', reason: explanations.length ? `来源已响应；${explanations.join('；')}` : '事件与新闻来源已响应，但当前标的没有匹配记录', sourceStatuses };
  }
  const reason = statuses.length
    ? Object.entries(sourceStatuses).map(([key]) => `${key}: ${input.sectionReasons?.[key as typeof sourceKeys[number]] || '来源不可用'}`).join('；')
    : '当前标的没有可核验的事件来源状态';
  return { dataStatus: 'unavailable', reason, sourceStatuses };
}

function sectionStatus(sourceStatus: Record<string, InstrumentSourceStatus>, fallback: 'unavailable' | 'ok' = 'unavailable'): InstrumentSectionStatus {
  const keys = Object.keys(sourceStatus);
  return overviewDataStatus(keys.length ? sourceStatus : { value: fallback }).state;
}

export function buildInstrumentOverviewSections(input: Pick<UnifiedInstrumentOverview, 'quote' | 'marketData' | 'klines' | 'events' | 'news' | 'analysis' | 'sourceStatus'>): InstrumentOverviewSection[] {
  const quoteAvailable = Boolean(input.quote || input.marketData);
  const historyAvailable = Array.isArray(input.klines) && input.klines.length > 0;
  const eventsAvailable = Array.isArray(input.events) && input.events.length > 0;
  const newsAvailable = Array.isArray(input.news) && input.news.length > 0;
  const timelineAvailable = eventsAvailable || newsAvailable;
  return [
    { id: 'quote', label: '行情', status: quoteAvailable ? sectionStatus({ quote: input.sourceStatus.quote || 'unavailable' }) : 'unavailable' },
    { id: 'history', label: '历史', status: historyAvailable ? sectionStatus({ klines: input.sourceStatus.klines || 'unavailable' }) : 'unavailable' },
    { id: 'events', label: '事件', status: eventsAvailable ? sectionStatus({ events: input.sourceStatus.events || 'unavailable' }) : 'unavailable', reason: (input as UnifiedInstrumentOverview).sectionReasons?.events },
    { id: 'news', label: '新闻', status: newsAvailable ? sectionStatus({ news: input.sourceStatus.news || 'unavailable' }) : 'unavailable', reason: (input as UnifiedInstrumentOverview).sectionReasons?.news },
    { id: 'analysis', label: 'AI 分析', status: input.analysis.status === 'ready' ? 'live' : 'unavailable' },
    { id: 'timeline', label: '时间线', status: timelineAvailable ? 'live' : 'unavailable' },
  ];
}

/**
 * The general event calendar contains macro and all-company rows. An
 * instrument detail view must never copy that whole calendar into every
 * stock. Only earnings whose canonical event identity belongs to the selected
 * symbol are relevant here; other markets currently have no instrument event
 * adapter and therefore return an explicit empty list.
 */
export function filterEventsForInstrument<T extends Pick<UpcomingEvent, 'id' | 'title' | 'category'>>(
  events: T[],
  ref: Pick<InstrumentRef, 'type' | 'symbol'>,
): T[] {
  if (ref.type !== 'stock') return [];
  const symbol = clean(ref.symbol).toUpperCase();
  if (!symbol) return [];
  return events.filter(event => {
    if (event.category !== 'earnings') return false;
    const title = clean(event.title).toUpperCase();
    const id = clean(event.id).toUpperCase();
    return title.startsWith(`${symbol} `) || id.endsWith(`-${symbol}`);
  });
}

export function buildInstrumentTimeline(events: UpcomingEvent[], news: NewsItem[], filings: StockFiling[] = []): Array<Record<string, unknown>> {
  return [
    ...events.map(event => ({ kind: 'event', at: event.date, occurredAt: event.date, publishedAt: null, title: event.titleZh || event.title, impact: event.impact, result: event.actual ? { actual: event.actual, forecast: event.forecast } : null })),
    ...news.map(item => ({ kind: 'news', at: item.publishedAt, occurredAt: item.publishedAt, publishedAt: item.publishedAt, title: item.title, source: item.source, url: item.url, sentimentScore: item.sentimentScore ?? null })),
    ...filings.slice(0, 30).map(filing => ({ kind: 'event', at: filing.acceptedAt || filing.filingDate, occurredAt: filing.acceptedAt || filing.filingDate, publishedAt: filing.acceptedAt || null, title: `SEC ${filing.form} · ${filing.accessionNumber}`, source: 'SEC EDGAR', url: filing.reportUrl || null })),
  ].sort((a, b) => new Date(String(b.at)).getTime() - new Date(String(a.at)).getTime());
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
  ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'NVIDIA'], ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet'], ['META', 'Meta'], ['TSLA', 'Tesla'],
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

async function searchOptions(query: string): Promise<InstrumentSearchResult[]> {
  const parsed = parseInstrumentQuery(query);
  const raw = parsed?.type === 'option' ? parsed.symbol.split(':')[0] : query;
  const symbol = clean(raw).replace(/[^A-Za-z0-9.-]/g, '').toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return [];
  try {
    const snapshot = await getEquityOptionsSnapshot(symbol);
    return [normalizeSearchResult({
      type: 'option', venue: 'cboe', symbol: snapshot.asset || symbol,
      title: `${snapshot.asset || symbol} 期权`, aliases: [symbol], subtitle: snapshot.source,
      price: snapshot.spot, changePct: snapshot.quote?.changePercent,
    })];
  } catch {
    return [];
  }
}

function predictionResult(market: PredictionMarket): InstrumentSearchResult {
  return normalizeSearchResult({
    type: 'prediction', venue: 'predictfun', symbol: String(market.id), marketId: String(market.id), title: market.titleZh || market.title,
    aliases: [market.title, market.platform], subtitle: `${market.platform} · YES ${(market.yesPrice * 100).toFixed(1)}%`, price: market.yesPrice,
  });
}

export class UnifiedInstrumentService {
  async search(query: string, scope: MarketScope = 'overview'): Promise<InstrumentSearchResult[]> {
    const q = clean(query);
    if (!q) return [];
    const parsed = parseInstrumentQuery(q);
    const [stocks, crypto, options] = await Promise.all([
      parsed?.type === 'crypto' || parsed?.type === 'option' ? Promise.resolve([]) : searchStocks(q),
      searchCrypto(q),
      scope === 'options' || parsed?.type === 'option' ? searchOptions(q) : Promise.resolve([]),
    ]);
    const radar = getCachedPredictionRadarSlice(q, 12);
    const predictions = (radar?.markets || []).map(predictionResult);
    const deduped = dedupeInstrumentRefs([...stocks, ...options, ...crypto, ...predictions]) as InstrumentSearchResult[];
    return filterInstrumentResults(deduped, scope).slice(0, 20);
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
    const sourceStatus: Record<string, InstrumentSourceStatus> = { quote: 'unavailable', market: 'unavailable', klines: 'unavailable', events: 'unavailable', news: 'unavailable', filings: 'unavailable' };
    let filings: StockFiling[] = [];
    let filingsReason: string | undefined;
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
      } else if (normalized.type === 'option') {
        const snapshot = await getEquityOptionsSnapshot(normalized.symbol);
        quote = {
          price: snapshot.spot,
          change: snapshot.quote?.change ?? null,
          changePct: snapshot.quote?.changePercent ?? null,
          volume: snapshot.quote?.volume ?? null,
          iv30Pct: snapshot.quote?.iv30Pct ?? null,
        };
        marketData = {
          source: snapshot.source,
          asset: snapshot.asset,
          totalCallOpenInterest: snapshot.totalCallOpenInterest,
          totalPutOpenInterest: snapshot.totalPutOpenInterest,
          totalPutCallOIRatio: snapshot.totalPutCallOIRatio,
          expiries: snapshot.expiries,
        };
        fetchedAt = snapshot.fetchedAt;
        sourceStatus.quote = 'ok';
        sourceStatus.market = 'ok';
      } else {
        const stockData = await stockDataService.overview(normalized.symbol);
        if (stockData.quote) {
          quote = stockData.quote as unknown as Record<string, unknown>;
          fetchedAt = stockData.quote.asOf || stockData.snapshots.map(item => item.fetchedAt).filter(Boolean).sort().pop() || new Date().toISOString();
        }
        klines = stockData.bars;
        filings = stockData.filings;
        sourceStatus.quote = stockStatus(stockData.sourceStatus['nasdaq-public-quote']);
        sourceStatus.klines = stockStatus(stockData.sourceStatus['nasdaq-public-history']);
        sourceStatus.filings = stockStatus(stockData.sourceStatus['sec-edgar-submissions']);
        filingsReason = stockData.snapshots.find(item => item.source === 'sec-edgar-submissions' && item.error)?.error ||
          (sourceStatus.filings === 'unavailable' ? 'SEC EDGAR 申报来源不可用' : filings.length ? undefined : 'SEC 已响应，但没有匹配申报');
      }
    } catch { /* each source is independently optional */ }
    const newsPromise = normalized.type === 'stock'
      ? getStockNewsSnapshot(normalized.symbol)
      : Promise.resolve({ items: [] as NewsItem[], status: 'live' as const, updatedAt: null, retrievedAt: new Date().toISOString(), source: 'unsupported' as const });
    const eventsPromise = normalized.type === 'stock'
      ? getUpcomingEventCalendar(7)
      : Promise.resolve({ events: [] as UpcomingEvent[], stale: false, sourceStatus: undefined, sourceReasons: undefined });
    const [eventsResult, newsResult] = await Promise.allSettled([eventsPromise, newsPromise]);
    const allEvents = eventsResult.status === 'fulfilled' ? eventsResult.value.events : [];
    const events = filterEventsForInstrument(allEvents, normalized);
    const newsSnapshot = newsResult.status === 'fulfilled' ? newsResult.value : null;
    const news = newsSnapshot?.items || [];
    if (normalized.type === 'stock') {
      const calendarState = eventsResult.status === 'fulfilled' ? eventsResult.value.sourceStatus?.earnings : null;
      sourceStatus.events = eventsResult.status !== 'fulfilled' ? 'unavailable'
        : calendarState === 'partial' ? 'partial'
          : calendarState === 'unavailable' ? 'unavailable'
            : calendarState === 'cached' || eventsResult.value.stale ? 'stale' : 'ok';
    }
    if (normalized.type === 'stock') sourceStatus.news = newsSnapshot ? newsSnapshot.status === 'cached' ? 'stale' : 'ok' : 'unavailable';
    let eventsReason: string | undefined;
    if (eventsResult.status === 'rejected') eventsReason = String(eventsResult.reason instanceof Error ? eventsResult.reason.message : eventsResult.reason || '事件来源不可用，请稍后重试');
    else if (normalized.type !== 'stock') eventsReason = '当前市场暂不支持标的事件日历';
    else if (eventsResult.value.sourceReasons?.earnings) eventsReason = eventsResult.value.sourceReasons.earnings;
    else if (sourceStatus.events === 'partial') eventsReason = 'Nasdaq 财报日历部分日期请求失败';
    else if (sourceStatus.events === 'unavailable') eventsReason = 'Nasdaq 财报日历来源不可用';
    else if (eventsResult.value.stale || sourceStatus.events === 'stale') eventsReason = '事件日历当前显示最近缓存';
    else if (!events.length) eventsReason = `暂无 ${normalized.symbol} 的财报事件`;
    const sectionReasons: UnifiedInstrumentOverview['sectionReasons'] = {
      events: eventsReason,
      news: newsResult.status === 'rejected'
        ? String(newsResult.reason instanceof Error ? newsResult.reason.message : newsResult.reason || '新闻来源不可用，请稍后重试')
        : newsSnapshot?.status === 'cached' ? 'Yahoo Finance 新闻显示最近一次成功抓取缓存'
        : news.length
          ? undefined
          : normalized.type === 'stock' ? `暂无 ${normalized.symbol} 的相关新闻` : '当前市场暂不支持标的新闻',
      filings: filingsReason,
    };
    const base: UnifiedInstrumentOverview = {
      instrument: normalized, quote, marketData, klines, events, news, analysis: emptyAnalysis, sectionReasons,
      freshness: freshnessStatus(fetchedAt, normalized.type === 'crypto' ? 30_000 : 5 * 60_000), sourceStatus,
      sections: [], timeline: [], status: overviewDataStatus(sourceStatus),
    };
    base.analysis = await getInstrumentAnalysis(normalized, base);
    base.timeline = buildInstrumentTimeline(events, news, filings);
    base.sections = buildInstrumentOverviewSections(base);
    overviewCache.set(normalized.id, { at: Date.now(), value: base });
    return base;
  }

  async timeline(ref: InstrumentRef): Promise<{ instrument: InstrumentRef; items: Array<Record<string, unknown>>; generatedAt: string; sourceStatus: UnifiedInstrumentOverview['sourceStatus']; sectionReasons?: UnifiedInstrumentOverview['sectionReasons'] }> {
    const overview = await this.overview(ref);
    return { instrument: overview.instrument, items: overview.timeline, generatedAt: new Date().toISOString(), sourceStatus: { ...overview.sourceStatus }, sectionReasons: { ...overview.sectionReasons } };
  }
}

function stockStatus(status: string | undefined): UnifiedInstrumentOverview['sourceStatus'][string] {
  if (status === 'fresh') return 'ok';
  if (status === 'stale') return 'stale';
  return 'unavailable';
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
