import { DATA_ROOT } from '../utils/paths';
import { getAiRuntimeConfig } from './ai-runtime-config';
import { resolveChatCompletionsUrl } from './ai-endpoint';
// ============================================
// AI ANALYSIS (Groq free API) + REDDIT SENTIMENT
// ============================================

export function resolveGroqApiUrl(explicitUrl = process.env.GROQ_API_URL, baseUrl = process.env.GROQ_BASE_URL): string {
  return resolveChatCompletionsUrl(explicitUrl, baseUrl, 'https://api.groq.com/openai/v1');
}

export class LLMAnalyzer {

  get isConfigured(): boolean {
    return getAiRuntimeConfig('groq').configured;
  }

  async analyze(prompt: string, systemPrompt?: string): Promise<string | null> {
    const runtime = getAiRuntimeConfig('groq');
    if (!runtime.configured) return null;

    try {
      const res = await fetch(runtime.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${runtime.apiKey}`,
        },
        body: JSON.stringify({
          model: runtime.model,
          messages: [
            { role: 'system', content: systemPrompt || 'You are a crypto prediction market analyst. Be concise and actionable.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 500,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) return null;
      const data: any = await res.json();
      return data.choices?.[0]?.message?.content || null;
    } catch {
      return null;
    }
  }

  async summarizeMarket(marketTitle: string, prices: string, sentiment: string): Promise<string | null> {
    return this.analyze(
      `Analyze this prediction market:\nMarket: ${marketTitle}\nPrices: ${prices}\nSentiment data: ${sentiment}\n\nGive a brief analysis with a BUY_YES, BUY_NO, or HOLD recommendation and confidence level (1-10).`
    );
  }
}

// ============================================
// REDDIT SOCIAL SENTIMENT (free public JSON API)
// ============================================

export interface RedditPost {
  title: string;
  subreddit: string;
  score: number;
  comments: number;
  url: string;
  createdUtc: number;
  sentimentScore: number;
}

export class RedditSentiment {
  private cache: RedditPost[] = [];
  private lastFetch = 0;
  private ttlMs = 5 * 60 * 1000;

  async getPosts(subreddits: string[] = ['CryptoCurrency', 'bitcoin', 'ethereum']): Promise<RedditPost[]> {
    if (Date.now() - this.lastFetch < this.ttlMs && this.cache.length > 0) {
      return this.cache;
    }

    const allPosts: RedditPost[] = [];

    for (const sub of subreddits) {
      try {
        const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=10`, {
          headers: { 'User-Agent': 'PredictFunBot/1.0' },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) continue;
        const json: any = await res.json();
        const posts = json?.data?.children || [];

        for (const { data: post } of posts) {
          const lower = post.title.toLowerCase();
          let score = 0;
          const posWords = ['surge','rally','bullish','moon','gain','rise','up','breakthrough','adoption','institutional'];
          const negWords = ['crash','drop','fall','bearish','loss','decline','down','fear','panic','liquidation'];
          for (const w of posWords) if (lower.includes(w)) score += 1;
          for (const w of negWords) if (lower.includes(w)) score -= 1;

          allPosts.push({
            title: post.title,
            subreddit: `r/${sub}`,
            score: post.score,
            comments: post.num_comments,
            url: `https://reddit.com${post.permalink}`,
            createdUtc: post.created_utc * 1000,
            sentimentScore: score,
          });
        }
      } catch {}
    }

    if (allPosts.length > 0) {
      this.cache = allPosts.sort((a, b) => b.score - a.score).slice(0, 20);
      this.lastFetch = Date.now();
    }
    return this.cache;
  }
}

// ============================================
// WHALE WALLET MONITOR (free blockchain.info API)
// ============================================

export interface WhaleTransaction {
  hash: string;
  amountBtc: number;
  time: number;
  usdValue: number;
}

export class WhaleMonitor {
  private lastFetch = 0;
  private ttlMs = 2 * 60 * 1000; // 2 min cache
  private cachedTxs: WhaleTransaction[] = [];
  private btcPrice = 0;

  async getRecentWhaleTransactions(thresholdUsd: number = 1000000): Promise<WhaleTransaction[]> {
    if (Date.now() - this.lastFetch < this.ttlMs && this.cachedTxs.length > 0) {
      return this.cachedTxs.filter(t => t.usdValue >= thresholdUsd);
    }

    try {
      // Get BTC price from Binance
      const btcRes = await fetch('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT', {
        signal: AbortSignal.timeout(8000),
      });
      if (!btcRes.ok) return this.cachedTxs;
      const btcData: any = await btcRes.json();
      this.btcPrice = parseFloat(btcData.price);

      // Get recent BTC transactions from blockchain.info
      const res = await fetch('https://blockchain.info/unconfirmed-transactions?format=json&limit=50', {
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return this.cachedTxs;

      const json: any = await res.json();
      const txs = json.txs || [];
      const whales: WhaleTransaction[] = [];

      for (const tx of txs) {
        const totalOut = tx.out.reduce((s: number, o: any) => s + (o.value || 0), 0);
        const amountBtc = totalOut / 100000000; // satoshi to BTC
        const usdValue = amountBtc * this.btcPrice;

        if (usdValue >= thresholdUsd) {
          whales.push({
            hash: tx.hash,
            amountBtc: parseFloat(amountBtc.toFixed(4)),
            time: tx.time * 1000,
            usdValue: Math.round(usdValue),
          });
        }
      }

      this.cachedTxs = whales.sort((a, b) => b.usdValue - a.usdValue).slice(0, 15);
      this.lastFetch = Date.now();
      return this.cachedTxs;
    } catch {
      return this.cachedTxs.filter(t => t.usdValue >= thresholdUsd);
    }
  }
}

// ============================================
// MULTI-STRATEGY COMPARISON
// ============================================

import fs from 'fs';
import path from 'path';

interface StrategyResult {
  name: string;
  balance: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
}

const STRATEGIES_FILE = path.join(DATA_ROOT, 'strategy-comparison.json');

function loadStrategies(): StrategyResult[] {
  if (fs.existsSync(STRATEGIES_FILE)) {
    try { return JSON.parse(fs.readFileSync(STRATEGIES_FILE, 'utf8')); } catch {}
  }
  return [
    { name: '动量策略', balance: 1000, trades: 0, wins: 0, losses: 0, winRate: 0, totalReturnPct: 0, maxDrawdownPct: 0 },
    { name: '均值回归策略', balance: 1000, trades: 0, wins: 0, losses: 0, winRate: 0, totalReturnPct: 0, maxDrawdownPct: 0 },
    { name: '订单失衡策略', balance: 1000, trades: 0, wins: 0, losses: 0, winRate: 0, totalReturnPct: 0, maxDrawdownPct: 0 },
    { name: 'AI 情绪策略', balance: 1000, trades: 0, wins: 0, losses: 0, winRate: 0, totalReturnPct: 0, maxDrawdownPct: 0 },
  ];
}

export class StrategyComparison {
  private strategies: StrategyResult[] = loadStrategies();

  get(): StrategyResult[] {
    return [...this.strategies].sort((a, b) => b.totalReturnPct - a.totalReturnPct);
  }

  recordTrade(strategyName: string, pnlPct: number): void {
    const s = this.strategies.find(x => x.name === strategyName);
    if (!s) return;

    s.trades++;
    s.balance *= (1 + pnlPct / 100);
    if (pnlPct >= 0) s.wins++; else s.losses++;
    s.winRate = s.trades > 0 ? s.wins / s.trades : 0;
    s.totalReturnPct = ((s.balance - 1000) / 1000) * 100;

    fs.writeFileSync(STRATEGIES_FILE, JSON.stringify(this.strategies, null, 2));
  }

  resetAll(): StrategyResult[] {
    this.strategies.forEach(s => {
      s.balance = 1000; s.trades = 0; s.wins = 0; s.losses = 0; s.winRate = 0; s.totalReturnPct = 0; s.maxDrawdownPct = 0;
    });
    fs.writeFileSync(STRATEGIES_FILE, JSON.stringify(this.strategies, null, 2));
    return [...this.strategies];
  }
}

// ============================================
// AUTO TRADE JOURNAL
// ============================================

export interface JournalEntry {
  timestamp: string;
  action: string;
  market: string;
  details: string;
  outcome?: string;
  reasoning?: string;
  result?: string;
}

const JOURNAL_FILE = path.join(DATA_ROOT, 'trade-journal.json');

function loadJournal(): JournalEntry[] {
  if (fs.existsSync(JOURNAL_FILE)) {
    try { return JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8')); } catch {}
  }
  return [];
}

export class TradeJournal {
  private entries: JournalEntry[] = loadJournal();

  log(action: string, market: string, details: string, reasoning?: string): void {
    this.entries.unshift({
      timestamp: new Date().toISOString(),
      action, market, details, reasoning,
    });
    if (this.entries.length > 200) this.entries.pop();
    fs.writeFileSync(JOURNAL_FILE, JSON.stringify(this.entries, null, 2));
  }

  get(count: number = 30): JournalEntry[] {
    return this.entries.slice(0, count);
  }

  clear(): JournalEntry[] {
    this.entries = [];
    fs.writeFileSync(JOURNAL_FILE, JSON.stringify(this.entries, null, 2));
    return [];
  }
}

export const llmAnalyzer = new LLMAnalyzer();
export const redditSentiment = new RedditSentiment();
export const whaleMonitor = new WhaleMonitor();
export const strategyComparison = new StrategyComparison();
export const tradeJournal = new TradeJournal();





