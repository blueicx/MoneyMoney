/**
 * Macro event-risk guard.
 *
 * Economic releases are not another directional indicator: they are a timing
 * filter. A high-impact release can invalidate a technically good entry, so
 * the advisor reduces conviction slightly and shrinks suggested risk before
 * the event, then returns to normal once the event window has passed.
 */

import { getMacroCalendar } from './external-market-data';

export interface EventRiskItem {
  id: string;
  title: string;
  country: string;
  date: string;
  impact: 'High';
  hoursUntil: number;
  window: 'recent' | 'immediate' | 'today' | 'upcoming';
  windowZh: '刚公布' | '临近发布' | '今日发布' | '72小时内';
  relevance: 'global' | 'regional';
  relevanceZh: '全球高影响' | '区域高影响';
  forecast: string | null;
  previous: string | null;
}

export interface EventRiskResult {
  source: 'ForexFactory Public JSON';
  fetchedAt: string;
  riskLevel: 'Calm' | 'Watch' | 'Elevated' | 'High';
  riskLevelZh: '平静' | '关注' | '升高' | '高影响';
  summaryZh: string;
  globalConfidenceAdjustment: number;
  globalRiskMultiplier: number;
  stale: boolean;
  events: EventRiskItem[];
}

interface CacheEntry {
  ts: number;
  value: EventRiskResult;
}

const CACHE_TTL_MS = 120_000;
const LOOKAHEAD_HOURS = 72;
const RECENT_HOURS = 3;
let cache: CacheEntry | null = null;

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function eventWindow(hoursUntil: number): EventRiskItem['window'] {
  if (hoursUntil < 0 && hoursUntil >= -RECENT_HOURS) return 'recent';
  if (hoursUntil >= 0 && hoursUntil <= 4) return 'immediate';
  if (hoursUntil > 4 && hoursUntil <= 24) return 'today';
  return 'upcoming';
}

function eventWindowZh(hoursUntil: number): EventRiskItem['windowZh'] {
  if (hoursUntil < 0) return '刚公布';
  if (hoursUntil <= 4) return '临近发布';
  if (hoursUntil <= 24) return '今日发布';
  return '72小时内';
}

function formatHours(hours: number): string {
  if (hours < 0) return `${round(Math.abs(hours))} 小时前`;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分钟后`;
  return `${round(hours)} 小时后`;
}

export async function getEventRisk(): Promise<EventRiskResult> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const calendar = await getMacroCalendar();
  const now = Date.now();
  const events = calendar.events
    .filter(event => event.impact === 'High')
    .map(event => {
      const time = new Date(event.date).getTime();
      return { event, hoursUntil: (time - now) / 3_600_000 };
    })
    .filter(item => Number.isFinite(item.hoursUntil)
      && item.hoursUntil <= LOOKAHEAD_HOURS
      && item.hoursUntil >= -RECENT_HOURS)
    .sort((a, b) => Math.abs(a.hoursUntil) - Math.abs(b.hoursUntil))
    .slice(0, 6)
    .map(({ event, hoursUntil }) => ({
      id: `event-${event.country.toLowerCase()}-${new Date(event.date).getTime()}-${event.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 32)}`,
      title: event.title,
      country: event.country,
      date: event.date,
      impact: 'High' as const,
      hoursUntil: round(hoursUntil, 2),
      window: eventWindow(hoursUntil),
      windowZh: eventWindowZh(hoursUntil),
      relevance: ['USD', 'EUR', 'GLOBAL'].includes(event.country.toUpperCase())
        ? 'global' as const
        : 'regional' as const,
      relevanceZh: ['USD', 'EUR', 'GLOBAL'].includes(event.country.toUpperCase())
        ? '全球高影响' as const
        : '区域高影响' as const,
      forecast: event.forecast,
      previous: event.previous,
    }));

  const future = events.filter(event => event.hoursUntil >= 0);
  const globalFuture = future.filter(event => event.relevance === 'global');
  const nearest = future[0];
  const nearestGlobal = globalFuture[0];

  let riskLevel: EventRiskResult['riskLevel'] = 'Calm';
  if (nearest?.window === 'immediate') riskLevel = 'High';
  else if (nearest?.window === 'today') riskLevel = 'Elevated';
  else if (nearest?.window === 'upcoming') riskLevel = 'Watch';

  // Only globally relevant releases justify a portfolio-wide guard. Regional
  // events remain visible, but should not silently shrink a BTC or US equity
  // position when the user's signal has no exposure to that region.
  let globalConfidenceAdjustment = 0;
  let globalRiskMultiplier = 1;
  if (nearestGlobal?.window === 'immediate') {
    globalConfidenceAdjustment = -3;
    globalRiskMultiplier = 0.7;
  } else if (nearestGlobal?.window === 'today') {
    globalConfidenceAdjustment = -1;
    globalRiskMultiplier = 0.85;
  }

  const riskLevelZh: EventRiskResult['riskLevelZh'] = riskLevel === 'High'
    ? '高影响'
    : riskLevel === 'Elevated'
      ? '升高'
      : riskLevel === 'Watch'
        ? '关注'
        : '平静';

  const stalePrefix = calendar.stale ? '[近期缓存] ' : '';
  const summaryZh = nearest
    ? `${stalePrefix}${nearest.relevanceZh}：${nearest.country} ${nearest.title} ${formatHours(nearest.hoursUntil)}。${
      globalConfidenceAdjustment < 0
        ? `助手已降低全球新信号信心 ${Math.abs(globalConfidenceAdjustment)} 分，单笔风险 ×${globalRiskMultiplier}。`
        : '该事件暂不触发全球信号降权，仍建议避免发布前重仓。'
    }`
    : `${stalePrefix}未来 72 小时没有已收录的高影响宏观事件；按常规风险管理执行。`;

  const value: EventRiskResult = {
    source: 'ForexFactory Public JSON',
    fetchedAt: new Date().toISOString(),
    riskLevel,
    riskLevelZh,
    summaryZh,
    globalConfidenceAdjustment,
    globalRiskMultiplier,
    stale: calendar.stale === true,
    events,
  };
  cache = { ts: Date.now(), value };
  return value;
}
