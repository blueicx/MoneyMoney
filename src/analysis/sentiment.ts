// ============================================
// SENTIMENT ANALYZER - External news & market sentiment via FREE sources
// ============================================
// Sources used:
//   1. alternative.me Fear & Greed Index  → https://api.alternative.me/fng/
//   2. CoinDesk RSS                       → https://www.coindesk.com/arc/outboundfeeds/rss/
//   3. CoinTelegraph RSS                  → https://cointelegraph.com/rss
//   4. Decrypt RSS                        → https://decrypt.co/feed
//
// All are completely free, no API keys required.
// ============================================

import { Signal } from './types';
import { parseRssItems } from '../utils/rss';

export interface FearGreedData {
  value: number;        // 0 = Extreme Fear, 100 = Extreme Greed
  label: string;
  timestamp: string;
}

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  sentimentScore: number; // -1 (very negative) to +1 (very positive)
  matchedKeywords: string[];
}

export interface SentimentReport {
  fearGreed: FearGreedData | null;
  news: NewsItem[];
  overallSentiment: number; // -1 to +1 weighted average
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  timestamp: string;
}

// ============================================
// KEYWORD-BASED SENTIMENT SCORING
// ============================================

const BULLISH_KEYWORDS = [
  'surge', 'rally', 'bullish', 'breakout', 'moon', 'pump', 'gain',
  'all-time high', 'ath', 'adoption', 'institutional', 'approve',
  'etf approved', 'upgrade', 'partnership', 'launch', 'milestone',
  'buy', 'accumulate', 'undervalued', 'recovery', 'rebound',
  '上涨', '大涨', '飙升', '创新高', '突破', '看涨', '利好',
  '获批', '回升', '反弹'
];

const BEARISH_KEYWORDS = [
  'crash', 'dump', 'bearish', 'plunge', 'drop', 'fall', 'decline',
  'liquidation', 'hack', 'exploit', 'regulation crackdown', 'ban',
  'lawsuit', 'sec sues', 'fraud', 'ponzi', 'sell-off', 'capitulation',
  'overvalued', 'bubble', 'correction', 'resistance', 'reject',
  '下跌', '大跌', '暴跌', '崩盘', '看跌', '利空', '清算',
  '黑客', '攻击', '盗取', '监管', '诉讼', '抛售'
];

function scoreTitle(title: string): { score: number; keywords: string[] } {
  const lower = title.toLowerCase();
  let score = 0;
  const matched: string[] = [];

  for (const kw of BULLISH_KEYWORDS) {
    if (lower.includes(kw)) {
      score += 1;
      matched.push(kw);
    }
  }

  for (const kw of BEARISH_KEYWORDS) {
    if (lower.includes(kw)) {
      score -= 1;
      matched.push(kw);
    }
  }

  // Normalize to -1..+1
  const maxPossible = BULLISH_KEYWORDS.length + BEARISH_KEYWORDS.length;
  return { score: Math.max(-1, Math.min(1, score / 5)), keywords: matched };
}

// ============================================
// SENTIMENT DATA COLLECTOR
// ============================================

export class SentimentAnalyzer {
  private cachedReport: SentimentReport | null = null;
  private lastFetchTime: number = 0;
  private cacheTtlMs: number;

  constructor(cacheTtlSeconds: number = 300) {
    this.cacheTtlMs = cacheTtlSeconds * 1000;
  }

  /**
   * Get full sentiment report (cached for performance)
   */
  async getSentiment(): Promise<SentimentReport> {
    const now = Date.now();

    if (this.cachedReport && now - this.lastFetchTime < this.cacheTtlMs) {
      return this.cachedReport;
    }

    console.log('  [Sentiment] Fetching external data...');

    const [fearGreed, news] = await Promise.all([
      this.fetchFearGreed(),
      this.fetchRssNews()
    ]);

    // Calculate overall sentiment
    let totalScore = 0;
    let weightSum = 0;

    if (news.length > 0) {
      const newsAvg = news.reduce((s, n) => s + n.sentimentScore, 0) / news.length;
      totalScore += newsAvg * 0.6;
      weightSum += 0.6;
    }

    if (fearGreed) {
      // Normalize F&G from 0-100 to -1..+1
      const fgNormalized = (fearGreed.value - 50) / 50;
      totalScore += fgNormalized * 0.4;
      weightSum += 0.4;
    }

    const overallSentiment = weightSum > 0 ? totalScore / weightSum : 0;

    const bullishCount = news.filter(n => n.sentimentScore > 0.1).length;
    const bearishCount = news.filter(n => n.sentimentScore < -0.1).length;
    const neutralCount = news.filter(n => n.sentimentScore >= -0.1 && n.sentimentScore <= 0.1).length;

    this.cachedReport = {
      fearGreed,
      news,
      overallSentiment,
      bullishCount,
      bearishCount,
      neutralCount,
      timestamp: new Date().toISOString()
    };
    this.lastFetchTime = now;

    return this.cachedReport;
  }

  /**
   * Generate trading signals based on sentiment
   */
  generateSignals(report: SentimentReport): Signal[] {
    const signals: Signal[] = [];

    // --- Signal 1: Overall Sentiment ---
    if (Math.abs(report.overallSentiment) > 0.05) {
      const direction = report.overallSentiment > 0 ? 'BULLISH' : 'BEARISH';
      const strength = Math.min(Math.abs(report.overallSentiment) * 200, 100);
      signals.push({
        type: 'SENTIMENT',
        direction,
        strength,
        reason: `Overall market sentiment ${direction.toLowerCase()} (${(report.overallSentiment * 100).toFixed(0)}%)`
      });
    }

    // --- Signal 2: Fear & Greed Index ---
    if (report.fearGreed) {
      const fg = report.fearGreed.value;

      if (fg <= 25) {
        // Extreme Fear = contrarian BUY signal
        signals.push({
          type: 'SENTIMENT',
          direction: 'BULLISH',
          strength: 80,
          reason: `Extreme Fear (${fg}) — historical contrarian buy zone`
        });
      } else if (fg >= 75) {
        // Extreme Greed = contrarian SELL signal
        signals.push({
          type: 'SENTIMENT',
          direction: 'BEARISH',
          strength: 80,
          reason: `Extreme Greed (${fg}) — historical contrarian sell zone`
        });
      } else if (fg <= 40) {
        signals.push({
          type: 'SENTIMENT',
          direction: 'BULLISH',
          strength: 50,
          reason: `Fear (${fg}) — mild contrarian buy bias`
        });
      } else if (fg >= 60) {
        signals.push({
          type: 'SENTIMENT',
          direction: 'BEARISH',
          strength: 50,
          reason: `Greed (${fg}) — mild contrarian sell bias`
        });
      }
    }

    // --- Signal 3: News Flow Imbalance ---
    if (report.bullishCount + report.bearishCount > 0) {
      const ratio = (report.bullishCount - report.bearishCount) / (report.bullishCount + report.bearishCount);
      if (Math.abs(ratio) > 0.3) {
        const direction = ratio > 0 ? 'BULLISH' : 'BEARISH';
        const strength = Math.min(Math.abs(ratio) * 150, 100);
        signals.push({
          type: 'SENTIMENT',
          direction,
          strength,
          reason: `News flow ${report.bullishCount} bullish vs ${report.bearishCount} bearish`
        });
      }
    }

    return signals;
  }

  /**
   * Fetch Crypto Fear & Greed Index from alternative.me (FREE, no key)
   */
  private async fetchFearGreed(): Promise<FearGreedData | null> {
    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=1');
      if (!res.ok) return null;
      const json = await res.json() as any;
      if (!json?.data?.[0]) return null;
      return {
        value: parseInt(json.data[0].value),
        label: json.data[0].value_classification,
        timestamp: json.data[0].timestamp
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch and score news from free RSS feeds
   */
  private async fetchRssNews(): Promise<NewsItem[]> {
    const feeds = [
      { url: 'https://www.panewslab.com/rss.xml?lang=zh&type=NEWS', source: 'PANews 中文' },
      { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk' },
      { url: 'https://cointelegraph.com/rss', source: 'CoinTelegraph' },
      { url: 'https://decrypt.co/feed', source: 'Decrypt' }
    ];

    const allNews: NewsItem[] = [];

    await Promise.allSettled(
      feeds.map(async ({ url, source }) => {
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(10000)
          });
          if (!res.ok) return;
          const xml = await res.text();

          for (const parsed of parseRssItems(xml, 15)) {
            const { score, keywords } = scoreTitle(parsed.title);

            allNews.push({
              title: parsed.title,
              link: parsed.link,
              source,
              publishedAt: parsed.date,
              sentimentScore: score,
              matchedKeywords: keywords
            });
          }
        } catch {
          // Feed unavailable, skip silently
        }
      })
    );

    return allNews
      .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime())
      .slice(0, 30);
  }

  clearCache(): void {
    this.cachedReport = null;
    this.lastFetchTime = 0;
  }
}
