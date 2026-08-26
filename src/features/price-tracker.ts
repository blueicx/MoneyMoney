// ============================================
// PRICE HISTORY TRACKER & CORRELATION ANALYSIS
// ============================================

import fs from 'fs';
import path from 'path';

import { DATA_ROOT } from '../utils/paths';
const DATA_DIR = DATA_ROOT;
const HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');

interface PricePoint {
  t: number; // timestamp
  p: number; // price
}

interface MarketHistory {
  [marketId: string]: {
    title: string;
    yes: PricePoint[];
    no: PricePoint[];
  };
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadHistory(): MarketHistory {
  ensureDataDir();
  if (fs.existsSync(HISTORY_FILE)) {
    try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return {}; }
  }
  return {};
}

function saveHistory(h: MarketHistory): void {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h));
}

let history: MarketHistory = loadHistory();

export class PriceTracker {

  /**
   * Record a price snapshot for a market
   */
  record(marketId: number, title: string, yesPrice: number | null, noPrice: number | null): void {
    const key = marketId.toString();
    if (!history[key]) {
      history[key] = { title, yes: [], no: [] };
    }
    const now = Date.now();
    if (yesPrice !== null) {
      history[key].yes.push({ t: now, p: yesPrice });
      if (history[key].yes.length > 500) history[key].yes.shift();
    }
    if (noPrice !== null) {
      history[key].no.push({ t: now, p: noPrice });
      if (history[key].no.length > 500) history[key].no.shift();
    }
    saveHistory(history);
  }

  getMarketHistory(marketId: number): { yes: PricePoint[]; no: PricePoint[]; title: string } | null {
    return history[marketId.toString()] || null;
  }

  getAllTrackedMarkets(): Array<{ marketId: number; title: string; pointsCount: number }> {
    return Object.entries(history).map(([id, h]) => ({
      marketId: parseInt(id),
      title: h.title,
      pointsCount: Math.max(h.yes.length, h.no.length)
    }));
  }

  /**
   * Calculate Pearson correlation between two markets' YES prices
   */
  correlation(marketA: number, marketB: number): number | null {
    const a = history[marketA.toString()];
    const b = history[marketB.toString()];
    if (!a || !b || a.yes.length < 5 || b.yes.length < 5) return null;

    // Align by nearest timestamps
    const minLength = Math.min(a.yes.length, b.yes.length);
    const aPrices = a.yes.slice(-minLength).map(p => p.p);
    const bPrices = b.yes.slice(-minLength).map(p => p.p);

    return this.pearson(aPrices, bPrices);
  }

  private pearson(x: number[], y: number[]): number {
    const n = x.length;
    const sumX = x.reduce((s, v) => s + v, 0);
    const sumY = y.reduce((s, v) => s + v, 0);
    const sumXY = x.reduce((s, v, i) => s + v * y[i], 0);
    const sumX2 = x.reduce((s, v) => s + v * v, 0);
    const sumY2 = y.reduce((s, v) => s + v * v, 0);

    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    if (den === 0) return 0;
    return num / den;
  }

  /**
   * Get correlations between all tracked markets
   */
  allCorrelations(): Array<{ a: number; b: number; corr: number; titleA: string; titleB: string }> {
    const markets = this.getAllTrackedMarkets();
    const results: Array<{ a: number; b: number; corr: number; titleA: string; titleB: string }> = [];

    for (let i = 0; i < markets.length; i++) {
      for (let j = i + 1; j < markets.length; j++) {
        const c = this.correlation(markets[i].marketId, markets[j].marketId);
        if (c !== null && Math.abs(c) > 0.1) {
          results.push({
            a: markets[i].marketId,
            b: markets[j].marketId,
            corr: parseFloat(c.toFixed(3)),
            titleA: markets[i].title,
            titleB: markets[j].title,
          });
        }
      }
    }
    return results.sort((x, y) => Math.abs(y.corr) - Math.abs(x.corr)).slice(0, 20);
  }
}

export const priceTracker = new PriceTracker();

