/**
 * Market Regime Detection.
 *
 * Classifies short-term market conditions using Binance kline data:
 * ADX (trend strength), ATR% (volatility), Bollinger Band Width (squeeze),
 * and directional movement. Feeds into the trade assistant so strategy
 * recommendations adapt to current conditions rather than a static playbook.
 */

import { binanceFeed } from './binance';

export type RegimeLabel =
  | 'strong-trend-up'
  | 'strong-trend-down'
  | 'weak-trend-up'
  | 'weak-trend-down'
  | 'ranging'
  | 'volatile-expansion'
  | 'squeeze';

export interface RegimeResult {
  symbol: string;
  label: RegimeLabel;
  labelZh: string;
  adx: number;
  plusDi: number;
  minusDi: number;
  atrPct: number;
  atrPctAvg: number;
  bbw: number;
  bbwPercentile: number;
  volumeTrend: 'rising' | 'falling' | 'flat';
  summaryZh: string;
  fetchedAt: string;
}

interface CacheEntry {
  ts: number;
  value: RegimeResult;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 1 minute

function sma(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const k = 2 / (period + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return result;
}

export async function getMarketRegime(symbol = 'BTCUSDT', interval = '4h'): Promise<RegimeResult> {
  const key = `${symbol}:${interval}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  // Fetch enough bars for indicators (need ~60 for ADX smoothing)
  const klines = await binanceFeed.getKlines(symbol, interval, 100);
  if (!klines || klines.length < 50) {
    throw new Error(`Not enough kline data for ${symbol} (${klines?.length ?? 0} bars)`);
  }

  const highs = klines.map(k => Number(k.high));
  const lows = klines.map(k => Number(k.low));
  const closes = klines.map(k => Number(k.close));
  const volumes = klines.map(k => Number(k.volume));

  const n = closes.length;

  // --- True Range & ATR ---
  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }
  const atr14 = ema(trs.slice(-28), 14); // Wilder's smoothing approximation via EMA
  const atrPct = atr14 / closes[n - 1] * 100;

  // ATR% historical average for comparison
  const atrPctHistory: number[] = [];
  for (let end = 20; end < n; end += 5) {
    const windowTrs = trs.slice(0, end);
    if (windowTrs.length >= 14) {
      const windowAtr = ema(windowTrs.slice(-28), 14);
      atrPctHistory.push(windowAtr / closes[end - 1] * 100);
    }
  }
  const atrPctAvg = atrPctHistory.length > 0 ? atrPctHistory.reduce((a, b) => a + b, 0) / atrPctHistory.length : atrPct;

  // --- Directional Movement (+DI, -DI, ADX) ---
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const smoothedPlusDM = ema(plusDMs.slice(-28), 14);
  const smoothedMinusDM = ema(minusDMs.slice(-28), 14);
  const plusDi = smoothedPlusDM / atr14 * 100;
  const minusDi = smoothedMinusDM / atr14 * 100;
  const diSum = plusDi + minusDi;
  const dx = diSum === 0 ? 0 : Math.abs(plusDi - minusDi) / diSum * 100;

  // ADX = EMA of DX values over recent bars
  const dxHistory: number[] = [];
  for (let end = 28; end <= n - 1; end++) {
    const wPlus = ema(plusDMs.slice(0, end).slice(-28), 14);
    const wMinus = ema(minusDMs.slice(0, end).slice(-28), 14);
    const wAtr = ema(trs.slice(0, end).slice(-28), 14);
    if (!isNaN(wAtr) && wAtr > 0) {
      const wpDi = wPlus / wAtr * 100;
      const wmDi = wMinus / wAtr * 100;
      const wSum = wpDi + wmDi;
      dxHistory.push(wSum === 0 ? 0 : Math.abs(wpDi - wmDi) / wSum * 100);
    }
  }
  const adx = dxHistory.length > 0 ? ema(dxHistory.slice(-28), 14) : dx;

  // --- Bollinger Band Width ---
  const bbPeriod = 20;
  const bbSlice = closes.slice(-bbPeriod);
  const bbMean = bbSlice.reduce((a, b) => a + b, 0) / bbPeriod;
  const bbStd = Math.sqrt(bbSlice.reduce((sum, c) => sum + Math.pow(c - bbMean, 2), 0) / bbPeriod);
  const bbw = (4 * bbStd) / bbMean * 100; // (upper - lower) / mean * 100

  // BBW percentile vs history
  const bbwHistory: number[] = [];
  for (let end = bbPeriod; end <= n; end += 5) {
    const slice = closes.slice(end - bbPeriod, end);
    if (slice.length === bbPeriod) {
      const m = slice.reduce((a, b) => a + b, 0) / bbPeriod;
      const s = Math.sqrt(slice.reduce((sum, c) => sum + Math.pow(c - m, 2), 0) / bbPeriod);
      if (m > 0) bbwHistory.push((4 * s) / m * 100);
    }
  }
  const sortedBbw = [...bbwHistory].sort((a, b) => a - b);
  const bbwRank = sortedBbw.filter(v => v < bbw).length;
  const bbwPercentile = sortedBbw.length > 0 ? bbwRank / sortedBbw.length * 100 : 50;

  // --- Volume trend ---
  const volRecent = sma(volumes.slice(-10), 10);
  const volPrior = sma(volumes.slice(-30, -10), 20);
  const volRatio = volPrior > 0 ? volRecent / volPrior : 1;
  const volumeTrend: RegimeResult['volumeTrend'] =
    volRatio > 1.15 ? 'rising' : volRatio < 0.85 ? 'falling' : 'flat';

  // --- Regime classification ---
  let label: RegimeLabel;
  if (adx > 25 && bbwPercentile > 70) {
    label = plusDi > minusDi ? 'strong-trend-up' : 'strong-trend-down';
  } else if (adx > 20) {
    label = plusDi > minusDi ? 'weak-trend-up' : 'weak-trend-down';
  } else if (bbwPercentile < 15) {
    label = 'squeeze';
  } else if (atrPct > atrPctAvg * 1.3 || bbwPercentile > 85) {
    label = 'volatile-expansion';
  } else {
    label = 'ranging';
  }

  const labelZhMap: Record<RegimeLabel, string> = {
    'strong-trend-up': '强趋势上涨',
    'strong-trend-down': '强趋势下跌',
    'weak-trend-up': '弱趋势上涨',
    'weak-trend-down': '弱趋势下跌',
    'ranging': '区间震荡',
    'volatile-expansion': '波动扩张',
    'squeeze': '布林挤压',
  };

  const summaryParts: string[] = [];
  summaryParts.push(`ADX ${adx.toFixed(1)}（${adx > 25 ? '趋势明确' : adx > 20 ? '趋势偏弱' : '无趋势'}）`);
  summaryParts.push(`ATR% ${atrPct.toFixed(2)}（${atrPct > atrPctAvg * 1.3 ? '高于平均' : atrPct < atrPctAvg * 0.7 ? '低于平均' : '正常'}）`);
  summaryParts.push(`BBW ${bbw.toFixed(2)}%（${bbwPercentile > 70 ? '高位扩张' : bbwPercentile < 15 ? '极度收缩' : '正常范围'}）`);
  if (volumeTrend !== 'flat') summaryParts.push(`成交量${volumeTrend === 'rising' ? '放大' : '萎缩'}`);

  const result: RegimeResult = {
    symbol,
    label,
    labelZh: labelZhMap[label],
    adx: Math.round(adx * 10) / 10,
    plusDi: Math.round(plusDi * 10) / 10,
    minusDi: Math.round(minusDi * 10) / 10,
    atrPct: Math.round(atrPct * 100) / 100,
    atrPctAvg: Math.round(atrPctAvg * 100) / 100,
    bbw: Math.round(bbw * 100) / 100,
    bbwPercentile: Math.round(bbwPercentile),
    volumeTrend,
    summaryZh: summaryParts.join(' · '),
    fetchedAt: new Date().toISOString(),
  };

  cache.set(key, { ts: Date.now(), value: result });
  return result;
}
