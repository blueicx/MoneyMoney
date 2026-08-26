/**
 * Cross-platform prediction market radar.
 *
 * The goal is a single, keyless read-only view over open trading venues plus
 * Good Judgment Open's public crowd forecasts. Trading remains disabled here:
 * public endpoints are used only for research, ranking, and screening.
 */

export interface PredictionMarket {
  platform: 'Polymarket' | 'Kalshi' | 'Manifold' | 'Good Judgment Open' | 'Metaculus';
  id: string;
  title: string;
  category: string;
  group: string;
  outcome: string;
  url?: string;
  yesPrice: number;
  noPrice: number;
  bid?: number;
  ask?: number;
  spread?: number;
  volume24h: number;
  volumeTotal: number;
  liquidity: number;
  endDate?: string;
  activityScore: number;
  internalEdge: number;
  modelProbability: number;
  probabilityConfidence: number;
  probabilityZh: string;
  consensusProbability?: number;
  consensusPlatforms?: number;
  titleZh?: string;
  summaryZh?: string;
  signalZh?: string;
  categoryZh?: string;
  weatherForecast?: import('./weather-forecast').WeatherForecastEvidence;
  participantCount?: number;
  forecastCount?: number;
}

export interface PredictionOpportunity {
  platformA: string;
  platformB: string;
  title: string;
  titleB?: string;
  titleZh?: string;
  edge: number;
  confidence: number;
  priceA: number;
  priceB: number;
  urlA?: string;
  urlB?: string;
}

export interface PredictionRadar {
  updatedAt: string;
  markets: PredictionMarket[];
  opportunities: PredictionOpportunity[];
  sources: Record<'polymarket' | 'kalshi' | 'manifold' | 'gjopen' | 'metaculus' | 'weather', {
    ok: boolean;
    count: number;
    error?: string;
    latencyMs?: number;
    checkedAt?: string;
  }>;
}

type PredictionMarketSeed = Omit<
  PredictionMarket,
  'activityScore' | 'internalEdge' | 'modelProbability' | 'probabilityConfidence' | 'probabilityZh'
>;

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { attachWeatherForecastEvidence } from './weather-forecast';
import { translateEnglishTitles } from './market-translation';
import { recordPredictionHistory } from './prediction-history';
import { recordForecastLab } from './forecast-lab';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 180_000;
let cache: CacheEntry<PredictionRadar> | null = null;

// Disk snapshot lets a fresh launch serve the last good radar instantly while
// the background warm-up fetches live data.
const RADAR_SNAPSHOT_FILE = path.join(process.cwd(), 'data', 'prediction-radar-snapshot.json');

(function loadRadarSnapshot() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RADAR_SNAPSHOT_FILE, 'utf8')) as PredictionRadar;
    if (Array.isArray(parsed.markets) && parsed.markets.length && typeof parsed.updatedAt === 'string') {
      cache = { value: parsed, expiresAt: 0 };
    }
  } catch {
    // No snapshot yet; the first open will build it.
  }
})();

async function saveRadarSnapshot(radar: PredictionRadar): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(RADAR_SNAPSHOT_FILE), { recursive: true });
    await fs.promises.writeFile(RADAR_SNAPSHOT_FILE, JSON.stringify(radar), 'utf8');
  } catch {
    // Snapshot writing is best-effort only.
  }
}

async function getJson(url: string, timeoutMs = 10_000): Promise<any> {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'MoneyMoney/1.0 (+https://github.com/blueicx/MoneyMoney)',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function getCurlJson(url: string): Promise<any> {
  const command = process.platform === 'win32' ? 'curl.exe' : 'curl';
  return new Promise((resolve, reject) => {
    execFile(
      command,
      ['--silent', '--show-error', '--location', '--max-time', '20', '--header', 'accept: application/json', url],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 22_000 },
      (error, stdout) => {
        if (error) { reject(error); return; }
        try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
      },
    );
  });
}

/**
 * Some local networks / regions block prediction-market hosts. AllOrigins is a
 * public read-only relay; it is a fallback, never the primary path.
 */
async function getJsonWithRelayFallback(url: string): Promise<any> {
  const relay = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  try {
    return await getJson(url);
  } catch (directError) {
    // Some TLS stacks are blocked while the local OS curl client still works.
    try {
      return await getCurlJson(url);
    } catch { /* fall through to the relay */ }
    // The public relay occasionally returns a transient 5xx on the first hop.
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await getJson(relay, 20_000);
      } catch (relayError) {
        lastError = relayError;
      }
  }
  throw lastError ?? directError ?? new Error('All network paths failed');
}
}

/**
 * Supplemental sweeps must not make the whole radar feel stuck. They accept a
 * shorter timeout and skip the slower OS-curl fallback used by primary feeds.
 */
async function getJsonWithQuickRelay(url: string): Promise<any> {
  try {
    return await getJson(url, 5_000);
  } catch {
    return getJson(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, 12_000);
  }
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampProbability(value: unknown, fallback = 0.5): number {
  const parsed = number(value, fallback);
  return Math.min(1, Math.max(0, parsed));
}

function parseJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyGroup(text: string): string {
  const value = text.toLowerCase();
  if (/(room[- ]temperature|superconductor|superconductive|weathering)/.test(value)) {
    if (!/(hurricane|snowfall|rainfall|tornado|heat wave)/.test(value)) return '科技与健康';
  }
  if (/(weather|temperature|rainfall|snowfall|snow|hurricane|tropical storm|cyclone|tornado|heat wave|precipitation|high temp|climate)/.test(value)) return '天气';
  if (/(bitcoin|btc|ethereum|eth\b|crypto|solana|xrp|doge|binance|token)/.test(value)) return '加密';
  if (/(election|senate|congress|president|parliament|party|vote|governor|proposition)/.test(value)) return '政治';
  if (/(fed\b|interest rate|inflation|gdp|unemployment|recession|earnings|treasury|central bank|market)/.test(value)) return '经济';
  if (/(war|russia|ukraine|israel|iran|china|taiwan|nato|ceasefire|geopolit)/.test(value)) return '地缘';
  if (/(nfl|nba|mlb|nhl|soccer|football|basketball|baseball|cricket|match|cup|game|draft)/.test(value)) return '体育';
  if (/(ai\b|artificial intelligence|space|vaccine|science|climate|launch|drug|approval)/.test(value)) return '科技与健康';
  return '综合';
}

function normalizePolymarketMarket(row: any): PredictionMarket | null {
  const prices = parseJsonArray(row.outcomePrices).map((item) => number(item, NaN));
  const outcomeNames = parseJsonArray(row.outcomes).map((item) => String(item));
  const binaryYesNo = outcomeNames.length === 2 &&
    /^yes$/i.test(outcomeNames[0] || '') &&
    /^no$/i.test(outcomeNames[1] || '');
  // Multi-way sports markets are separate rows; treating the first leg as
  // YES would make probability and arbitrage math misleading.
  if (!binaryYesNo) return null;
  const yesPrice = clampProbability(
    Number.isFinite(prices[0]) ? prices[0] : ((number(row.bestAsk, 50) + number(row.bestBid, 50)) / 2),
    0.5,
  );
  const bid = row.bestBid == null ? undefined : clampProbability(row.bestBid);
  const ask = row.bestAsk == null ? undefined : clampProbability(row.bestAsk);
  const base = {
    platform: 'Polymarket' as const,
    id: String(row.id ?? row.conditionId ?? row.slug ?? row.question),
    title: String(row.question || row.title || 'Untitled Polymarket market'),
    category: String(row.category || row.events?.[0]?.title || 'General'),
    group: classifyGroup(`${row.category || ''} ${row.question || row.title || ''}`),
    outcome: 'YES',
    url: row.slug ? `https://polymarket.com/market/${row.slug}` : undefined,
    yesPrice,
    noPrice: 1 - yesPrice,
    bid,
    ask,
    spread: bid != null && ask != null ? Math.max(0, ask - bid) : undefined,
    volume24h: Math.max(0, number(row.volume24hr)),
    volumeTotal: Math.max(0, number(row.volumeNum ?? row.volume)),
    liquidity: Math.max(0, number(row.liquidityNum ?? row.liquidity)),
    endDate: row.endDate ? String(row.endDate) : undefined,
  };
  return { ...base, ...finishMarket(base) };
}

function activityScore(market: PredictionMarketSeed): number {
  const volume = Math.log10(1 + Math.max(0, market.volume24h)) * 2;
  const liquidity = Math.log10(1 + Math.max(0, market.liquidity));
  const totalVolume = Math.log10(1 + Math.max(0, market.volumeTotal)) * 0.4;
  const participation = Math.log10(1 + (market.participantCount || 0)) * 1.1
    + Math.log10(1 + (market.forecastCount || 0)) * 0.8;
  const spreadPenalty = market.spread && market.spread > 0 ? market.spread * 45 : 0;
  // Favor active, liquid markets but keep very one-sided markets discoverable.
  const balanceBonus = 1 - Math.abs(market.yesPrice - 0.5) * 0.7;
  return Number((volume + liquidity + totalVolume + participation + balanceBonus - spreadPenalty).toFixed(3));
}

function probabilityJudgment(base: PredictionMarketSeed) {
  const evidence = Math.log10(1 + Math.max(0, base.volume24h))
    + Math.log10(1 + Math.max(0, base.liquidity)) * 0.9
    + Math.log10(1 + Math.max(0, base.volumeTotal)) * 0.35
    + Math.log10(1 + (base.participantCount || 0)) * 1.1
    + Math.log10(1 + (base.forecastCount || 0)) * 0.7
    - (base.spread || 0) * 12;
  const weight = Math.min(0.94, Math.max(0.18, evidence / (evidence + 2.4)));
  const modelProbability = clampProbability(
    0.5 + (base.yesPrice - 0.5) * weight,
    base.yesPrice,
  );
  const confidence = Math.round(Math.min(90, Math.max(34,
    36 + evidence * 8 - (base.spread || 0) * 70)));
  const gapPct = Math.abs(modelProbability - base.yesPrice) * 100;
  const probabilityZh = gapPct >= 7
    ? `活动证据不足，模型收敛到 ${Math.round(modelProbability * 100)}%`
    : gapPct >= 3
      ? `轻度流动性修正：${Math.round(modelProbability * 100)}%`
      : `市场定价可信：${Math.round(modelProbability * 100)}%`;
  return { modelProbability, probabilityConfidence: confidence, probabilityZh };
}

async function getPolymarkets(limit: number): Promise<PredictionMarket[]> {
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(Math.min(200, limit) / pageSize));
  const pageResults = await Promise.allSettled(Array.from({ length: pageCount }, (_, page) => {
    const params = new URLSearchParams({
      closed: 'false',
      active: 'true',
      archived: 'false',
      limit: String(pageSize),
      offset: String(page * pageSize),
      order: 'volume24hr',
      ascending: 'false',
    });
    return getJsonWithQuickRelay(`https://gamma-api.polymarket.com/markets?${params}`);
  }));
  const payloads = pageResults.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<any>).value);
  if (!payloads.length) throw new Error(pageResults[0]?.status === 'rejected' ? String(pageResults[0].reason?.message || pageResults[0].reason) : 'No pages');
  const seen = new Set<string>();
  const rows: any[] = payloads.flatMap(payload => Array.isArray(payload) ? payload : [])
    .filter(row => {
      const id = String(row.id ?? row.conditionId ?? row.slug ?? row.question);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

  return rows.map(normalizePolymarketMarket).filter((item): item is PredictionMarket => item != null);
}

function kalshiPrice(centField?: unknown, dollarField?: unknown): number | undefined {
  if (dollarField != null && Number.isFinite(number(dollarField, NaN))) return number(dollarField);
  if (centField == null || !Number.isFinite(number(centField, NaN))) return undefined;
  return number(centField) / 100;
}

function normalizeKalshiMarket(row: any): PredictionMarket {
  const yesBid = kalshiPrice(row.yes_bid, row.yes_bid_dollars)!;
  const yesAsk = kalshiPrice(row.yes_ask, row.yes_ask_dollars)!;
  const last = kalshiPrice(row.last_price, row.last_price_dollars) ?? NaN;
  let yesPrice = Number.isFinite(yesAsk) && Number.isFinite(yesBid)
    ? (yesAsk + yesBid) / 2
    : Number.isFinite(last) ? last : 0.5;
  yesPrice = clampProbability(yesPrice);
  const bid = Number.isFinite(yesBid) ? clampProbability(yesBid) : undefined;
  const ask = Number.isFinite(yesAsk) ? clampProbability(yesAsk) : undefined;
  const noAsk = kalshiPrice(row.no_ask, row.no_ask_dollars);
  const ticker = String(row.ticker || row.id);
  const base = {
    platform: 'Kalshi' as const,
    id: ticker,
    title: String(row.title || row.market_subtitle || ticker),
    category: String(row.event_ticker || row.category || 'General'),
    group: classifyGroup(`${row.category || ''} ${row.title || row.market_subtitle || ticker}`),
    outcome: 'YES',
    url: `https://kalshi.com/markets?search=${encodeURIComponent(ticker)}`,
    yesPrice,
    noPrice: 1 - yesPrice,
    bid,
    ask,
    spread: bid != null && ask != null ? Math.max(0, ask - bid) : undefined,
    volume24h: Math.max(0, kalshiPrice(row.volume_24h, row.volume_24h_fp) ?? 0),
    volumeTotal: Math.max(0, kalshiPrice(row.volume, row.volume_fp) ?? 0),
    liquidity: Math.max(0, kalshiPrice(row.open_interest, row.liquidity_dollars) ?? 0),
    endDate: row.close_time ? String(row.close_time) : undefined,
  };
  const internalEdge = noAsk != null && Number.isFinite(noAsk) && Number.isFinite(yesAsk)
    ? Math.max(0, 1 - yesAsk - noAsk)
    : 0;
  return { ...base, ...finishMarket(base), internalEdge };
}

async function getKalshiMarkets(limit: number): Promise<PredictionMarket[]> {
  const rows: any[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  // Three pages give much wider event coverage while keeping regional outages short.
  for (let page = 0; page < 3; page++) {
    const params = new URLSearchParams({
      status: 'open',
      limit: String(Math.min(200, Math.max(50, Math.ceil(limit / 3)))),
    });
    if (cursor) params.set('cursor', cursor);
    const productionUrl = `https://api.elections.kalshi.com/trade-api/v2/markets?${params}`;
    const demoUrl = `https://demo-api.kalshi.co/trade-api/v2/markets?${params}`;
    let payload: any;
    try {
      payload = await getJson(productionUrl, 4_000);
    } catch {
      payload = await getJson(demoUrl, 15_000);
    }
    for (const row of Array.isArray(payload?.markets) ? payload.markets : []) {
      const id = String(row.ticker || row.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
    }
    cursor = payload?.cursor ? String(payload.cursor) : undefined;
    if (!cursor) break;
  }

  return rows.map(normalizeKalshiMarket);
}

function normalizeManifoldMarket(row: any): PredictionMarket | null {
  if (row?.outcomeType !== 'BINARY' || row?.isResolved === true) return null;
  const yesPrice = clampProbability(row.probability);
  const base = {
    platform: 'Manifold' as const,
    id: String(row.id),
    title: String(row.question || 'Untitled Manifold market'),
    category: String(row.groupName || row.tags?.[0] || 'General'),
    group: classifyGroup(`${row.groupName || ''} ${row.tags?.join(' ') || ''} ${row.question || ''}`),
    outcome: 'YES',
    url: row.url ? String(row.url) : undefined,
    yesPrice,
    noPrice: 1 - yesPrice,
    spread: undefined,
    volume24h: Math.max(0, number(row.volume24Hours)),
    volumeTotal: Math.max(0, number(row.volume)),
    liquidity: Math.max(0, number(row.liquidity ?? row.totalLiquidity)),
    endDate: row.closeTime ? new Date(Number(row.closeTime)).toISOString() : undefined,
  };
  return { ...base, ...finishMarket(base), internalEdge: 0 };
}

async function getManifoldMarkets(limit: number): Promise<PredictionMarket[]> {
  const params = new URLSearchParams({
    limit: String(Math.min(500, limit)),
    sort: 'last-bet-time',
  });
  const rows: any[] = await getJson(`https://api.manifold.markets/v0/markets?${params}`);
  return rows.map(normalizeManifoldMarket).filter((item): item is PredictionMarket => item != null);
}

function metaculusProbability(row: any): number {
  const candidates = [
    row?.community_prediction?.full?.q2,
    row?.community_prediction?.q2,
    row?.aggregations?.recency_weighted?.centers?.latest,
    row?.aggregations?.recency_weighted?.centers?.yesterday,
    row?.forecast?.center,
  ];
  const value = candidates.find(item => Number.isFinite(Number(item)) && Number(item) > 0 && Number(item) < 1);
  return clampProbability(value, 0.5);
}

async function getMetaculusMarkets(limit = 40): Promise<PredictionMarket[]> {
  // Metaculus made its read API account-gated in 2026. The token is free;
  // without it we deliberately skip the source instead of scraping a page that
  // is protected by an interactive browser challenge.
  const token = (process.env.METACULUS_API_TOKEN || '').trim();
  if (!token) throw new Error('未配置 METACULUS_API_TOKEN（Metaculus 免费账号 Token）');

  const params = new URLSearchParams({
    status: 'open',
    limit: String(Math.min(100, limit)),
    order_by: '-activity',
  });
  const response = await fetch(`https://www.metaculus.com/api2/questions/?${params}`, {
    headers: {
      accept: 'application/json',
      authorization: `Token ${token}`,
      'user-agent': 'Mozilla/5.0 MoneyMoney/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403 ? 'Token 无效或没有读取权限' : `HTTP ${response.status}`);
  }
  const payload = await response.json() as any;
  const rows: any[] = Array.isArray(payload?.results) ? payload.results : [];
  return rows.flatMap(row => {
    const probability = metaculusProbability(row);
    const title = String(row.title || row.question?.title || '').trim();
    if (!title || probability <= 0 || probability >= 1) return [];
    const forecastCount = Math.max(0, number(row.forecast_count ?? row.forecasters));
    const base: PredictionMarketSeed = {
      platform: 'Metaculus',
      id: String(row.id),
      title,
      category: Array.isArray(row.groups) && row.groups[0]?.name ? String(row.groups[0].name) : 'Crowd',
      group: classifyGroup(`${row.groups?.map((item: any) => item?.name).join(' ') || ''} ${title}`),
      outcome: '社区预测',
      url: row.url ? String(row.url) : `https://www.metaculus.com/questions/${row.id}/`,
      yesPrice: probability,
      noPrice: 1 - probability,
      spread: undefined,
      volume24h: 0,
      volumeTotal: forecastCount * 50,
      liquidity: forecastCount * 20,
      endDate: row.effective_resolution_time || row.scheduled_resolution_time,
      participantCount: forecastCount,
      forecastCount,
    };
    return [{ ...base, ...finishMarket(base), internalEdge: 0 }];
  });
}

function isWeatherText(...parts: Array<unknown>): boolean {
  const value = parts.filter(Boolean).join(' ');
  if (/(room[- ]temperature|superconductor|superconductive|weathering)/i.test(value)) return false;
  return /(weather|temperature|rainfall|snowfall|snow|hurricane|tropical storm|cyclone|tornado|heat wave|precipitation|high temp|climate)/i.test(value);
}

async function getWeatherPolymarkets(): Promise<PredictionMarket[]> {
  const marketParams = new URLSearchParams({
    closed: 'false',
    active: 'true',
    archived: 'false',
    tag_slug: 'weather',
    limit: '100',
    order: 'volume24hr',
    ascending: 'false',
  });
  const eventParams = new URLSearchParams({
    closed: 'false',
    active: 'true',
    archived: 'false',
    tag_slug: 'weather',
    limit: '100',
    order: 'volume24hr',
    ascending: 'false',
  });
  const results = await Promise.allSettled([
    getJsonWithQuickRelay(`https://gamma-api.polymarket.com/markets?${marketParams}`),
    getJsonWithQuickRelay(`https://gamma-api.polymarket.com/events?${eventParams}`),
  ]);
  const rows: any[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const payload = result.value;
    if (Array.isArray(payload)) rows.push(...payload);
    for (const event of Array.isArray(payload) ? [] : Array.isArray(payload?.events) ? payload.events : []) {
      for (const market of Array.isArray(event?.markets) ? event.markets : []) {
        rows.push({ ...market, category: market.category || event.title });
      }
    }
  }
  return rows
    .map(normalizePolymarketMarket)
    .filter((item): item is PredictionMarket => item != null && (item.group === '天气' || isWeatherText(item.title, item.category)));
}

async function getWeatherKalshiMarkets(): Promise<PredictionMarket[]> {
  const params = new URLSearchParams({ status: 'open', limit: '1000' });
  // One broad page catches city temperature/rain/snow series without having
  // to maintain a hard-coded list of every Kalshi weather city.
  const payload = await getJsonWithQuickRelay(`https://api.elections.kalshi.com/trade-api/v2/markets?${params}`);
  const rows: any[] = Array.isArray(payload?.markets) ? payload.markets : [];
  return rows
    .filter(row => isWeatherText(row.title, row.market_subtitle, row.event_ticker, row.series_ticker)
      || /^(KX(HIGH|RAIN|SNOW|TEMP|WEA))/i.test(String(row.series_ticker || row.ticker || '')))
    .map(normalizeKalshiMarket);
}

async function getWeatherManifoldMarkets(): Promise<PredictionMarket[]> {
  const terms = ['weather', 'temperature', 'hurricane', 'snowfall', 'rainfall'];
  const results = await Promise.allSettled(terms.map(term => {
    const params = new URLSearchParams({ term, limit: '40' });
    return getJson(`https://api.manifold.markets/v0/search-markets?${params}`);
  }));
  const rows = results.flatMap(result =>
    result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
  return rows
    .map(normalizeManifoldMarket)
    .filter((item): item is PredictionMarket => item != null && item.group === '天气');
}

async function getWeatherSupplement(existing: PredictionMarket[]): Promise<{
  rows: PredictionMarket[];
  added: number;
  error?: string;
}> {
  const results = await Promise.allSettled([
    getWeatherPolymarkets(),
    getWeatherKalshiMarkets(),
    getWeatherManifoldMarkets(),
  ]);
  const candidatesBySource = results.map(result =>
    result.status === 'fulfilled' ? result.value : []);
  const seen = new Set(existing.map(item => `${item.platform}:${item.id}`));
  const rows: PredictionMarket[] = [];
  for (const candidates of [...candidatesBySource].sort((left, right) => right.length - left.length)) {
    for (const candidate of candidates.sort((left, right) => right.activityScore - left.activityScore)) {
      const key = `${candidate.platform}:${candidate.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(candidate);
    }
  }
  rows.sort((left, right) => right.activityScore - left.activityScore);
  const limited = rows.slice(0, 90);
  const failures = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[];
  const fulfilledCount = results.length - failures.length;
  const error = fulfilledCount === 0
    ? failures.map(result => String(result.reason?.message || result.reason)).join('; ')
    : undefined;
  return { rows: limited, added: limited.length, error };
}

async function getGjOpenText(url: string, timeoutMs = 12_000): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html',
      'user-agent': 'Mozilla/5.0 MoneyMoney/1.0',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function parseGjConsensus(html: string): Array<{ answer: string; probability: number }> {
  const rows: Array<{ answer: string; probability: number }> = [];
  const table = /<table[^>]*consensus-table[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1] || html;
  const pattern = /<tr[^>]*>\s*<td>([\s\S]*?)<\/td>\s*<td[^>]*>\s*([\d.]+)\s*%[\s\S]*?<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) != null) {
    const probability = Number(match[2]) / 100;
    if (Number.isFinite(probability) && probability >= 0 && probability <= 1) {
      rows.push({ answer: decodeHtml(match[1]), probability });
    }
  }
  return rows;
}

let gjOpenCache: CacheEntry<PredictionMarket[]> | null = null;

async function getGjOpenMarkets(detailLimit = 12): Promise<PredictionMarket[]> {
  if (gjOpenCache && gjOpenCache.expiresAt > Date.now()) return gjOpenCache.value;

  const listHtml = await getGjOpenText('https://www.gjopen.com/questions', 15_000);
  const rowPattern = /<div id="row-table-question-(\d+)"[\s\S]*?(?=<div id="row-table-question-|$)/g;
  const latestId = Math.max(0, ...[...listHtml.matchAll(rowPattern)].map(match => Number(match[1])));
  if (!latestId) return [];

  // GJ Open exposes only its first list page without login. Recent detail
  // pages remain public, so scan backwards for true binary crowd questions.
  const candidateIds = Array.from({ length: 24 }, (_, index) => latestId - index)
    .filter(id => id > 0);
  const markets: PredictionMarket[] = [];

  for (let offset = 0; offset < candidateIds.length && markets.length < detailLimit; offset += 20) {
    const details = await Promise.allSettled(candidateIds.slice(offset, offset + 20).map(async id => {
      const url = `https://www.gjopen.com/questions/${id}`;
      const html = await getGjOpenText(url, 10_000);
      const title = decodeHtml(
        /<h3[^>]*question-name-header[^>]*>([\s\S]*?)<\/h3>/i.exec(html)?.[1] || '',
      );
      const endDate = /Closing[\s\S]{0,240}?data-localizable-timestamp="([^"]+)"/i.exec(html)?.[1];
      const endTime = endDate ? new Date(endDate).getTime() : NaN;
      if (!title || !Number.isFinite(endTime) || endTime <= Date.now()) return null;

      const answers = parseGjConsensus(html);
      if (answers.length !== 2) return null;
      const total = answers[0].probability + answers[1].probability;
      if (!Number.isFinite(total) || total < 0.98 || total > 1.02) return null;

      const yesPrice = clampProbability(answers[0].probability);
      const base: PredictionMarketSeed = {
        platform: 'Good Judgment Open',
        id: String(id),
        title,
        category: `Crowd · ${answers[0].answer}`,
        group: classifyGroup(title),
        outcome: answers[0].answer.slice(0, 42),
        url,
        yesPrice,
        noPrice: 1 - yesPrice,
        spread: undefined,
        volume24h: 0,
        volumeTotal: 4_000,
        liquidity: 2_000,
        endDate,
      };
      return { ...base, ...finishMarket(base), internalEdge: 0 };
    }));

    for (const detail of details) {
      if (detail.status === 'fulfilled' && detail.value) markets.push(detail.value);
    }
  }

  markets.sort((a, b) => b.activityScore - a.activityScore);
  gjOpenCache = { value: markets, expiresAt: Date.now() + 30 * 60_000 };
  return markets;
}

function finishMarket(base: PredictionMarketSeed) {
  return {
    activityScore: activityScore(base),
    // Gamma does not expose the complementary NO book on the market row.
    internalEdge: 0,
    ...probabilityJudgment(base),
  };
}

const MATCH_STOP_WORDS = new Set([
  'will', 'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'over',
  'under', 'before', 'after', 'during', 'than', 'then', 'who', 'whom', 'what',
  'when', 'where', 'why', 'how', 'does', 'did', 'has', 'have', 'had', 'are',
  'was', 'were', 'been', 'being', 'new', 'not', 'any', 'all', 'more', 'less',
  'market', 'price', 'prediction', 'question', 'yes', 'no', 'open', 'close',
]);

function keywords(title: string): Set<string> {
  return new Set(
    title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !MATCH_STOP_WORDS.has(word))
      .map(word => word.replace(/(?:ies|es|s)$/i, '')),
  );
}

function similarity(a: string, b: string): number {
  const left = keywords(a);
  const right = keywords(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  // Require two meaningful words; containment alone rewards a short generic
  // title that happens to sit inside an unrelated long question.
  if (shared < 2) return 0;
  const union = new Set([...left, ...right]).size;
  const containment = shared / Math.min(left.size, right.size);
  const jaccard = shared / union;
  return containment * 0.68 + jaccard * 0.32;
}

function findCrossPlatformMatches(markets: PredictionMarket[]): PredictionOpportunity[] {
  const result: PredictionOpportunity[] = [];

  const platformOrder = [...new Set(markets.map(item => item.platform))];
  const groups = platformOrder.map(platform =>
    markets.filter(item => item.platform === platform && isTradable(item))
  );

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    for (let otherIndex = groupIndex + 1; otherIndex < groups.length; otherIndex++) {
      for (const left of groups[groupIndex]) {
        for (const right of groups[otherIndex]) {
          const score = similarity(left.title, right.title);
          if (score < 0.78) continue;

          // Two venues can phrase one event differently, but they should still
          // describe the same world-state: same theme and roughly same deadline.
          if (left.group !== right.group) continue;
          const leftEnd = left.endDate ? new Date(left.endDate).getTime() : NaN;
          const rightEnd = right.endDate ? new Date(right.endDate).getTime() : NaN;
          if (Number.isFinite(leftEnd) && Number.isFinite(rightEnd)) {
            const dayGap = Math.abs(leftEnd - rightEnd) / 86_400_000;
            if (dayGap > 7) continue;
          }

          // Buy YES on the cheaper venue and buy NO on the other venue.
          const edge = 1 - left.yesPrice - right.noPrice;
          if (edge <= 0) continue;
          result.push({
            platformA: left.platform,
            platformB: right.platform,
            title: left.title,
            titleB: right.title,
            titleZh: left.titleZh || right.titleZh,
            edge: Number(edge.toFixed(4)),
            confidence: Number(score.toFixed(3)),
            priceA: left.yesPrice,
            priceB: right.noPrice,
            urlA: left.url,
            urlB: right.url,
          });
        }
      }
    }
  }

  return result.sort((a, b) => b.edge - a.edge || b.confidence - a.confidence).slice(0, 8);
}

function attachConsensusProbability(markets: PredictionMarket[]): void {
  const parents = markets.map((_, index) => index);
  const keywordCache = markets.map(item => keywords(item.title));
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  // Union-find keeps this quadratic scan bounded by the displayed universe and
  // avoids repeatedly allocating keyword sets inside the inner loop.
  for (let left = 0; left < markets.length; left++) {
    for (let right = left + 1; right < markets.length; right++) {
      const leftWords = keywordCache[left];
      const rightWords = keywordCache[right];
      let shared = 0;
      for (const word of leftWords) if (rightWords.has(word)) shared++;
      if (shared < 2) continue;
      if (shared / Math.min(leftWords.size, rightWords.size) >= 0.75) {
        union(left, right);
      }
    }
  }

  const clusters = new Map<number, number[]>();
  markets.forEach((_, index) => {
    const root = find(index);
    clusters.set(root, [...(clusters.get(root) || []), index]);
  });

  for (const indexes of clusters.values()) {
    if (indexes.length < 2) continue;
    const members = indexes.map(index => markets[index]);
    const platforms = new Set(members.map(item => item.platform));
    let weightSum = 0;
    let priceSum = 0;
    for (const market of members) {
      const weight = 1
        + market.volume24h * 2
        + market.liquidity
        + market.volumeTotal * 0.25
        + (market.participantCount || 0) * 8
        + (market.forecastCount || 0) * 4;
      weightSum += weight;
      priceSum += market.yesPrice * weight;
    }
    const consensusProbability = clampProbability(priceSum / Math.max(1, weightSum));
    const dispersion = Math.max(...members.map(item => item.yesPrice))
      - Math.min(...members.map(item => item.yesPrice));
    const confidence = Math.round(Math.max(38, Math.min(93,
      54 + (platforms.size - 1) * 13 - dispersion * 45)));
    for (const index of indexes) {
      markets[index].consensusProbability = consensusProbability;
      markets[index].consensusPlatforms = platforms.size;
      markets[index].probabilityConfidence = Math.round(
        (markets[index].probabilityConfidence + confidence) / 2,
      );
    }
  }
}

function isTradable(market: PredictionMarket): boolean {
  // Demo/empty listings often expose a synthetic 50% midpoint without any way
  // to take the other side. They create misleading "arbitrage" opportunities.
  return market.volume24h > 0 || market.liquidity > 0 || market.volumeTotal > 0;
}

function chineseCategory(rawCategory: string, group: string): string {
  const value = `${rawCategory} ${group}`.toLowerCase();
  if (/(weather|temperature|rainfall|snowfall|hurricane|climate)/.test(value)) return '天气';
  if (/(election|politic|senate|congress|president|parliament)/.test(value)) return '政治与选举';
  if (/(economy|economic|fed|inflation|gdp|rate|earnings|finance)/.test(value)) return '经济';
  if (/(crypto|bitcoin|ethereum|token|binance)/.test(value)) return '加密资产';
  if (/(war|geopolit|russia|ukraine|israel|iran|china|taiwan|nato)/.test(value)) return '地缘政治';
  if (/(sport|nba|nfl|mlb|nhl|soccer|football|basketball|baseball)/.test(value)) return '体育';
  if (/(science|technology|ai\b|artificial intelligence|space|health|drug)/.test(value)) return '科技与健康';
  return group || '综合';
}

function compactMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function marketSummaryZh(market: PredictionMarket): string {
  const yes = Math.round(market.yesPrice * 100);
  const model = Math.round(market.modelProbability * 100);
  const consensus = market.consensusProbability != null
    ? Math.round(market.consensusProbability * 100)
    : null;
  const outcomeName = !market.outcome || market.outcome.toUpperCase() === 'YES'
    ? 'YES（事件发生）'
    : `“${market.outcome}”`;
  const endTime = market.endDate ? new Date(market.endDate).getTime() : NaN;
  const deadline = Number.isFinite(endTime)
    ? Math.max(0, Math.ceil((endTime - Date.now()) / 86_400_000))
    : NaN;
  const facts = [
    `${market.platform}市场价 ${yes}%，系统参考 ${model}%。`,
    `24小时成交 ${compactMoney(market.volume24h)}，流动性 ${compactMoney(market.liquidity)}。`,
    Number.isFinite(deadline)
      ? `约 ${deadline} 天后截止${deadline === 0 ? '，临近事件落地' : ''}。`
      : '截止时间未公布。',
  ];
  if (consensus != null) {
    facts.push(`跨平台共识 ${consensus}%。`);
  }
  return `${facts.join(' ')} 价格越接近 100%，市场越认为会发生。`;
}

function marketSignalZh(market: PredictionMarket): string {
  const yes = market.yesPrice * 100;
  const model = market.modelProbability * 100;
  const consensus = market.consensusProbability != null ? market.consensusProbability * 100 : model;
  const gap = Math.abs(yes - consensus);
  const confidence = market.probabilityConfidence || 0;

  if (gap >= 12) {
    return confidence >= 65 ? '分歧显著 · 值得研究' : '分歧大 · 证据偏弱';
  }
  if (gap >= 6) {
    return confidence >= 65 ? '温和分歧 · 可观察' : '轻度分歧';
  }
  if (confidence >= 72) {
    return yes >= 80 ? '高共识 · 偏发生' : yes <= 20 ? '高共识 · 偏不发生' : '高共识';
  }
  if ((market.volume24h || 0) < 1_000 && (market.liquidity || 0) < 5_000) {
    return '热度低 · 谨慎解读';
  }
  return '定价一致';
}

async function attachChineseBriefs(markets: PredictionMarket[]): Promise<void> {
  const translations = await translateEnglishTitles(
    markets.map(item => item.title),
    Math.max(400, markets.length),
  );
  for (const market of markets) {
    market.categoryZh = chineseCategory(market.category, market.group);
    market.summaryZh = marketSummaryZh(market);
    market.signalZh = marketSignalZh(market);
    market.titleZh = translations.get(market.title.toLowerCase());
  }
}

async function buildPredictionRadar(): Promise<PredictionRadar> {
  const startedAt = Date.now();
  const primaryStarts = {
    polymarket: Date.now(),
    kalshi: Date.now(),
    manifold: Date.now(),
    gjopen: Date.now(),
    metaculus: Date.now(),
  };
  const [polyResult, kalshiResult, manifoldResult, gjResult, metaculusResult] = await Promise.allSettled([
    getPolymarkets(100),
    getKalshiMarkets(200),
    getManifoldMarkets(200),
    getGjOpenMarkets(6),
    getMetaculusMarkets(40),
  ]);

  const polymarket = polyResult.status === 'fulfilled' ? polyResult.value : [];
  const kalshi = kalshiResult.status === 'fulfilled' ? kalshiResult.value : [];
  const manifold = manifoldResult.status === 'fulfilled' ? manifoldResult.value : [];
  const gjopen = gjResult.status === 'fulfilled' ? gjResult.value : [];
  const metaculus = metaculusResult.status === 'fulfilled' ? metaculusResult.value : [];
  const baseMarkets = [...polymarket, ...kalshi, ...manifold, ...gjopen, ...metaculus];
  const weatherStartedAt = Date.now();
  const weatherResult = await getWeatherSupplement(baseMarkets);
  const markets = [...baseMarkets, ...weatherResult.rows].sort((a, b) => b.activityScore - a.activityScore);
  await attachWeatherForecastEvidence(markets);
  attachConsensusProbability(markets);
  await attachChineseBriefs(markets);
  const radar: PredictionRadar = {
    updatedAt: new Date().toISOString(),
    markets,
    opportunities: findCrossPlatformMatches(markets),
    sources: {
      polymarket: {
        ok: polyResult.status === 'fulfilled',
        count: polymarket.length,
        error: polyResult.status === 'rejected' ? String(polyResult.reason?.message || polyResult.reason) : undefined,
        latencyMs: Date.now() - primaryStarts.polymarket,
        checkedAt: new Date(startedAt).toISOString(),
      },
      kalshi: {
        ok: kalshiResult.status === 'fulfilled',
        count: kalshi.length,
        error: kalshiResult.status === 'rejected' ? String(kalshiResult.reason?.message || kalshiResult.reason) : undefined,
        latencyMs: Date.now() - primaryStarts.kalshi,
        checkedAt: new Date(startedAt).toISOString(),
      },
      manifold: {
        ok: manifoldResult.status === 'fulfilled',
        count: manifold.length,
        error: manifoldResult.status === 'rejected' ? String(manifoldResult.reason?.message || manifoldResult.reason) : undefined,
        latencyMs: Date.now() - primaryStarts.manifold,
        checkedAt: new Date(startedAt).toISOString(),
      },
      gjopen: {
        ok: gjResult.status === 'fulfilled',
        count: gjopen.length,
        error: gjResult.status === 'rejected' ? String(gjResult.reason?.message || gjResult.reason) : undefined,
        latencyMs: Date.now() - primaryStarts.gjopen,
        checkedAt: new Date(startedAt).toISOString(),
      },
      metaculus: {
        ok: metaculusResult.status === 'fulfilled',
        count: metaculus.length,
        error: metaculusResult.status === 'rejected' ? String(metaculusResult.reason?.message || metaculusResult.reason) : undefined,
        latencyMs: Date.now() - primaryStarts.metaculus,
        checkedAt: new Date(startedAt).toISOString(),
      },
      weather: {
        ok: weatherResult.error == null,
        count: weatherResult.added,
        error: weatherResult.error,
        latencyMs: Date.now() - weatherStartedAt,
        checkedAt: new Date().toISOString(),
      },
    },
  };

  return radar;
}

function slicePredictionRadar(radar: PredictionRadar, query: string, limit: number): PredictionRadar {
  const normalizedQuery = query.trim().toLowerCase();
  const limited = normalizedQuery
    ? radar.markets.filter(item => [
        item.title,
        item.titleZh,
        item.summaryZh,
        item.category,
        item.categoryZh,
        item.group,
      ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery))
    : radar.markets;
  return { ...radar, markets: limited.slice(0, limit) };
}

let radarWarming: Promise<void> | null = null;

function currentRadarCache(): CacheEntry<PredictionRadar> | null {
  return cache;
}

// Global search should feel instant, so it reads only the already-warmed radar
// snapshot and never triggers a fresh cross-platform crawl.
export function getCachedPredictionRadarSlice(query = '', limit = 12): PredictionRadar | null {
  const entry = currentRadarCache();
  return entry ? slicePredictionRadar(entry.value, query, limit) : null;
}

// Fetch fresh radar data into the module cache without blocking callers.
export function warmPredictionRadarCache(): Promise<void> {
  if (radarWarming) return radarWarming;
  radarWarming = buildPredictionRadar()
    .then(radar => {
      if (radar.markets.length) cache = { value: radar, expiresAt: Date.now() + CACHE_TTL_MS };
      void saveRadarSnapshot(radar);
      void recordPredictionHistory(radar.markets);
      void recordForecastLab(radar.markets);
    })
    .catch(() => {})
    .finally(() => {
      radarWarming = null;
    });
  return radarWarming;
}

export async function getPredictionRadar(query = '', limit = 60): Promise<PredictionRadar> {
  if (cache && cache.expiresAt > Date.now()) {
    return slicePredictionRadar(cache.value, query, limit);
  }
  if (cache) {
    // Serve the slightly stale snapshot immediately and refresh behind it so
    // reopening the tab never waits on slow external APIs again.
    void warmPredictionRadarCache();
    return slicePredictionRadar(cache.value, query, limit);
  }
  await warmPredictionRadarCache();
  const warmed = currentRadarCache();
  if (warmed) return slicePredictionRadar(warmed.value, query, limit);
  const built = await buildPredictionRadar();
  cache = { value: built, expiresAt: Date.now() + CACHE_TTL_MS };
  void saveRadarSnapshot(built);
  void recordPredictionHistory(built.markets);
  void recordForecastLab(built.markets);
  return slicePredictionRadar(built, query, limit);
}
