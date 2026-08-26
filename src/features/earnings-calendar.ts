/**
 * Keyless Nasdaq earnings-calendar data for US-listed companies.
 */

export interface EarningsItem {
  symbol: string;
  name: string;
  marketCapUsd: number | null;
  marketCapLabel: string;
  fiscalQuarter: string;
  epsForecast: string;
  estimates: string;
  lastYearEps: string;
  lastYearReportDate: string;
  timing: 'pre' | 'after' | 'unknown';
  timingLabel: string;
}

export interface EarningsCalendar {
  source: 'Nasdaq Public Calendar';
  fetchedAt: string;
  date: string;
  count: number;
  items: EarningsItem[];
}

interface CacheEntry {
  ts: number;
  value: EarningsCalendar;
}

const CACHE_TTL_MS = 300_000;
const cache = new Map<string, CacheEntry>();

export function currentUsMarketDate(): string {
  // pkg builds may lack full ICU timezone data, so derive New York time from UTC
  // and the fixed US daylight-saving transition rules.
  const now = new Date();
  const year = now.getUTCFullYear();
  const nthSunday = (month: number, nth: number) => {
    const first = new Date(Date.UTC(year, month, 1));
    return 1 + ((7 - first.getUTCDay()) % 7) + 7 * (nth - 1);
  };
  const dstStart = new Date(Date.UTC(year, 2, nthSunday(2, 2), 7));
  const dstEnd = new Date(Date.UTC(year, 10, nthSunday(10, 1), 6));
  const utcOffsetHours = now >= dstStart && now < dstEnd ? -4 : -5;
  return new Date(now.getTime() + utcOffsetHours * 3_600_000).toISOString().slice(0, 10);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseMarketCap(value: any): number | null {
  const numeric = Number(String(value || '').replace(/[$,]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeTiming(value: any): { timing: EarningsItem['timing']; label: string } {
  const raw = String(value || '').toLowerCase();
  if (raw === 'time-pre-market') return { timing: 'pre', label: '盘前' };
  if (raw === 'time-after-hours') return { timing: 'after', label: '盘后' };
  return { timing: 'unknown', label: '时间待定' };
}

function text(value: any): string {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.toUpperCase() !== 'N/A' ? normalized : '';
}

export async function getEarningsCalendar(requestedDate?: string): Promise<EarningsCalendar> {
  const date = requestedDate?.trim() || currentUsMarketDate();
  if (!isValidDate(date)) throw new Error('日期格式应为 YYYY-MM-DD');

  const cached = cache.get(date);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const url = `https://api.nasdaq.com/api/calendar/earnings?date=${encodeURIComponent(date)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Nasdaq HTTP ${response.status}`);

  const payload: any = await response.json();
  const rows = Array.isArray(payload?.data?.rows) ? payload.data.rows : [];

  const items: EarningsItem[] = (rows as any[]).map((row: any) => {
    const timing = normalizeTiming(row.time);
    return {
      symbol: text(row.symbol).toUpperCase(),
      name: text(row.name),
      marketCapUsd: parseMarketCap(row.marketCap),
      marketCapLabel: text(row.marketCap),
      fiscalQuarter: text(row.fiscalQuarterEnding),
      epsForecast: text(row.epsForecast),
      estimates: text(row.noOfEsts),
      lastYearEps: text(row.lastYearEPS),
      lastYearReportDate: text(row.lastYearRptDt),
      timing: timing.timing,
      timingLabel: timing.label,
    };
  }).filter(item => item.symbol && item.name)
    .sort((a: EarningsItem, b: EarningsItem) => (b.marketCapUsd || 0) - (a.marketCapUsd || 0) || a.symbol.localeCompare(b.symbol));

  const value: EarningsCalendar = {
    source: 'Nasdaq Public Calendar',
    fetchedAt: new Date().toISOString(),
    date,
    count: items.length,
    items,
  };
  cache.set(date, { ts: Date.now(), value });
  return value;
}
