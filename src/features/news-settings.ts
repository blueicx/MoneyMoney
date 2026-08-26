import { DATA_ROOT } from '../utils/paths';
// ============================================
// NEWS FEED + STRATEGY SETTINGS
// ============================================

import { SentimentAnalyzer } from '../analysis/sentiment';
import fs from 'fs';
import path from 'path';

// --- News Feed ---
export interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  sentimentScore?: number;
}

const sentiment = new SentimentAnalyzer();

export class NewsFeed {
  private cache: NewsItem[] = [];
  private lastFetch: number = 0;
  private ttlMs: number = 5 * 60 * 1000; // 5 min

  async getNews(): Promise<NewsItem[]> {
    if (Date.now() - this.lastFetch < this.ttlMs && this.cache.length > 0) {
      return this.cache;
    }

    try {
      const report = await sentiment.getSentiment();
      const chineseFirst = [...report.news].sort((a, b) => {
        const aZh = /[\u4e00-\u9fff]/.test(a.title) || a.source.includes('中文') ? 0 : 1;
        const bZh = /[\u4e00-\u9fff]/.test(b.title) || b.source.includes('中文') ? 0 : 1;
        if (aZh !== bZh) return aZh - bZh;
        return new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
      });

      const items: NewsItem[] = [];

      for (const article of chineseFirst.slice(0, 15)) {
        items.push({
          title: article.title,
          source: article.source,
          url: article.link || '' ,
          publishedAt: article.publishedAt,
          sentimentScore: article.sentimentScore,
        });
      }

      this.cache = items;
      this.lastFetch = Date.now();
      return items;
    } catch {
      return this.cache; // Return stale data on error
    }
  }
}

// --- Strategy Settings ---
interface StrategySettings {
  confidenceThreshold: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxDailyTrades: number;
  maxPositionPct: number;
  kellyFraction: number;
  momentumLookback: number;
  spreadMaxBps: number;
  sentimentWeight: number;
  paperTradingEnabled: boolean;
  telegramEnabled: boolean;
  autoTradeEnabled: boolean;
}

const SETTINGS_FILE = path.join(DATA_ROOT, 'settings.json');

function defaultSettings(): StrategySettings {
  return {
    confidenceThreshold: 0.65,
    stopLossPct: 15,
    takeProfitPct: 50,
    maxDailyTrades: 10,
    maxPositionPct: 5,
    kellyFraction: 0.25,
    momentumLookback: 10,
    spreadMaxBps: 500,
    sentimentWeight: 0.3,
    paperTradingEnabled: true,
    telegramEnabled: false,
    autoTradeEnabled: false,
  };
}

function loadSettings(): StrategySettings {
  const dir = path.join(DATA_ROOT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(SETTINGS_FILE)) {
    try { return { ...defaultSettings(), ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}
  }
  return defaultSettings();
}

export class SettingsManager {
  private settings: StrategySettings = loadSettings();

  get(): StrategySettings {
    return { ...this.settings };
  }

  update(partial: Partial<StrategySettings>): StrategySettings {
    this.settings = { ...this.settings, ...partial };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2));
    return { ...this.settings };
  }

  reset(): StrategySettings {
    this.settings = defaultSettings();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2));
    return { ...this.settings };
  }
}

export const newsFeed = new NewsFeed();
export const settingsManager = new SettingsManager();




