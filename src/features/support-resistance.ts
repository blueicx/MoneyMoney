/**
 * Support / Resistance auto-detection.
 *
 * Uses swing highs/lows from Binance klines to find price zones where the
 * market has historically reacted. Levels are scored by touch count,
 * recency, and aggregate volume so the trade assistant can attach
 * concrete entry, stop-loss, and take-profit references.
 */

import { binanceFeed } from './binance';

export interface SrLevel {
  type: 'support' | 'resistance';
  price: number;
  touches: number;
  lastTouchTime: string;
  strength: number; // 0-100 composite score
  distancePct: number; // % away from current price (signed)
}

export interface SrResult {
  symbol: string;
  interval: string;
  currentPrice: number;
  supports: SrLevel[];
  resistances: SrLevel[];
  nearestSupport?: SrLevel;
  nearestResistance?: SrLevel;
  trendHintZh: string;
  fetchedAt: string;
}

interface CacheEntry {
  ts: number;
  value: SrResult;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 120_000; // 2 minutes

interface SwingPoint {
  price: number;
  time: number;
  volume: number;
  index: number;
}

/**
 * Find local extrema (swing points) using a fractal window.
 * A bar is a swing high if it's higher than `lookback` bars on each side.
 */
function findSwings(
  highs: number[], lows: number[], volumes: number[], times: number[],
  lookback = 3,
): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const swingHighs: SwingPoint[] = [];
  const swingLows: SwingPoint[] = [];

  for (let i = lookback; i < highs.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isHigh = false;
      if (lows[j] <= lows[i]) isLow = false;
    }
    if (isHigh) swingHighs.push({ price: highs[i], time: times[i], volume: volumes[i], index: i });
    if (isLow) swingLows.push({ price: lows[i], time: times[i], volume: volumes[i], index: i });
  }

  return { highs: swingHighs, lows: swingLows };
}

/**
 * Cluster nearby swing points into a single level zone.
 * Two points belong to the same zone if within tolerance% of each other.
 */
function clusterLevels(points: SwingPoint[], currentPrice: number, tolerancePct = 0.35): Array<{
  price: number; touches: number; lastTouchTime: number; totalVolume: number;
}> {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters: Array<{ prices: number[]; times: number[]; volumes: number[] }> = [];

  for (const p of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && last.prices.length > 0) {
      const avgPrice = last.prices.reduce((s, v) => s + v, 0) / last.prices.length;
      if (Math.abs(p.price - avgPrice) / avgPrice * 100 <= tolerancePct) {
        last.prices.push(p.price);
        last.times.push(p.time);
        last.volumes.push(p.volume);
        continue;
      }
    }
    clusters.push({ prices: [p.price], times: [p.time], volumes: [p.volume] });
  }

  return clusters.map(c => ({
    price: Math.round(c.prices.reduce((s, v) => s + v, 0) / c.prices.length * 10000) / 10000,
    touches: c.prices.length,
    lastTouchTime: Math.max(...c.times),
    totalVolume: c.volumes.reduce((s, v) => s + v, 0),
  }));
}

export async function getSupportResistance(symbol = 'BTCUSDT', interval = '4h'): Promise<SrResult> {
  const key = `${symbol}:${interval}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const klines = await binanceFeed.getKlines(symbol, interval, 200);
  if (!klines || klines.length < 30) throw new Error(`Not enough kline data for S/R ${symbol}`);

  const highs = klines.map(k => Number(k.high));
  const lows = klines.map(k => Number(k.low));
  const volumes = klines.map(k => Number(k.volume));
  const times = klines.map(k => Number(k.time));
  const currentPrice = Number(klines[klines.length - 1].close);

  const swings = findSwings(highs, lows, volumes, times);

  // Score levels by touches + recency + volume rank
  const maxVol = Math.max(...volumes, 1);
  const now = Date.now();
  const ageSpan = Math.max(now - times[0], 1);

  const buildLevels = (
    clustered: ReturnType<typeof clusterLevels>,
    type: 'support' | 'resistance',
  ): SrLevel[] =>
    clustered
      .filter(l => type === 'support' ? l.price <= currentPrice : l.price >= currentPrice)
      .map(l => {
        const touchScore = Math.min(40, l.touches * 10);
        const recencyScore = Math.min(30, ((now - l.lastTouchTime) / ageSpan) > 0 ? 0 : 0); // placeholder
        const recentBonus = (now - l.lastTouchTime) / ageSpan < 0.15 ? 15 : (now - l.lastTouchTime) / ageSpan < 0.4 ? 8 : 0;
        const volScore = Math.min(20, (l.totalVolume / maxVol) * 20);
        const proximityScore = Math.max(0, 10 - Math.abs(l.price - currentPrice) / currentPrice * 100 * 2);
        return {
          type,
          price: l.price,
          touches: l.touches,
          lastTouchTime: new Date(l.lastTouchTime).toISOString(),
          strength: Math.min(100, Math.round(touchScore + recentBonus + volScore + proximityScore)),
          distancePct: Math.round(((l.price - currentPrice) / currentPrice * 100) * 100) / 100,
        };
      })
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 5);

  const supports = buildLevels(clusterLevels(swings.lows, currentPrice), 'support');
  const resistances = buildLevels(clusterLevels(swings.highs, currentPrice), 'resistance');

  const nearestSupport = supports.length > 0
    ? supports.reduce((best, s) => s.distancePct > best.distancePct ? s : best, supports[0])
    : undefined;
  const nearestResistance = resistances.length > 0
    ? resistances.reduce((best, r) => r.distancePct < best.distancePct ? r : best, resistances[0])
    : undefined;

  let trendHintZh: string;
  if (!nearestSupport && !nearestResistance) {
    trendHintZh = '价格处于无参考区间，建议观望';
  } else if (nearestSupport && !nearestResistance) {
    trendHintZh = `价格突破所有阻力，下方支撑 $${nearestSupport.price}（${nearestSupport.distancePct}%），趋势偏强`;
  } else if (!nearestSupport && nearestResistance) {
    trendHintZh = `价格跌破所有支撑，上方阻力 $${nearestResistance.price}（${nearestResistance.distancePct}%），趋势偏弱`;
  } else {
    const rangeSize = Math.abs(nearestResistance!.price - nearestSupport!.price) / currentPrice * 100;
    trendHintZh = rangeSize > 6
      ? `区间较宽（${rangeSize.toFixed(1)}%），支撑 $${nearestSupport!.price} · 阻力 $${nearestResistance!.price}`
      : `区间紧凑（${rangeSize.toFixed(1)}%），可能即将变盘，支撑 $${nearestSupport!.price} · 阻力 $${nearestResistance!.price}`;
  }

  const result: SrResult = {
    symbol,
    interval,
    currentPrice: Math.round(currentPrice * 10000) / 10000,
    supports,
    resistances,
    nearestSupport,
    nearestResistance,
    trendHintZh,
    fetchedAt: new Date().toISOString(),
  };

  cache.set(key, { ts: Date.now(), value: result });
  return result;
}
