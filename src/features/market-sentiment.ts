/**
 * Free keyless market sentiment indicators:
 * - Fear & Greed Index from alternative.me
 * - Binance Funding Rates (public endpoint)
 */

export interface FearGreedEntry {
  value: number;
  classification: string;
  classificationZh: string;
  timestamp: string;
}

export interface FearGreedResult {
  source: 'alternative.me API';
  fetchedAt: string;
  current: FearGreedEntry;
  yesterday: FearGreedEntry | null;
  lastWeek: FearGreedEntry | null;
  trend7d: { date: string; value: number }[];
}

export interface FundingRateRow {
  symbol: string;
  fundingRatePct: number;
  nextFundingTime: string;
  annualizedPct: number;
}

export interface FundingRatesResult {
  source: 'Gate.io Public API';
  fetchedAt: string;
  rows: FundingRateRow[];
  avgFundingPct: number;
  extremePositive: FundingRateRow | null;
  extremeNegative: FundingRateRow | null;
}

const CACHE_TTL_MS = 120_000;
const cache = new Map<string, { ts: number; value: any }>();

function fromCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.ts > CACHE_TTL_MS) return null;
  return entry.value as T;
}

function toCache(key: string, value: any): void {
  cache.set(key, { ts: Date.now(), value });
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function classifyFearGreedZh(value: number): string {
  if (value <= 24) return '\u6781\u5ea6\u6050\u60e7';
  if (value <= 44) return '\u6050\u60e7';
  if (value <= 55) return '\u4e2d\u6027';
  if (value <= 74) return '\u8d2a\u5a6a';
  return '\u6781\u5ea6\u8d2a\u5a6a';
}

function toFearGreedEntry(item: any): FearGreedEntry {
  const value = Number(item.value) || 0;
  return {
    value,
    classification: item.value_classification || '',
    classificationZh: classifyFearGreedZh(value),
    timestamp: item.timestamp
      ? new Date(Number(item.timestamp) * 1000).toISOString()
      : '',
  };
}

export async function getFearGreed(): Promise<FearGreedResult> {
  const cached = fromCache<FearGreedResult>('fear-greed');
  if (cached) return cached;
  const payload = await fetchJson('https://api.alternative.me/fng/?limit=8');
  const data = Array.isArray(payload?.data) ? payload.data : [];
  if (!data.length) throw new Error('fear-greed empty');

  const entries = data.map(toFearGreedEntry);
  const trend = [...entries].reverse().map(entry => ({
    date: entry.timestamp ? entry.timestamp.slice(0, 10) : '',
    value: entry.value,
  }));

  const result: FearGreedResult = {
    source: 'alternative.me API',
    fetchedAt: new Date().toISOString(),
    current: entries[0],
    yesterday: entries[1] || null,
    lastWeek: entries[6] || entries[entries.length - 1] || null,
    trend7d: trend.filter(t => t.date),
  };
  toCache('fear-greed', result);
  return result;
}

export async function getFundingRates(limit = 20): Promise<FundingRatesResult> {
  const cacheKey = `funding-${limit}`;
  const cached = fromCache<FundingRatesResult>(cacheKey);
  if (cached) return cached;

  const payload = await fetchJson('https://api.gateio.ws/api/v4/futures/usdt/contracts');
  if (!Array.isArray(payload)) throw new Error('funding format error');

  let rows: FundingRateRow[] = payload
    .filter((item: any) => Math.abs(Number(item.funding_rate)) > 0)
    .map((item: any) => {
      const rate = Number(item.funding_rate) || 0;
      return {
        symbol: String(item.name || ''),
        fundingRatePct: rate * 100,
        nextFundingTime: item.funding_next_apply
          ? new Date(Number(item.funding_next_apply) * 1000).toLocaleTimeString('zh-CN', { hour12: false })
          : '',
        annualizedPct: rate * 365 * 100,
      };
    })
    .filter(row => row.symbol.endsWith('_USDT'))
    .sort((a, b) => Math.abs(b.fundingRatePct) - Math.abs(a.fundingRatePct))
    .slice(0, limit);

  const avg = rows.length
    ? rows.reduce((sum, r) => sum + r.fundingRatePct, 0) / rows.length
    : 0;
  const positive = [...rows].sort((a, b) => b.fundingRatePct - a.fundingRatePct)[0] || null;
  const negative = [...rows].sort((a, b) => a.fundingRatePct - b.fundingRatePct)[0] || null;

  const result: FundingRatesResult = {
    source: 'Gate.io Public API',
    fetchedAt: new Date().toISOString(),
    rows,
    avgFundingPct: Number(avg.toFixed(4)),
    extremePositive: positive,
    extremeNegative: negative,
  };
  toCache(cacheKey, result);
  return result;
}


