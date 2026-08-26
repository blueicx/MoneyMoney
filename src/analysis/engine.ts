// ============================================
// ANALYSIS ENGINE - Computes signals and generates recommendations
// ============================================

import { MarketSnapshot, Signal, Recommendation, AnalysisReport } from './types';
import { SentimentAnalyzer } from './sentiment';
import { DataCollector } from './collector';

export class AnalysisEngine {
  private collector: DataCollector;
  private sentimentAnalyzer: SentimentAnalyzer;
  private cachedSentimentSignals: Signal[] = [];

  constructor(collector: DataCollector) {
    this.collector = collector;
    this.sentimentAnalyzer = new SentimentAnalyzer(300);
  }

  /**
   * Refresh external sentiment signals (call once per analysis cycle)
   */
  async refreshSentiment(): Promise<void> {
    try {
      const report = await this.sentimentAnalyzer.getSentiment();
      this.cachedSentimentSignals = this.sentimentAnalyzer.generateSignals(report);
    } catch {
      this.cachedSentimentSignals = [];
    }
  }

  getSentimentSummary(): { overall: number; bullish: number; bearish: number; neutral: number; fearGreedLabel: string | null } | null {
    // Return last cached sentiment info
    const sig = this.cachedSentimentSignals.find(s => s.reason?.includes('sentiment'));
    if (!sig && this.cachedSentimentSignals.length === 0) return null;
    return {
      overall: this.cachedSentimentSignals.length,
      bullish: this.cachedSentimentSignals.filter(s => s.direction === 'BULLISH').length,
      bearish: this.cachedSentimentSignals.filter(s => s.direction === 'BEARISH').length,
      neutral: this.cachedSentimentSignals.filter(s => s.direction === 'NEUTRAL').length,
      fearGreedLabel: null
    };
  }

  /**
   * Run full analysis on all open markets
   */
  async analyzeAll(): Promise<AnalysisReport> {
    const snapshots = await this.collector.collectAllMarkets();
    const recommendations: Recommendation[] = [];

    for (const snap of snapshots) {
      try {
        const rec = this.analyzeMarket(snap);
        if (rec) recommendations.push(rec);
      } catch {
        // Skip markets that fail analysis
      }
    }

    // Sort by confidence descending
    recommendations.sort((a, b) => b.confidence - a.confidence);

    return {
      timestamp: new Date().toISOString(),
      totalMarkets: snapshots.length,
      analyzedMarkets: recommendations.length,
      recommendations,
      topOpportunities: recommendations.filter(r => r.confidence >= 60).slice(0, 10)
    };
  }

  /**
   * Analyze a single market and generate a recommendation
   */
  analyzeMarket(snap: MarketSnapshot): Recommendation | null {
    if (!snap.midPrice || !snap.bestBid || !snap.bestAsk) return null;

    const history = this.collector.getHistory(snap.marketId);
    const signals: Signal[] = [...this.cachedSentimentSignals];

    // --- Signal 1: Order Book Imbalance ---
    if (Math.abs(snap.imbalance) > 0.15) {
      const direction = snap.imbalance > 0 ? 'BULLISH' : 'BEARISH';
      const strength = Math.min(Math.abs(snap.imbalance) * 200, 100);
      signals.push({
        type: 'IMBALANCE',
        direction,
        strength,
        reason: `Order book imbalance ${(snap.imbalance * 100).toFixed(1)}% ${snap.imbalance > 0 ? 'buy' : 'sell'} pressure`
      });
    }

    // --- Signal 2: Spread Quality ---
    if (snap.spread !== null && snap.spread > 0.02) {
      signals.push({
        type: 'SPREAD',
        direction: 'NEUTRAL',
        strength: Math.max(0, 50 - snap.spread * 500),
        reason: `Wide spread ($${snap.spread.toFixed(3)}) - low liquidity or high uncertainty`
      });
    } else if (snap.spread !== null && snap.spread < 0.01) {
      signals.push({
        type: 'SPREAD',
        direction: 'NEUTRAL',
        strength: 70,
        reason: `Tight spread ($${snap.spread.toFixed(3)}) - good liquidity for entry`
      });
    }

    // --- Signal 3: Momentum (price trend from history) ---
    if (history.length >= 5) {
      const prices = history.map(h => h.midPrice).filter(p => p !== null) as number[];
      if (prices.length >= 5) {
        const recent = prices.slice(-5);
        const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
        const prevAvg = prices.slice(-10, -5).length >= 5
          ? prices.slice(-10, -5).reduce((a, b) => a + b, 0) / prices.slice(-10, -5).length
          : avgRecent;

        const momentum = avgRecent - prevAvg;
        if (Math.abs(momentum) > 0.005) {
          const direction = momentum > 0 ? 'BULLISH' : 'BEARISH';
          const strength = Math.min(Math.abs(momentum) * 3000, 100);
          signals.push({
            type: 'MOMENTUM',
            direction,
            strength,
            reason: `Price momentum ${momentum > 0 ? '+' : ''}${(momentum * 100).toFixed(2)}% over last ${recent.length} data points`
          });
        }
      }
    }

    // --- Signal 4: Liquidity Score ---
    if (snap.totalLiquidityUsd > 5000) {
      signals.push({
        type: 'LIQUIDITY',
        direction: 'NEUTRAL',
        strength: Math.min(snap.totalLiquidityUsd / 1000, 100),
        reason: `High liquidity $${snap.totalLiquidityUsd.toFixed(0)}`
      });
    } else if (snap.totalLiquidityUsd < 500) {
      signals.push({
        type: 'LIQUIDITY',
        direction: 'NEUTRAL',
        strength: 20,
        reason: `Low liquidity $${snap.totalLiquidityUsd.toFixed(0)} - slippage risk`
      });
    }

    // --- Generate recommendation from signals ---
    let bullishScore = 0;
    let bearishScore = 0;
    let neutralWeight = 0;

    for (const sig of signals) {
      if (sig.direction === 'BULLISH') bullishScore += sig.strength;
      else if (sig.direction === 'BEARISH') bearishScore += sig.strength;
      else neutralWeight += sig.strength * 0.3; // Neutral signals slightly reduce confidence
    }

    const netScore = bullishScore - bearishScore;
    const absNet = Math.abs(netScore);
    const confidence = Math.min(Math.max(absNet - neutralWeight, 0), 100);

    let action: Recommendation['action'] = 'HOLD';
    if (confidence >= 30) {
      if (netScore > 0) action = 'BUY_YES';
      else action = 'BUY_NO';
    }

    // Calculate entry/exit levels
    const decimalPrecision = 3;
    const factor = 10 ** decimalPrecision;
    let entryPrice: number | null = null;
    let stopLoss: number | null = null;
    let takeProfit: number | null = null;

    if (action !== 'HOLD') {
      entryPrice = action === 'BUY_YES' ? snap.bestAsk! : (factor - Math.round(snap.bestBid! * factor)) / factor;
      stopLoss = action === 'BUY_YES'
        ? Math.max(entryPrice * 0.85, 0.05)
        : Math.max(entryPrice * 0.85, 0.05);
      takeProfit = action === 'BUY_YES'
        ? Math.min(entryPrice * 1.25, 0.95)
        : Math.min(entryPrice * 1.25, 0.95);
    }

    // Suggested position size based on liquidity and confidence
    const maxPositionPct = 0.05; // Max 5% of available capital per trade
    const suggestedSize = action !== 'HOLD'
      ? Math.floor(Math.min(
          snap.totalLiquidityUsd * 0.01, // 1% of market liquidity
          100 * (confidence / 100)       // Up to $100 scaled by confidence
        ))
      : null;

    const summary = this.buildSummary(action, confidence, signals, snap);

    return {
      marketId: snap.marketId,
      title: snap.title,
      action,
      confidence: Math.round(confidence),
      entryPrice,
      suggestedSize,
      stopLoss,
      takeProfit,
      signals,
      summary
    };
  }

  private buildSummary(
    action: Recommendation['action'],
    confidence: number,
    signals: Signal[],
    snap: MarketSnapshot
  ): string {
    const parts: string[] = [];

    parts.push(`${action.replace('_', ' ')} @ ${Math.round(confidence)}% confidence`);

    const activeSignals = signals.filter(s => s.direction !== 'NEUTRAL');
    if (activeSignals.length > 0) {
      parts.push(`Signals: ${activeSignals.map(s => `${s.type}(${s.direction[0]})`).join(', ')}`);
    }

    if (snap.volume24hUsd > 0) {
      parts.push(`24h Vol: $${snap.volume24hUsd.toFixed(0)}`);
    }

    return parts.join(' | ');
  }
}

