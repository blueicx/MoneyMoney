import { pushNotification } from './notifications';
import { DATA_ROOT } from '../utils/paths';

// ============================================
// BINANCE PRICE FEED (free public API, no key needed)
// ============================================

export interface BinanceTicker {
  symbol: string;
  price: number;
  change24hPct: number;
  volume24hUsd: number;
  high24h: number;
  low24h: number;
}

export class BinanceFeed {
  private cache: Map<string, { data: any; time: number }> = new Map();
  private ttlMs = 10000;
  private baseUrl = 'https://data-api.binance.vision';

  async getPrice(symbol: string = 'BTCUSDT'): Promise<BinanceTicker | null> {
    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.time < this.ttlMs) return cached.data;
    try {
      const res = await fetch(`${this.baseUrl}/api/v3/ticker/24hr?symbol=${symbol}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return cached?.data || null;
      const d: any = await res.json() as any;
      const ticker: BinanceTicker = {
        symbol,
        price: parseFloat(d.lastPrice),
        change24hPct: parseFloat(d.priceChangePercent),
        volume24hUsd: parseFloat(d.quoteVolume),
        high24h: parseFloat(d.highPrice),
        low24h: parseFloat(d.lowPrice),
      };
      this.cache.set(symbol, { data: ticker, time: Date.now() });
      return ticker;
    } catch { return cached?.data || null; }
  }

  async getMultiplePrices(symbols: string[]): Promise<Record<string, BinanceTicker>> {
    const results: Record<string, BinanceTicker> = {};
    await Promise.all(symbols.map(async (s) => {
      const t = await this.getPrice(s);
      if (t) results[s] = t;
    }));
    return results;
  }

  async getKlines(symbol: string, interval: string = '1h', limit: number = 100): Promise<any[]> {
    const key = 'kline:' + symbol + ':' + interval;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < this.ttlMs * 6) return cached.data;
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) return [];
      const raw: any[] = await res.json() as any;
      const klines = raw.map((k) => ({
        time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
        low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
        quoteVolume: parseFloat(k[7]),
        takerBuyQuoteVolume: parseFloat(k[10]),
      }));
      this.cache.set(key, { data: klines, time: Date.now() });
      return klines;
    } catch { return []; }
  }

  async getDepth(symbol: string, limit: number = 20): Promise<{ bids: number[][]; asks: number[][] } | null> {
    const key = 'depth:' + symbol + ':' + limit;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < this.ttlMs * 3) return cached.data;
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v3/depth?symbol=${symbol}&limit=${limit}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return null;
      const d: any = await res.json() as any;
      const depth = {
        bids: d.bids.map((b: string[]) => [parseFloat(b[0]), parseFloat(b[1])]),
        asks: d.asks.map((a: string[]) => [parseFloat(a[0]), parseFloat(a[1])]),
      };
      this.cache.set(key, { data: depth, time: Date.now() });
      return depth;
    } catch { return null; }
  }

  async getTopMovers(): Promise<{ gainers: any[]; losers: any[] }> {
    const key = 'movers';
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < this.ttlMs * 30) return cached.data;
    try {
      const res = await fetch(`${this.baseUrl}/api/v3/ticker/24hr`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return { gainers: [], losers: [] };
      const all: any[] = await res.json() as any;
      const usdtPairs = all
        .filter((t: any) => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 1000000)
        .map((t: any) => ({
          symbol: t.symbol,
          price: parseFloat(t.lastPrice),
          changePct: parseFloat(t.priceChangePercent),
          volumeUsd: Math.round(parseFloat(t.quoteVolume)),
        }));
      const sorted = [...usdtPairs].sort((a, b) => b.changePct - a.changePct);
      const result = { gainers: sorted.slice(0, 10), losers: sorted.slice(-10).reverse() };
      this.cache.set(key, { data: result, time: Date.now() });
      return result;
    } catch { return { gainers: [], losers: [] }; }
  }

  async getRecentTrades(symbol: string, limit: number = 15): Promise<any[]> {
    const key = 'trades:' + symbol + ':' + limit;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < this.ttlMs) return cached.data as any;
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v3/trades?symbol=${symbol}&limit=${limit}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return [];
      const raw: any[] = await res.json() as any;
      const trades = raw.map((t: any) => ({
        id: t.id, price: parseFloat(t.price), qty: parseFloat(t.qty),
        time: t.time, isBuyerMaker: t.isBuyerMaker,
      }));
      this.cache.set(key, { data: trades, time: Date.now() });
      return trades;
    } catch { return []; }
  }
}

// ============================================
// PRICE ALERT MANAGER
// ============================================

interface PriceAlert {
  id: string;
  symbol: string;
  direction: 'ABOVE' | 'BELOW';
  price: number;
  createdAt: number;
  triggered: boolean;
}

class PriceAlertManager {
  private alerts: PriceAlert[] = [];
  private alertsFile = DATA_ROOT + '/alerts.json';

  constructor() { this.load(); }

  load() {
    try {
      const fsMod = require('fs');
      const pathMod = require('path');
      if (fsMod.existsSync(this.alertsFile)) {
        this.alerts = JSON.parse(fsMod.readFileSync(this.alertsFile, 'utf-8'));
      }
    } catch { this.alerts = []; }
  }

  save() {
    const fsMod = require('fs');
    const pathMod = require('path');
    fsMod.mkdirSync(pathMod.dirname(this.alertsFile), { recursive: true });
    fsMod.writeFileSync(this.alertsFile, JSON.stringify(this.alerts, null, 2));
  }

  add(symbol: string, direction: 'ABOVE' | 'BELOW', price: number): PriceAlert {
    const alert: PriceAlert = {
      id: Date.now().toString(), symbol, direction, price,
      createdAt: Date.now(), triggered: false,
    };
    this.alerts.push(alert);
    this.save();
    return alert;
  }

  remove(id: string) { this.alerts = this.alerts.filter(a => a.id !== id); this.save(); }
  // Aliases for server.ts compatibility
  addAlert(symbol: string, price: number, direction: string): PriceAlert {
    return this.add(symbol, direction.toUpperCase() as 'ABOVE' | 'BELOW', price);
  }
  removeAlert(id: string): boolean {
    const found = this.alerts.some(a => a.id === id);
    if (found) { this.remove(id); return true; }
    return false;
  }
  getAll() { return this.alerts.filter(a => !a.triggered); }
  getAlerts() { return this.alerts.filter(a => !a.triggered); }
  getAllHistory() { return this.alerts; }

  async checkAlerts(feed: BinanceFeed) {
    for (const alert of this.alerts) {
      if (alert.triggered) continue;
      const t = await feed.getPrice(alert.symbol);
      if (!t) continue;
      const hit = (alert.direction === 'ABOVE' && t.price >= alert.price) ||
                  (alert.direction === 'BELOW' && t.price <= alert.price);
      if (hit) {
        alert.triggered = true;
        this.save();
        pushNotification('alert', alert.symbol + ' price ' + alert.direction.toLowerCase() + ' ' + alert.price);
      }
    }
  }
}

// ============================================
// ANOMALY DETECTOR
// ============================================

export class AnomalyDetector {
  private ticks: Map<string, { prices: number[]; volumes: number[] }> = new Map();

  recordTick(symbol: string, price: number, volume: number) {
    if (!this.ticks.has(symbol)) this.ticks.set(symbol, { prices: [], volumes: [] });
    const entry = this.ticks.get(symbol)!;
    entry.prices.push(price);
    entry.volumes.push(volume);
    if (entry.prices.length > 100) { entry.prices.shift(); entry.volumes.shift(); }
  }

  detect(symbol: string): any | null {
    const entry = this.ticks.get(symbol);
    if (!entry || entry.prices.length < 5) return null;
    const recent = entry.prices.slice(-5);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const current = recent[recent.length - 1];
    const changePct = ((current - avg) / avg) * 100;
    if (Math.abs(changePct) > 3) {
      return {
        symbol,
        type: Math.abs(changePct) > 5 ? 'extreme_move' : 'large_move',
        changePct: Math.round(changePct * 100) / 100,
        message: symbol + ' moved ' + changePct.toFixed(2) + '% in recent window',
      };
    }
    return null;
  }
}

export const binanceFeed = new BinanceFeed();
export const alertManager = new PriceAlertManager();
export const anomalyDetector = new AnomalyDetector();
