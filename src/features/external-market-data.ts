/** Free keyless macro-calendar and global crypto-market data. */

import fs from 'fs';
import path from 'path';
import { DATA_ROOT, ensureDir } from '../utils/paths';

export interface CalendarEvent {
  title: string;
  country: string;
  date: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  impactLabel: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
}

export interface CalendarResult {
  source: 'ForexFactory Public JSON';
  fetchedAt: string;
  count: number;
  events: CalendarEvent[];
  stale?: boolean;
}

export interface GlobalCryptoMetrics {
  source: 'Coinlore Public API';
  fetchedAt: string;
  totalMarketCapUsd: number;
  totalVolumeUsd: number;
  marketCapChange24hPct: number;
  volumeChange24hPct: number;
  bitcoinDominancePct: number;
  ethereumDominancePct: number;
  averageChange24hPct: number;
  coinsCount: number;
  activeMarkets: number;
}

const CACHE_TTL_MS = 60_000;
const MACRO_CALENDAR_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const MACRO_CALENDAR_DISK_CACHE = path.join(DATA_ROOT, 'macro-calendar.cache.json');
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
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`数据源 HTTP ${response.status}`);
  return response.json();
}

function normalizeImpact(value: any): { impact: CalendarEvent['impact']; label: string } {
  const raw = String(value || '').toLowerCase();
  if (raw === 'high') return { impact: 'High', label: '高影响' };
  if (raw === 'medium') return { impact: 'Medium', label: '中影响' };
  if (raw === 'low') return { impact: 'Low', label: '低影响' };
  if (raw === 'holiday') return { impact: 'Holiday', label: '假期' };
  return { impact: 'Low', label: String(value || '未知') };
}

function text(value: any): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized && normalized !== '-' ? normalized : null;
}

export async function getMacroCalendar(): Promise<CalendarResult> {
  const cached = fromCache<CalendarResult>('macro-calendar');
  if (cached) return cached;
  try {
    const payload = await fetchJson('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
    if (!Array.isArray(payload)) throw new Error('宏观日历格式异常');

    const events: CalendarEvent[] = payload.map((item: any) => {
      const impact = normalizeImpact(item.impact);
      return {
        title: String(item.title || '未命名事件'),
        country: String(item.country || item.currency || '').toUpperCase(),
        date: String(item.date || ''),
        impact: impact.impact,
        impactLabel: impact.label,
        forecast: text(item.forecast),
        previous: text(item.previous),
        actual: text(item.actual),
      };
    }).filter(event => event.date && new Date(event.date).getTime() > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const value: CalendarResult = {
      source: 'ForexFactory Public JSON',
      fetchedAt: new Date().toISOString(),
      count: events.length,
      events,
    };
    try {
      ensureDir(DATA_ROOT);
      fs.writeFileSync(MACRO_CALENDAR_DISK_CACHE, JSON.stringify(value, null, 2));
    } catch {}
    toCache('macro-calendar', value);
    return value;
  } catch (error) {
    try {
      const parsed = JSON.parse(fs.readFileSync(MACRO_CALENDAR_DISK_CACHE, 'utf8')) as CalendarResult;
      const age = Date.now() - new Date(parsed.fetchedAt).getTime();
      if (Array.isArray(parsed.events) && Number.isFinite(age) && age >= 0 && age <= MACRO_CALENDAR_MAX_STALE_MS) {
        const value = { ...parsed, stale: true };
        toCache('macro-calendar', value);
        return value;
      }
    } catch {}
    throw error;
  }
}

export async function getGlobalCryptoMetrics(): Promise<GlobalCryptoMetrics> {
  const cached = fromCache<GlobalCryptoMetrics>('crypto-global');
  if (cached) return cached;
  const payload = await fetchJson('https://api.coinlore.net/api/global/');
  const item = Array.isArray(payload) ? payload[0] : payload;
  if (!item) throw new Error('全局行情为空');
  const value: GlobalCryptoMetrics = {
    source: 'Coinlore Public API',
    fetchedAt: new Date().toISOString(),
    totalMarketCapUsd: Number(item.total_mcap) || 0,
    totalVolumeUsd: Number(item.total_volume) || 0,
    marketCapChange24hPct: Number(item.mcap_change) || 0,
    volumeChange24hPct: Number(item.volume_change) || 0,
    bitcoinDominancePct: Number(item.btc_d) || 0,
    ethereumDominancePct: Number(item.eth_d) || 0,
    averageChange24hPct: Number(item.avg_change_percent) || 0,
    coinsCount: Number(item.coins_count) || 0,
    activeMarkets: Number(item.active_markets) || 0,
  };
  toCache('crypto-global', value);
  return value;
}
