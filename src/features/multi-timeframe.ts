/**
 * Multi-timeframe trend confluence.
 *
 * Checks whether short (15m), medium (1h), swing (4h) and daily timeframes
 * agree on direction. High confluence = higher conviction for the assistant;
 * mixed signals = reduce confidence or wait.
 */

import { binanceFeed } from './binance';

export interface TimeframeSignal {
  interval: string;
  labelZh: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  score: number; // -100 to 100
  maAlignment: 'golden' | 'death' | 'mixed';
  priceVsMa20Pct: number;
}

export interface ConfluenceResult {
  symbol: string;
  overallDirection: 'bullish' | 'bearish' | 'neutral';
  confluenceScore: number; // 0-100
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  signals: TimeframeSignal[];
  summaryZh: string;
  fetchedAt: string;
}

const TIMEFRAMES: Array<{ interval: string; labelZh: string }> = [
  { interval: '15m', labelZh: '15分钟' },
  { interval: '1h', labelZh: '1小时' },
  { interval: '4h', labelZh: '4小时' },
  { interval: '1d', labelZh: '日线' },
];

function sma(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

interface CacheEntry {
  ts: number;
  value: ConfluenceResult;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 90_000; // 90 seconds

export async function getMultiTimeframeConfluence(symbol = 'BTCUSDT'): Promise<ConfluenceResult> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const results = await Promise.allSettled(
    TIMEFRAMES.map(async ({ interval, labelZh }): Promise<TimeframeSignal> => {
      const klines = await binanceFeed.getKlines(symbol, interval, 60);
      if (!klines || klines.length < 55) throw new Error(`${symbol} ${interval} data unavailable`);
      const closes = klines.map(k => Number(k.close));
      const currentPrice = closes[closes.length - 1];
      const ma20 = sma(closes, 20);
      const ma50 = sma(closes, 50);

      const maAlignment: TimeframeSignal['maAlignment'] =
        ma20 > ma50 ? 'golden' : ma20 < ma50 ? 'death' : 'mixed';
      const priceVsMa20Pct = ((currentPrice - ma20) / ma20) * 100;

      let score = 0;
      if (maAlignment === 'golden') score += 40;
      else if (maAlignment === 'death') score -= 40;

      // Price relative to MA20 adds directional bias
      score += Math.max(-30, Math.min(30, priceVsMa20Pct * 3));

      // Short-term momentum (last 10 bars)
      const roc10 = ((closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11]) * 100;
      score += Math.max(-30, Math.min(30, roc10 * 5));

      return {
        interval,
        labelZh,
        direction: score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral',
        score: Math.round(Math.max(-100, Math.min(100, score))),
        maAlignment,
        priceVsMa20Pct: Math.round(priceVsMa20Pct * 100) / 100,
      };
    }),
  );

  const signals = results
    .filter((r): r is PromiseFulfilledResult<TimeframeSignal> => r.status === 'fulfilled')
    .map(r => r.value);

  if (signals.length === 0) throw new Error(`No timeframe data available for ${symbol}`);

  const bullishCount = signals.filter(s => s.direction === 'bullish').length;
  const bearishCount = signals.filter(s => s.direction === 'bearish').length;
  const neutralCount = signals.filter(s => s.direction === 'neutral').length;

  const avgScore = signals.reduce((s, tf) => s + tf.score, 0) / signals.length;
  const maxPossible = 100 * signals.length;
  const agreementRatio = Math.max(bullishCount, bearishCount) / signals.length;
  const confluenceScore = Math.round(
    (Math.abs(avgScore) / maxPossible * signals.length + agreementRatio) / 2 * 100
  );

  const overallDirection: ConfluenceResult['overallDirection'] =
    avgScore > 15 ? 'bullish' : avgScore < -15 ? 'bearish' : 'neutral';

  const dirZh = overallDirection === 'bullish' ? '看多共振' : overallDirection === 'bearish' ? '看空共振' : '方向分歧';
  const strengthZh = confluenceScore >= 75 ? '高度一致' : confluenceScore >= 50 ? '基本一致' : confluenceScore >= 25 ? '部分分歧' : '严重分歧';
  const summaryZh = `${dirZh} · ${strengthZh}（${confluenceScore}%）· 多头 ${bullishCount} / 空头 ${bearishCount} / 中性 ${neutralCount} · ` +
    signals.map(s => `${s.labelZh}${s.direction === 'bullish' ? '↑' : s.direction === 'bearish' ? '↓' : '→'}`).join(' ');

  const result: ConfluenceResult = {
    symbol,
    overallDirection,
    confluenceScore,
    bullishCount,
    bearishCount,
    neutralCount,
    signals,
    summaryZh,
    fetchedAt: new Date().toISOString(),
  };

  cache.set(symbol, { ts: Date.now(), value: result });
  return result;
}
