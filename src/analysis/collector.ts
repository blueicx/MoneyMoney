// ============================================
// DATA COLLECTOR - Fetches and caches market data
// ============================================

import { api } from '../api';
import { Market, Orderbook, MarketStats, Category } from '../types';
import { MarketSnapshot } from './types';

export class DataCollector {
  private snapshotCache: Map<number, MarketSnapshot> = new Map();
  private historyCache: Map<number, MarketSnapshot[]> = new Map();
  private lastFetchTime: number = 0;
  private cacheTtlMs: number;

  constructor(cacheTtlSeconds: number = 30) {
    this.cacheTtlMs = cacheTtlSeconds * 1000;
  }

  /**
   * Fetch all open categories and their markets
   */
  async fetchOpenCategories(): Promise<Category[]> {
    const res = await api.getCategories(50);
    return res.data.filter(c => c.status === 'OPEN');
  }

  /**
   * Collect snapshots for all open markets (with caching)
   */
  async collectAllMarkets(): Promise<MarketSnapshot[]> {
    const now = Date.now();

    // Return cached if fresh enough
    if (now - this.lastFetchTime < this.cacheTtlMs && this.snapshotCache.size > 0) {
      return Array.from(this.snapshotCache.values());
    }

    const categories = await this.fetchOpenCategories();
    const snapshots: MarketSnapshot[] = [];

    for (const cat of categories) {
      for (const market of cat.markets) {
        try {
          const snapshot = await this.collectMarket(market);
          snapshots.push(snapshot);
        } catch (err) {
          // Skip markets that fail to load
        }
      }
    }

    // Update cache and history
    this.lastFetchTime = now;
    for (const snap of snapshots) {
      this.snapshotCache.set(snap.marketId, snap);

      let hist = this.historyCache.get(snap.marketId);
      if (!hist) {
        hist = [];
        this.historyCache.set(snap.marketId, hist);
      }
      hist.push(snap);
      // Keep last 100 data points per market
      if (hist.length > 100) hist.shift();
    }

    return snapshots;
  }

  /**
   * Collect a single market snapshot
   */
  async collectMarket(market: Market): Promise<MarketSnapshot> {
    const [obRes, statsRes] = await Promise.all([
      api.getOrderbook(market.id),
      api.getMarketStats(market.id)
    ]);

    const ob: Orderbook = obRes.data;
    const stats: MarketStats = statsRes.data;

    const bestBid = ob.bids.length > 0 ? ob.bids[0][0] : null;
    const bestAsk = ob.asks.length > 0 ? ob.asks[0][0] : null;

    let spread: number | null = null;
    let midPrice: number | null = null;
    if (bestBid !== null && bestAsk !== null) {
      spread = bestAsk - bestBid;
      midPrice = (bestBid + bestAsk) / 2;
    }

    const bidDepth = ob.bids.slice(0, 10).reduce((s, b) => s + b[1], 0);
    const askDepth = ob.asks.slice(0, 10).reduce((s, a) => s + a[1], 0);
    const totalDepth = bidDepth + askDepth;
    const imbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;

    return {
      marketId: market.id,
      title: market.title,
      categorySlug: market.categorySlug,
      status: market.status,
      feeRateBps: market.feeRateBps,
      isNegRisk: market.isNegRisk,
      isYieldBearing: market.isYieldBearing,
      outcomes: market.outcomes.map(o => o.name),
      bestBid,
      bestAsk,
      spread,
      midPrice,
      totalLiquidityUsd: stats.totalLiquidityUsd,
      volumeTotalUsd: stats.volumeTotalUsd,
      volume24hUsd: stats.volume24hUsd,
      bidDepth,
      askDepth,
      imbalance,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get historical snapshots for a market
   */
  getHistory(marketId: number): MarketSnapshot[] {
    return this.historyCache.get(marketId) || [];
  }

  /**
   * Get cached snapshot without fetching
   */
  getCached(marketId: number): MarketSnapshot | undefined {
    return this.snapshotCache.get(marketId);
  }

  clearCache(): void {
    this.snapshotCache.clear();
    this.historyCache.clear();
    this.lastFetchTime = 0;
  }
}

// Singleton instance
export const dataCollector = new DataCollector(30);
