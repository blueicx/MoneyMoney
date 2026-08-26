#!/usr/bin/env ts-node
/**
 * 💰 MONEYMONEY TRADING DASHBOARD
 */

import express from 'express';
import cors from 'cors';
import zlib from 'zlib';
import iconv from 'iconv-lite';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config, validateConfig } from '../config';
import { api } from '../api';
import { tradingEngine } from '../trading';
import { DataCollector } from '../analysis/collector';
import { AnalysisEngine } from '../analysis/engine';
import { paperEngine } from '../features/paper-trading';
import { telegram } from '../features/telegram';
import { priceTracker } from '../features/price-tracker';
import { kellySizer, backtester } from '../features/kelly-backtest';
import { pushNotification } from '../features/notifications';
import { newsFeed, settingsManager } from '../features/news-settings';
import { reportScheduler } from '../features/report-scheduler';
import { binanceFeed, alertManager, anomalyDetector } from '../features/binance';
import { llmAnalyzer, redditSentiment, whaleMonitor, strategyComparison, tradeJournal } from '../features/ai-social';
import { binancePortfolio } from '../features/binance-portfolio';
import { getEquityOptionsSnapshot, getOptionsSnapshot } from '../features/options-market';
import { getMacroCalendar, getGlobalCryptoMetrics } from '../features/external-market-data';
import { getStablecoinLiquidity } from '../features/stablecoin-liquidity';
import { getYieldQuality } from '../features/yield-quality';
import { getCotRadar } from '../features/cftc-positioning';
import { getInsiderRadar } from '../features/insider-transactions';
import { getAnalystConsensusSnapshot } from '../features/analyst-consensus';
import { getFundamentalQuality } from '../features/fundamental-quality';
import { getShortInterestSnapshot } from '../features/short-interest';
import { getMarketBreadthSnapshot } from '../features/market-breadth';
import { getInstitutionalOwnershipSnapshot } from '../features/institutional-ownership';
import { getFearGreed, getFundingRates } from '../features/market-sentiment';
import { getGlobalMacroSpotSnapshot } from '../features/global-macro-spot';
import { getCrossAssetCorrelationRadar } from '../features/cross-asset-correlation';
import { getPerpetualCrowding } from '../features/perpetual-crowding';
import { getFundingCarryRadar } from '../features/funding-carry';
import { getOrderFlowLiquidityRadar } from '../features/order-flow-liquidity';
import { getBitcoinOnchainRadar } from '../features/bitcoin-onchain';
import { getEconomicIndicators } from '../features/economic-indicators';
import { getTreasuryYields } from '../features/treasury-yields';
import { getEarningsCalendar } from '../features/earnings-calendar';
import { getUpcomingEventCalendar } from '../features/event-calendar';
import { getCrossAssetRisk } from '../features/cross-asset-risk';
import { getMarketRegime } from '../features/market-regime';
import { getSupportResistance } from '../features/support-resistance';
import { getMultiTimeframeConfluence } from '../features/multi-timeframe';
import { getEventRisk } from '../features/event-risk';
import { getCachedPredictionRadarSlice, getPredictionRadar, warmPredictionRadarCache } from '../features/prediction-radar';
import { getPredictionHistory } from '../features/prediction-history';
import { getForecastLabReport, resolveForecastCase } from '../features/forecast-lab';
import { calculatePredictionPosition } from '../features/prediction-position-sizer';
import { getAiMarketCommentary } from '../features/ai-commentary';
import { buildPortfolioRiskOverview } from '../features/risk-overview';
import { getRiskHistory, recordRiskHistory } from '../features/risk-history';
import { buildDailyResearchBriefing } from '../features/research-briefing';
import { getAssistantCalibration, getAssistantJournalTrades, saveTradeNote } from '../features/assistant-journal';
import { exportJournalCsv, exportPaperCsv, exportCalibrationCsv, exportForecastLabCsv } from '../features/data-export';
import { generateAssistantReport } from '../features/trade-assistant';
import { getSourceHealth } from '../features/source-health';
import { testNotificationChannels } from '../features/notification-channels';
import { riskPatrol } from '../features/risk-patrol';
import type { Category } from '../types';
import QRCode from 'qrcode';
import os from 'os';
import { parseRssItems } from '../utils/rss';

const app = express();
app.use(cors());
app.use(express.json());

// Compress large text responses (the single-file dashboard is ~400KB raw).
app.use((req, res, next) => {
  if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return next();
  if (res.headersSent) return next();
  const originalSend = res.send.bind(res);
  (res as any).send = (body: any) => {
    const contentType = String(res.getHeader('Content-Type') || '');
    const compressible = /text\/html|application\/json|javascript|text\/css|image\/svg/i.test(contentType);
    if (!compressible || res.getHeader('Content-Encoding')) return originalSend(body);
    const raw = Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === 'object' && body !== null ? JSON.stringify(body) : String(body ?? ''), 'utf8');
    if (raw.length < 2048) return originalSend(raw);
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.removeHeader('Content-Length');
    return originalSend(zlib.gzipSync(raw));
  };
  next();
});

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
// Serve the main page before static middleware so it goes through compression.
app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  fs.promises.readFile(path.join(__dirname, 'public', 'index.html'))
    .then(html => {
      res.type('html');
      res.send(html);
    })
    .catch(() => res.status(500).send('Dashboard assets missing'));
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

// API Routes

// Lightweight identity check used by the desktop launcher.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'MoneyMoney' });
});

type CategorySnapshot = { data: Category[]; fetchedAt?: string };
const CATEGORY_CACHE_FILE = path.join(process.cwd(), 'data', 'predict-categories-cache.json');
let categorySnapshot: CategorySnapshot = (() => {
  try {
    const raw = fs.readFileSync(CATEGORY_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as CategorySnapshot;
    return Array.isArray(parsed.data) ? parsed : { data: [] };
  } catch {
    return { data: [] };
  }
})();
let categoryRefresh: Promise<boolean> | null = null;

async function refreshCategorySnapshot(): Promise<boolean> {
  if (categoryRefresh) return categoryRefresh;
  categoryRefresh = (async () => {
    try {
      // Ask the API for OPEN records directly, then follow a few pages so newly
      // published events are not pushed out by older unresolved categories.
      const collected: Category[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 3; page++) {
        const response = await api.getCategories(50, cursor, 'OPEN');
        collected.push(...response.data);
        cursor = response.cursor || undefined;
        if (!cursor) break;
      }

      // Some recurring markets stay OPEN briefly after their trading window ends.
      // Keep a short settlement grace period, but hide clearly stale cards.
      const staleCutoff = Date.now() - 15 * 60_000;
      const openCategories = collected
        .filter(c => c.status === 'OPEN' && c.isVisible !== false)
        .filter(c => !c.endsAt || new Date(c.endsAt).getTime() > staleCutoff)
        .sort((a, b) => new Date(a.endsAt || a.startsAt).getTime()
          - new Date(b.endsAt || b.startsAt).getTime());
      if (!openCategories.length) return false;

      categorySnapshot = { data: openCategories, fetchedAt: new Date().toISOString() };
      await fs.promises.mkdir(path.dirname(CATEGORY_CACHE_FILE), { recursive: true });
      await fs.promises.writeFile(CATEGORY_CACHE_FILE, JSON.stringify(categorySnapshot), 'utf8');
      return true;
    } catch {
      // Keep the last good snapshot; the next UI refresh will try again.
      return false;
    } finally {
      categoryRefresh = null;
    }
  })();
  return categoryRefresh;
}

// Get all open categories with markets. A disk snapshot makes repeat launches
// paint instantly; the live source refreshes in the background.
app.get('/api/categories', async (req, res) => {
  const force = req.query.refresh === '1';
  if (categorySnapshot.data.length && !force) {
    void refreshCategorySnapshot();
    res.json({ success: true, data: categorySnapshot.data, cached: true, fetchedAt: categorySnapshot.fetchedAt });
    return;
  }

  const refreshed = await refreshCategorySnapshot();
  if (categorySnapshot.data.length) {
    res.json({ success: true, data: categorySnapshot.data, cached: !refreshed, fetchedAt: categorySnapshot.fetchedAt });
    return;
  }
  res.json({ success: false, error: 'Predict.fun 数据源暂时不可用，且暂无本地快照' });
});

// Get market stats and orderbooks through short shared caches. The category list
// can create hundreds of card updates, so duplicate requests must not multiply
// upstream traffic or crowd out slower dashboard sections.
app.get('/api/markets/:id/stats', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const response = await getFreshExternal(`market-stats:${id}`, 30_000,
      () => api.getMarketStats(id));
    res.json({ success: true, data: response.data });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/markets/:id/orderbook', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const response = await getFreshExternal(`market-orderbook:${id}`, 20_000,
      () => api.getOrderbook(id));
    res.json({ success: true, data: response.data });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// --- Binance Extended ---

app.get('/api/binance/klines', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTCUSDT');
    const interval = String(req.query.interval || '1h');
    const limit = parseInt(String(req.query.limit || '100'));
    const klines = await binanceFeed.getKlines(symbol, interval, limit);
    res.json({ success: true, data: klines });
  } catch (e: any) { res.json({ success: false, error: e.message }); }
});

app.get('/api/binance/depth', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTCUSDT');
    const depthLimit = parseInt(String(req.query.limit || '20'));
    const depth = await binanceFeed.getDepth(symbol, depthLimit);
    res.json({ success: !!depth, data: depth });
  } catch (e: any) { res.json({ success: false, error: e.message }); }
});

app.get('/api/binance/movers', async (req, res) => {
  try {
    const movers = await binanceFeed.getTopMovers();
    res.json({ success: true, data: movers });
  } catch (e: any) { res.json({ success: false, error: e.message }); }
});

app.get('/api/binance/trades', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTCUSDT');
    const tradesLimit = parseInt(String(req.query.limit || '15'));
    const trades = await binanceFeed.getRecentTrades(symbol, tradesLimit);
    res.json({ success: true, data: trades });
  } catch (e: any) { res.json({ success: false, error: e.message }); }
});

// --- Market Sentiment ---

app.get('/api/sentiment', async (req, res) => {
  try {
    const cached = getCached('sentiment');
    if (cached) return res.json({ success: true, data: cached });
    const apiRes = await fetch('https://api.alternative.me/fng/?limit=7', { signal: AbortSignal.timeout(10000) });
    if (!apiRes.ok) throw new Error('F&G API failed');
    const d: any = await apiRes.json();
    setCached('sentiment', d.data);
    res.json({ success: true, data: d.data });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/heatmap', async (req, res) => {
  try {
    const cached = getCached('heatmap');
    if (cached) return res.json({ success: true, data: cached });
    // Get top coins by volume
    const movers = await binanceFeed.getTopMovers();
    const all = [...movers.gainers, ...movers.losers];
    
    // Also get specific popular coins
    const popular = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','DOTUSDT','LINKUSDT','MATICUSDT','UNIUSDT'];
    const tickers: any[] = [];
    await Promise.all(popular.map(async (sym) => {
      const t = await binanceFeed.getPrice(sym);
      if (t) tickers.push({ symbol: sym, changePct: t.change24hPct, price: t.price, volumeUsd: Math.round(t.volume24hUsd) });
    }));
    
    const result = { heatmap: tickers, movers: all };
    setCached('heatmap', result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Crypto Paper Trading ---

interface CryptoPaperPosition {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  amountUsd: number;
  quantity: number;
  openedAt: number;
}

const cryptoPositions: CryptoPaperPosition[] = [];

app.post('/api/binance/paper-trade', async (req, res) => {
  try {
    const { symbol, side, amountUsd } = req.body;
    const ticker = await binanceFeed.getPrice(symbol);
    if (!ticker) { res.json({ success: false, message: '无法获取价格' }); return; }
    
    const pos: CryptoPaperPosition = {
      id: 'cp_' + Date.now(),
      symbol,
      side,
      entryPrice: ticker.price,
      amountUsd,
      quantity: amountUsd / ticker.price,
      openedAt: Date.now(),
    };
    cryptoPositions.unshift(pos);
    if (cryptoPositions.length > 50) cryptoPositions.pop();
    
    pushNotification('trade', `模拟${side === 'BUY' ? '买入' : '卖出'} ${symbol} @ ${ticker.price}`);
    res.json({ success: true, data: pos });
  } catch (e: any) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/api/binance/paper-positions', async (req, res) => {
  try {
    const positionsWithPnl = await Promise.all(
      cryptoPositions.map(async (pos) => {
        const t = await binanceFeed.getPrice(pos.symbol);
        const currentPrice = t?.price || pos.entryPrice;
        const pnl = pos.side === 'BUY' 
          ? (currentPrice - pos.entryPrice) * pos.quantity
          : (pos.entryPrice - currentPrice) * pos.quantity;
        return { ...pos, currentPrice, pnl: Math.round(pnl * 100) / 100 };
      })
    );
    res.json({ success: true, data: positionsWithPnl });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Stock Market (Tencent Finance API) ---

function decodeTencentResponse(buffer: ArrayBuffer, charset = 'gb18030'): string {
  const bytes = Buffer.from(buffer);
  return iconv.decode(bytes, /utf-?8/i.test(charset) ? 'utf8' : 'gb18030');
}

async function fetchTencentText(url: string, timeoutMs = 10000): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error('API failed');
  // qt.gtimg.cn always serves legacy GBK, while smartbox serves UTF-8. Do not
  // rely on content-type sniffing: some local networks/proxies strip or rewrite
  // the header and turn Chinese issuer names into mojibake.
  const charset = url.includes('smartbox.gtimg.cn') ? 'utf-8' : 'gb18030';
  return decodeTencentResponse(
    await response.arrayBuffer(),
    charset
  );
}

function parseTencentStock(raw: string): any {
  // Format: v_sh000001="1~name~code~current~prevClose~open~volume~..."
  const match = raw.match(/v_\w+="([^"]+)"/);
  if (!match) return null;
  const parts = match[1].split("~");
  if (parts.length < 10) return null;
  const isUsQuote = raw.toLowerCase().startsWith('v_us');
  const englishName = String(parts[46] || '').trim();
  return {
    code: parts[2],
    // US cards stay readable even if a legacy cache/proxy mangles Chinese text;
    // Tencent provides the official English issuer name at zero-based field 46.
    name: isUsQuote && /^[A-Za-z][A-Za-z .,&'-]{2,}$/.test(englishName) ? englishName : parts[1],
    nameCN: parts[1],
    price: parseFloat(parts[3]) || 0,
    prevClose: parseFloat(parts[4]) || 0,
    open: parseFloat(parts[5]) || 0,
    volume: parseInt(parts[6]) || 0,
    high: parseFloat(parts[33]) || 0,
    low: parseFloat(parts[34]) || 0,
    change: parseFloat(parts[31]) || 0,
    changePct: parseFloat(parts[32]) || 0,
    market: raw.startsWith("v_us") ? "us" : raw.startsWith("v_hk") ? "hk" : "cn",
  };
}

function parseTencentSearch(raw: string): any[] {
  const match = raw.match(/v_hint="([^"]*)"/);
  if (!match || match[1] === 'N') return [];

  const decoded = match[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );

  return decoded.split('^').map((item) => {
    const [market, symbol, name, rawAlias, securityType] = item.split('~');
    const normalizedMarket = String(market || '').toLowerCase();
    const normalizedSymbol = String(symbol || '');
    let code = '';
    let exchangeSymbol = '';
    let marketLabel = normalizedMarket.toUpperCase();
    let alias = rawAlias || '';

    if (normalizedMarket === 'us') {
      code = 'us' + normalizedSymbol.toUpperCase().replace(/\.[A-Z]+$/, '');
      exchangeSymbol = normalizedSymbol.toUpperCase();
      marketLabel = '美股';
      // "pg" is a pinyin shortcut, not useful in the UI. The exchange ticker is clearer.
      if (/^[a-z]{1,6}$/i.test(alias)) alias = exchangeSymbol;
    } else if (normalizedMarket === 'hk') {
      code = 'hk' + normalizedSymbol;
      marketLabel = '港股';
    } else if (['sh', 'sz', 'bj'].includes(normalizedMarket)) {
      code = normalizedMarket + normalizedSymbol;
      marketLabel = normalizedMarket === 'sh' ? 'A股' : normalizedMarket === 'sz' ? 'A股' : '北交所';
    }

    if (!code || !name) return null;
    return {
      code,
      name,
      alias: alias || '',
      market: marketLabel,
      exchangeSymbol,
      type: securityType || '',
    };
  }).filter(Boolean);
}

interface SecTickerRecord {
  ticker: string;
  title: string;
}

interface UsDirectoryRecord {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
}

let secTickerCache: { ts: number; value: SecTickerRecord[] } | null = null;

let usDirectoryCache: { ts: number; value: Promise<UsDirectoryRecord[]> } | null = null;
const US_DIRECTORY_CACHE_FILE = path.join(process.cwd(), 'data', 'us-directory-cache.json');
const execFileAsync = promisify(execFile);
const US_INDEX_NAMES: Record<string, { name: string; nameCN: string }> = {
  'DJI': { name: 'Dow Jones Industrial Average', nameCN: '道琼斯工业平均指数' },
  'IXIC': { name: 'Nasdaq Composite', nameCN: '纳斯达克综合指数' },
  'INX': { name: 'S&P 500', nameCN: '标普500指数' },
};

function hasBrokenUsName(value: any): boolean {
  const text = String(value || '');
  return !text.trim()
    || text.includes('\uFFFD')
    // Tencent's US names should be readable English. CJK/replacement chars in
    // this field indicate a legacy decode problem and are replaced below.
    || /[\u4e00-\u9fff\u3040-\u30ff]/.test(text);
}

async function getUsStockDirectory(): Promise<UsDirectoryRecord[]> {
  if (usDirectoryCache && Date.now() - usDirectoryCache.ts < 6 * 60 * 60_000) {
    return usDirectoryCache.value;
  }

  const request = (async (): Promise<UsDirectoryRecord[]> => {
    // The public screener is reliable but can take several seconds on its
    // first download. Keep a local copy so app restarts stay instant.
    try {
      const cachedRaw = await fs.promises.readFile(US_DIRECTORY_CACHE_FILE, 'utf8');
      const cachedPayload = JSON.parse(cachedRaw) as { savedAt?: number; rows?: UsDirectoryRecord[] };
      if (cachedPayload?.savedAt && Date.now() - cachedPayload.savedAt < 7 * 86_400_000
        && Array.isArray(cachedPayload.rows) && cachedPayload.rows.length >= 100) {
        return cachedPayload.rows;
      }
    } catch {
      // A missing or damaged cache is normal on the first run.
    }
    // Nasdaq challenges Node fetch on some networks, while system curl passes.
    // The download is about 2MB, so maxBuffer must leave enough headroom.
    const { stdout } = await execFileAsync(
      'curl.exe',
      [
        '--fail', '--silent', '--show-error', '--max-time', '20',
        '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MoneyMoney/1.0',
        '-H', 'Accept: application/json, text/plain, */*',
        '-H', 'Accept-Language: en-US,en;q=0.9',
        'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=100&download=true',
      ],
      { timeout: 25_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
    );
    const payload = JSON.parse(stdout) as any;
    const rows = payload?.data?.rows;
    if (!Array.isArray(rows) || rows.length < 100) throw new Error('US directory empty');

    const seen = new Set<string>();
    const directory = rows.map((row: any): UsDirectoryRecord | null => {
      const ticker = String(row.symbol || '').trim().toUpperCase();
      const name = String(row.name || '').replace(/\s+/g, ' ').trim();
      if (!ticker || !name || seen.has(ticker)) return null;
      seen.add(ticker);
      return {
        ticker,
        name,
        sector: String(row.sector || '').trim(),
        industry: String(row.industry || '').trim(),
      };
    }).filter(Boolean) as UsDirectoryRecord[];
    if (directory.length < 100) throw new Error('US directory invalid');
    void fs.promises.writeFile(US_DIRECTORY_CACHE_FILE, JSON.stringify({
      savedAt: Date.now(),
      rows: directory,
    })).catch(() => {});
    return directory;
  })();

  usDirectoryCache = { ts: Date.now(), value: request };
  try {
    return await request;
  } catch (error) {
    // Do not keep a failed promise cached for six hours.
    if (usDirectoryCache?.value === request) usDirectoryCache = null;
    throw error;
  }
}

async function searchNasdaqUsEquities(query: string): Promise<any[]> {
  const normalizedQuery = query.toUpperCase().replace(/[^A-Z0-9.&-]/g, '');
  if (!normalizedQuery) return [];
  const rows = await getUsStockDirectory();
  const words = query.toUpperCase().split(/\s+/).filter(Boolean);
  const scored = rows.map(row => {
    const ticker = row.ticker.toUpperCase();
    const name = row.name.toUpperCase();
    let score = 0;
    if (ticker === normalizedQuery) score = 130;
    else if (ticker.startsWith(normalizedQuery)) score = 110 - Math.min(30, ticker.length - normalizedQuery.length);

    if (words.length && words.every(word => name.includes(word))) {
      score = Math.max(score, words[0] === normalizedQuery ? 105 : 92 - Math.min(35, Math.max(0, name.indexOf(words[0]))));
    }
    if (!score) return null;
    return { row, score };
  }).filter(Boolean) as Array<{ row: UsDirectoryRecord; score: number }>;

  return scored.sort((a, b) => b.score - a.score || a.row.ticker.localeCompare(b.row.ticker))
    .slice(0, 10)
    .map(({ row }) => ({
      code: 'us' + row.ticker,
      name: row.name,
      alias: row.ticker,
      market: '美股',
      exchangeSymbol: row.ticker,
      type: 'GP',
    }));
}

async function sanitizeUsQuoteNames(stocks: any[]): Promise<any[]> {
  const usQuotes = stocks.filter(item => item?.market === 'us' && item?.code);
  if (!usQuotes.length) return stocks;
  // Resolve known indices first: Tencent intentionally provides readable
  // Chinese labels for them, and this avoids downloading the equity directory.
  const withIndices = stocks.map(item => {
    if (item?.market !== 'us') return item;
    const indexName = US_INDEX_NAMES[String(item.code || '')
      .replace(/^us/i, '')
      .replace(/[^A-Z0-9]/gi, '')];
    return indexName ? { ...item, name: indexName.nameCN, nameEN: indexName.name } : item;
  });

  // Tencent already supplies an official English issuer name for equities.
  // Download the larger directory only when one of those names is unreadable.
  const needsDirectory = withIndices.some(item => item?.market === 'us'
    && !US_INDEX_NAMES[String(item.code || '').replace(/^us/i, '').replace(/[^A-Z0-9]/gi, '')]
    && hasBrokenUsName(item.name));
  if (!needsDirectory) return withIndices;
  try {
    const directory = await getUsStockDirectory();
    const byTicker = new Map(directory.map(row => [row.ticker, row]));
    return withIndices.map(item => {
      if (item?.market !== 'us') {
        return item;
      }
      const ticker = String(item.code || '').replace(/^us/i, '').replace(/\.[A-Z]+$/i, '').toUpperCase();
      const match = byTicker.get(ticker);
      if (!match) {
        if (hasBrokenUsName(item.name)) return { ...item, name: ticker };
        return item;
      }
      const validChinese = item.nameCN && /[\u4e00-\u9fff]/.test(String(item.nameCN))
        ? item.nameCN
        : match.name;
      return { ...item, name: match.name, nameCN: validChinese };
    });
  } catch {
    return withIndices.map(item => item?.market === 'us' && hasBrokenUsName(item.name)
      ? { ...item, name: String(item.code || '').replace(/^us/i, '') }
      : item);
  }
}

async function getSecTickerDirectory(): Promise<SecTickerRecord[]> {
  // SEC's ticker file is large but stable. It gives MoneyMoney a keyless
  // fallback when Tencent's suggestion box rate-limits regional requests.
  if (secTickerCache && Date.now() - secTickerCache.ts < 6 * 60 * 60_000) {
    return secTickerCache.value;
  }
  const response = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MoneyMoney Research support@example.com',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
  const payload = await response.json() as Record<string, { ticker?: string; title?: string }>;
  const rows = Object.values(payload)
    .map(item => ({
      ticker: String(item.ticker || '').toUpperCase(),
      title: String(item.title || '').replace(/\s*\/[A-Z0-9]+\s*$/, '').trim(),
    }))
    .filter(item => /^[A-Z0-9.-]{1,8}$/.test(item.ticker) && item.title);
  if (!rows.length) throw new Error('SEC directory empty');
  secTickerCache = { ts: Date.now(), value: rows };
  return rows;
}

async function enrichUsSearchNames(results: any[]): Promise<any[]> {
  const usResults = results.filter(item => item?.market === '美股' && item?.code);
  if (!usResults.length) return results;
  try {
    const text = await fetchTencentText(`https://qt.gtimg.cn/q=${usResults.map(item => item.code).join(',')}`);
    const quotes = text.split(';')
      .map(item => parseTencentStock(item.trim()))
      .filter(Boolean) as any[];
    const byCode = new Map(quotes.map(quote => [String(quote.code || '').toUpperCase(), quote]));
    return results.map(item => {
      if (item?.market !== '美股') return item;
      const quote = byCode.get(String(item.exchangeSymbol || item.code.replace(/^us/i, '')).toUpperCase());
      if (quote?.name && /^[A-Za-z][A-Za-z .,&'-]{2,}$/.test(quote.name)) {
        return { ...item, name: quote.name, nameCN: quote.nameCN || item.name };
      }
      return item;
    });
  } catch {
    return results;
  }
}

async function searchSecUsEquities(query: string): Promise<any[]> {
  const normalizedQuery = query.toUpperCase().replace(/[^A-Z0-9.&-]/g, '');
  if (normalizedQuery.length < 1) return [];
  const rows = await getSecTickerDirectory();
  const scored = rows.map(row => {
    const ticker = row.ticker.toUpperCase();
    const title = row.title.toUpperCase().replace(/[^A-Z0-9.& ]/g, ' ');
    let score = 0;
    if (ticker === normalizedQuery) score = 120;
    else if (ticker.startsWith(normalizedQuery)) score = 100 - Math.min(30, ticker.length - normalizedQuery.length);
    if (title.includes(` ${normalizedQuery} `)) score = Math.max(score, 95);
    else if (title.startsWith(`${normalizedQuery} `) || title.endsWith(` ${normalizedQuery}`)) score = Math.max(score, 90);
    else if (title.includes(normalizedQuery)) score = Math.max(score, 65 - Math.min(35, Math.max(0, title.indexOf(normalizedQuery))));
    return { row, score };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.row.ticker.localeCompare(b.row.ticker))
    .slice(0, 10);
  return scored.map(({ row }) => ({
    code: 'us' + row.ticker,
    name: row.title,
    alias: row.ticker,
    market: '美股',
    exchangeSymbol: row.ticker,
    type: 'GP',
  }));
}

app.get('/api/stock/quotes', async (req, res) => {
  try {
    // Accept both internal IDs (usAAPL) and plain tickers (AAPL), so a stale
    // page or manual API call does not silently turn into an empty response.
    const symbols = String(req.query.symbols || 'sh000001,sz399001,hkHSI,usAAPL,usMSFT,usNVDA')
      .split(',')
      .map(s => s.trim())
      .map(s => !/^us/i.test(s) && /^[a-z]{1,6}$/i.test(s) ? 'us' + s.toUpperCase() : s)
      .filter(Boolean)
      .join(',');
    const cacheKey = 'stockQuotes:' + symbols.toLowerCase();
    const cached = getCached(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const url = `https://qt.gtimg.cn/q=${symbols}`;
    const text = await fetchTencentText(url);
    const stocks = await sanitizeUsQuoteNames(text.split(';')
      .map(s => parseTencentStock(s.trim()))
      .filter(Boolean));
    
    if (stocks.length) setCached(cacheKey, stocks);
    res.json({ success: true, data: stocks });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/stock/indices', async (req, res) => {
  try {
    const cached = getCached('stockIndices');
    if (cached) return res.json({ success: true, data: cached });
    
    // Major indices
    const indices = 'sh000001,sz399001,hkHSI,usDJI,usIXIC,usINX';
    const url = `https://qt.gtimg.cn/q=${indices}`;
    const text = await fetchTencentText(url);
    const stocks = await sanitizeUsQuoteNames(text.split(';')
      .map(s => parseTencentStock(s.trim()))
      .filter(Boolean));
    
    if (stocks.length) setCached('stockIndices', stocks);
    res.json({ success: true, data: stocks });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/stock/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) { res.json({ success: true, data: [] }); return; }

    const cacheKey = 'stockSearch:' + q.toLowerCase();
    const cached = getCached(cacheKey);
    if (cached) { res.json({ success: true, data: cached }); return; }

    try {
      // Smartbox occasionally rate-limits a burst of requests. Two light
      // attempts keep ordinary typing reliable without slowing failures much.
      let liveResults: any[] = [];
      for (let attempt = 0; attempt < 2 && !liveResults.length; attempt++) {
        if (attempt) await new Promise(resolve => setTimeout(resolve, 300));
        const text = await fetchTencentText(
          `https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(q)}&t=all`,
          8000
        );
        liveResults = parseTencentSearch(text).slice(0, 10);
      }
      if (liveResults.length) {
        const enrichedResults = await enrichUsSearchNames(liveResults);
        // Smartbox is good for Chinese and pinyin searches, but regional
        // networks can return an empty or region-biased result for US tickers.
        // SEC is authoritative for US issuers, so merge it into normal searches.
        let secMatches: any[] = [];
        try {
          secMatches = await searchSecUsEquities(q);
        } catch {
          secMatches = [];
        }
        let nasdaqMatches: any[] = [];
        if (!enrichedResults.some(item => item?.market === '美股')) {
          try {
            nasdaqMatches = await searchNasdaqUsEquities(q);
          } catch {
            nasdaqMatches = [];
          }
        }
        const combined = [...enrichedResults, ...nasdaqMatches, ...secMatches]
          .filter((item, index, array) => array.findIndex(other => other.code === item.code) === index);
        const normalizedQuery = q.toUpperCase();
        combined.sort((a, b) => {
          const aExact = String(a.code || '').toUpperCase() === 'us' + normalizedQuery ? 0 : 1;
          const bExact = String(b.code || '').toUpperCase() === 'us' + normalizedQuery ? 0 : 1;
          return aExact - bExact;
        });
        const rankedResults = combined.slice(0, 10);
        setCached(cacheKey, rankedResults);
        res.json({ success: true, data: rankedResults });
        return;
      }
    } catch {
      // Fall back to the offline list so search still works during short network issues.
    }

    // If the suggestion endpoint is unavailable but the ticker is valid, the
    // quote endpoint can still identify it (for example during smartbox outages).
    if (/^[a-z]{1,6}$/i.test(q)) {
      try {
        const quoteText = await fetchTencentText(`https://qt.gtimg.cn/q=us${q.toUpperCase()}`, 6000);
        const quote = parseTencentStock(quoteText);
        const englishName = quoteText.match(/~([A-Za-z][A-Za-z .,&'-]{2,})~/)?.[1] || '';
        if (quote?.price > 0) {
          const directResult = [{
            code: 'us' + q.toUpperCase(),
            name: quote.name || englishName || q.toUpperCase(),
            alias: englishName,
            market: '美股',
            exchangeSymbol: quote.code,
            type: 'GP',
          }];
          setCached(cacheKey, directResult);
          res.json({ success: true, data: directResult });
          return;
        }
      } catch {
        // Continue to the offline list.
      }
    }

    // If both Tencent endpoints are blocked, Nasdaq's public screener still
    // provides a keyless US equity directory and keeps search usable.
    try {
      const nasdaqResults = await searchNasdaqUsEquities(q);
      if (nasdaqResults.length) {
        setCached(cacheKey, nasdaqResults);
        res.json({ success: true, data: nasdaqResults });
        return;
      }
    } catch {
      // Continue to the offline list.
    }

    // Popular stocks fallback
    const db = [
      { code: 'usAAPL', exchangeSymbol: 'AAPL.OQ', name: 'Apple', nameCN: '苹果', market: '美股' },
      { code: 'usMSFT', exchangeSymbol: 'MSFT.OQ', name: 'Microsoft', nameCN: '微软', market: '美股' },
      { code: 'usNVDA', exchangeSymbol: 'NVDA.OQ', name: 'NVIDIA', nameCN: '英伟达', market: '美股' },
      { code: 'usTSLA', exchangeSymbol: 'TSLA.OQ', name: 'Tesla', nameCN: '特斯拉', market: '美股' },
      { code: 'usGOOG', exchangeSymbol: 'GOOG.OQ', name: 'Google', nameCN: '谷歌', market: '美股' },
      { code: 'usAMZN', exchangeSymbol: 'AMZN.OQ', name: 'Amazon', nameCN: '亚马逊', market: '美股' },
      { code: 'usMETA', exchangeSymbol: 'META.OQ', name: 'Meta', nameCN: 'Meta', market: '美股' },
      { code: 'usBAC', exchangeSymbol: 'BAC.N', name: 'Bank of America', nameCN: '美国银行', market: '美股' },
      { code: 'usJPM', exchangeSymbol: 'JPM.N', name: 'JPMorgan Chase', nameCN: '摩根大通', market: '美股' },
      { code: 'usCOF', exchangeSymbol: 'COF.N', name: 'Capital One', nameCN: '第一资本', market: '美股' },
      { code: 'usSPY', exchangeSymbol: 'SPY', name: 'SPDR S&P 500 ETF', nameCN: '标普500 ETF', market: '美股' },
      { code: 'usQQQ', exchangeSymbol: 'QQQ', name: 'Invesco QQQ Trust', nameCN: '纳指100 ETF', market: '美股' },
      { code: 'usGLD', exchangeSymbol: 'GLD', name: 'SPDR Gold Shares', nameCN: '黄金 ETF', market: '美股' },
      { code: 'usTLT', exchangeSymbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', nameCN: '20+年美债 ETF', market: '美股' },
      { code: 'usHYG', exchangeSymbol: 'HYG', name: 'iShares iBoxx High Yield Corporate Bond ETF', nameCN: '高收益信用 ETF', market: '美股' },
      { code: 'sh600519', name: '600519', nameCN: '贵州茅台', market: 'A股' },
      { code: 'sz000001', name: '000001', nameCN: '平安银行', market: 'A股' },
      { code: 'sh601398', name: '601398', nameCN: '工商银行', market: 'A股' },
      { code: 'hk00700', name: '00700', nameCN: '腾讯控股', market: '港股' },
      { code: 'hkHSI', name: 'HSI', nameCN: '恒生指数', market: '港股' },
    ];
    
    const query = q.toUpperCase();
    const results = db.filter(s =>
      s.code.toUpperCase().includes(query) ||
      s.name.toUpperCase().includes(query) ||
      s.nameCN.includes(q)
    ).slice(0, 10);

    // The offline list above covers common tickers. SEC fills the long tail so
    // searches such as "Palantir", "Shopify", or an uncommon ticker still work.
    const [secResults, nasdaqFallback] = await Promise.allSettled([
      searchSecUsEquities(q),
      searchNasdaqUsEquities(q),
    ]);
    const extraResults = [
      ...(secResults.status === 'fulfilled' ? secResults.value : []),
      ...(nasdaqFallback.status === 'fulfilled' ? nasdaqFallback.value : []),
    ];
    if (extraResults.length) {
      const merged = [...results, ...extraResults]
        .filter((item, index, array) => array.findIndex(other => other.code === item.code) === index)
        .slice(0, 10);
      setCached(cacheKey, merged);
      res.json({ success: true, data: merged });
      return;
    }
    
    res.json({ success: true, data: results });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: [] });
  }
});

app.get('/api/stock/insider/:symbol', async (req, res) => {
  try {
    res.json({ success: true, data: await getInsiderRadar(String(req.params.symbol || '')) });
  } catch (e: any) {
    res.status(404).json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/stock/analyst/:symbol', async (req, res) => {
  try {
    res.json({ success: true, data: await getAnalystConsensusSnapshot(String(req.params.symbol || '')) });
  } catch (e: any) {
    res.status(404).json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/stock/fundamentals/:symbol', async (req, res) => {
  try {
    res.json({ success: true, data: await getFundamentalQuality(String(req.params.symbol || '')) });
  } catch (e: any) {
    res.status(404).json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/stock/short-interest/:symbol', async (req, res) => {
  try {
    res.json({ success: true, data: await getShortInterestSnapshot(String(req.params.symbol || '')) });
  } catch (e: any) {
    res.status(404).json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/stock/institutional/:symbol', async (req, res) => {
  try {
    res.json({ success: true, data: await getInstitutionalOwnershipSnapshot(String(req.params.symbol || '')) });
  } catch (e: any) {
    res.status(404).json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/stock/market-breadth', async (_req, res) => {
  try {
    res.json({ success: true, data: await getMarketBreadthSnapshot() });
  } catch (e: any) {
    res.status(503).json({ success: false, error: e.message, data: null });
  }
});

// --- Stock K-line ---

app.get('/api/stock/kline', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'sh600519');
    const rawApiSymbol = String(req.query.api || '').trim().toUpperCase();
    const days = parseInt(String(req.query.days || '30'));
    
    // Search supplies the actual Tencent exchange suffix; older clients fall
    // back to Nasdaq, which still covers the popular default list.
    const normalizedApiSymbol = rawApiSymbol && !rawApiSymbol.startsWith('US')
      ? 'us' + rawApiSymbol
      : rawApiSymbol;
    const apiSymbol = normalizedApiSymbol ||
      (symbol.startsWith('us') && !symbol.includes('.') ? symbol + '.OQ' : symbol);
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${apiSymbol},day,,,${days},qfq`;
    
    const cached = getCached('kline:' + symbol);
    if (cached) return res.json({ success: true, data: cached });
    
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('API failed');
    
    const json: any = await response.json();
    const dataKey = Object.keys(json.data || {})[0];
    if (!dataKey) throw new Error('No data');
    
    const raw = json.data[dataKey].qfqday || json.data[dataKey].day;
    if (!raw?.length) throw new Error('Empty');
    
    const klines = raw.map((k: string[]) => ({
      time: new Date(k[0]).getTime(),
      open: parseFloat(k[1]),
      close: parseFloat(k[2]),
      high: parseFloat(k[3]),
      low: parseFloat(k[4]),
      volume: parseFloat(k[5]) || 0,
    }));
    
    setCached('kline:' + symbol, klines);
    res.json({ success: true, data: klines });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- DeFi Data (DeFiLlama, free) ---

app.get('/api/defi/tvl', async (req, res) => {
  try {
    const cached = getCached('defiTvl');
    if (cached) return res.json({ success: true, data: cached });
    
    const response = await fetch('https://api.llama.fi/v2/historicalChainTvl', {
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('API failed');
    
    const data: any[] = await response.json() as any[];
    // Get last 30 days
    const recent = data.slice(-30).map((d: any) => ({
      date: d.date,
      tvl: Math.round(d.tvl),
    }));
    
    setCached('defiTvl', recent);
    res.json({ success: true, data: recent });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/defi/protocols', async (req, res) => {
  try {
    const cached = getCached('defiProtocols');
    if (cached) return res.json({ success: true, data: cached });
    
    const response = await fetch('https://api.llama.fi/protocols', {
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error('API failed');
    
    const all: any[] = await response.json() as any[];
    const top = all
      .filter((p: any) => p.tvl > 0)
      .sort((a: any, b: any) => b.tvl - a.tvl)
      .slice(0, 15)
      .map((p: any) => ({
        name: p.name,
        tvl: Math.round(p.tvl),
        chain: p.chain || 'Multi-chain',
        category: p.category || 'Other',
      }));
    
    setCached('defiProtocols', top);
    res.json({ success: true, data: top });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Macro Indicators ---

app.get('/api/options/:asset', async (req, res) => {
  try {
    const data = await getOptionsSnapshot(String(req.params.asset || 'BTC'));
    res.json({ success: true, data });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/equity-options/:symbol', async (req, res) => {
  try {
    const data = await getEquityOptionsSnapshot(String(req.params.symbol || 'AAPL'));
    res.json({ success: true, data });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Cross-platform Prediction Radar ---

app.get('/api/prediction-radar', async (req, res) => {
  try {
    const query = String(req.query.query || '');
    const limit = Math.min(500, Math.max(10, parseInt(String(req.query.limit || '60'), 10) || 60));
    const cachedOnly = String(req.query.cachedOnly || '') === '1';
    const radar = cachedOnly
      ? (getCachedPredictionRadarSlice(query, Math.min(24, limit)) || {
          updatedAt: '', markets: [],
          opportunities: [],
          sources: { polymarket: { ok: true, count: 0 }, kalshi: { ok: true, count: 0 }, manifold: { ok: true, count: 0 }, gjopen: { ok: true, count: 0 }, metaculus: { ok: true, count: 0 }, weather: { ok: true, count: 0 } },
        })
      : await getPredictionRadar(query, limit);
    res.json({ success: true, data: radar });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/prediction-history', (req, res) => {
  const platform = String(req.query.platform || '');
  const id = String(req.query.id || '');
  const data = getPredictionHistory(platform, id);
  if (!data) return res.json({ success: false, error: '还没有这个市场的走势快照；刷新雷达后会自动开始记录。' });
  res.json({ success: true, data });
});

app.get('/api/forecast-lab', (_req, res) => {
  try {
    res.json({ success: true, data: getForecastLabReport() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/forecast-lab/resolve', async (req, res) => {
  try {
    const key = String(req.body?.key || '');
    const outcome = String(req.body?.outcome || '');
    const data = await resolveForecastCase(key, outcome);
    if (!data) return res.json({ success: false, error: '没有找到这条待复盘预测，或结果标记无效。' });
    res.json({ success: true, data });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/prediction-position-size', (req, res) => {
  try {
    const data = calculatePredictionPosition(req.body || {});
    res.json({ success: true, data });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/source-health', async (_req, res) => {
  try {
    res.json({ success: true, data: await getSourceHealth() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/funding-carry', async (_req, res) => {
  try {
    res.json({ success: true, data: await getFundingCarryRadar() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/calendar', async (req, res) => {
  try {
    const result = await getMacroCalendar();
    const impact = String(req.query.impact || 'all').toLowerCase();
    const upcoming = String(req.query.upcoming || 'false') === 'true';
    let events = result.events;
    if (impact !== 'all') events = events.filter(event => event.impact.toLowerCase() === impact);
    if (upcoming) {
      const now = Date.now();
      events = events.filter(event => new Date(event.date).getTime() >= now - 60 * 60 * 1000);
    }
    res.json({ success: true, data: { ...result, count: events.length, events } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/events/calendar', async (req, res) => {
  try {
    const result = await getUpcomingEventCalendar(Number(req.query.days) || 7, req.query.refresh === '1');
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message || '未来事件日历暂时不可用' });
  }
});

app.get('/api/crypto/global', async (_req, res) => {
  try {
    res.json({ success: true, data: await getGlobalCryptoMetrics() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/sentiment/fear-greed', async (_req, res) => {
  try {
    res.json({ success: true, data: await getFearGreed() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/funding-rates', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    res.json({ success: true, data: await getFundingRates(limit) });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/perpetual-crowding', async (_req, res) => {
  try {
    res.json({ success: true, data: await getPerpetualCrowding() });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/order-flow-liquidity', async (_req, res) => {
  try {
    res.json({ success: true, data: await getOrderFlowLiquidityRadar() });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/bitcoin-onchain', async (_req, res) => {
  try {
    res.json({ success: true, data: await getBitcoinOnchainRadar() });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/cross-asset-correlation', async (_req, res) => {
  try {
    res.json({ success: true, data: await getCrossAssetCorrelationRadar() });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/crypto/cot', async (_req, res) => {
  try {
    res.json({ success: true, data: await getCotRadar() });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/economic-indicators', async (_req, res) => {
  try {
    res.json({ success: true, data: await getEconomicIndicators() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/treasury-yields', async (_req, res) => {
  try {
    res.json({ success: true, data: await getTreasuryYields() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/cross-asset-risk', async (_req, res) => {
  try {
    res.json({ success: true, data: await getCrossAssetRisk() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/regime', async (req, res) => {
  try {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : 'BTCUSDT';
    const interval = typeof req.query.interval === 'string' ? req.query.interval : '4h';
    res.json({ success: true, data: await getMarketRegime(symbol, interval) });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/support-resistance', async (req, res) => {
  try {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : 'BTCUSDT';
    const interval = typeof req.query.interval === 'string' ? req.query.interval : '4h';
    res.json({ success: true, data: await getSupportResistance(symbol, interval) });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/confluence', async (req, res) => {
  try {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : 'BTCUSDT';
    res.json({ success: true, data: await getMultiTimeframeConfluence(symbol) });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/event-risk', async (_req, res) => {
  try {
    res.json({ success: true, data: await getEventRisk() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/stock/earnings', async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    res.json({ success: true, data: await getEarningsCalendar(date) });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/fx', async (req, res) => {
  try {
    const cached = getCached('fxRates');
    if (cached) return res.json({ success: true, data: cached });
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('API failed');
    const d: any = await response.json();
    const result = { CNY: d.rates?.CNY || 0, EUR: d.rates?.EUR || 0, JPY: d.rates?.JPY || 0 };
    setCached('fxRates', result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/gold', async (req, res) => {
  try {
    const cached = getCached('goldPrice');
    if (cached) return res.json({ success: true, data: cached });
    const response = await fetch(
      'https://hq.sinajs.cn/list=hf_GC',
      { headers: { Referer: 'https://finance.sina.com.cn' }, signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) throw new Error('API failed');
    const text = await response.text();
    // hf_GC format: price,,bid,,high,low...
    const match = text.match(/"([^"]+)"/);
    if (!match) throw new Error('Parse error');
    const parts = match[1].split(',');
    const result = { price: parseFloat(parts[0]) || 0, prevClose: parseFloat(parts[7] || parts[2]) || 0 };
    setCached('goldPrice', result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/global-spot', async (_req, res) => {
  try {
    res.json({ success: true, data: await getGlobalMacroSpotSnapshot() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/stablecoins', async (req, res) => {
  try {
    const result = await getStablecoinLiquidity();
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});


app.get('/api/crypto-news', async (req, res) => {
  try {
    const cached = getCached('cryptoNews');
    if (cached) return res.json({ success: true, data: cached });

    const loadFeed = async (url: string): Promise<string> => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!response.ok) throw new Error(`RSS failed (${response.status})`);
      return response.text();
    };

    let xml: string;
    try {
      // PANews provides a free, keyless Simplified Chinese feed.
      xml = await loadFeed('https://www.panewslab.com/rss.xml?lang=zh&type=NEWS');
    } catch {
      xml = await loadFeed('https://cointelegraph.com/rss');
    }

    const items = parseRssItems(xml, 10);
    if (!items.length) throw new Error('Empty RSS');

    setCached('cryptoNews', items);
    res.json({ success: true, data: items });
  } catch (e: any) {
    try {
      const response = await fetch('https://cointelegraph.com/rss', {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const items = response.ok ? parseRssItems(await response.text(), 10) : [];
      if (items.length) {
        setCached('cryptoNews', items);
        return res.json({ success: true, data: items });
      }
    } catch {}
    res.json({ success: false, error: e.message });
  }
});

// --- On-chain & Commodities ---

app.get('/api/macro/btc-chain', async (req, res) => {
  try {
    const cached = getCached('btcChain');
    if (cached) return res.json({ success: true, data: cached });
    
    const [heightRes, diffRes] = await Promise.all([
      fetch('https://mempool.space/api/blocks/tip/height', { signal: AbortSignal.timeout(8000) }),
      fetch('https://mempool.space/api/v1/difficulty-adjustment', { signal: AbortSignal.timeout(8000) })
    ]);
    
    const height = heightRes.ok ? parseInt(await heightRes.text()) : 0;
    const diffData = diffRes.ok ? await diffRes.json() as any : null;
    
    const result = {
      blockHeight: height,
      difficultyChangePct: diffData ? Math.round((diffData.difficultyChange || 0) * 100) / 100 : 0,
      retargetDate: diffData?.estimatedRetargetDate || '',
    };
    setCached('btcChain', result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/commodities', async (req, res) => {
  try {
    const cached = getCached('commodities');
    if (cached) return res.json({ success: true, data: cached });
    
    const response = await fetch(
      'https://hq.sinajs.cn/list=hf_CL,hf_SI,hf_GC,hf_NG',
      { headers: { Referer: 'https://finance.sina.com.cn' }, signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) throw new Error('API failed');
    
    const text = await response.text();
    const parsePrice = (name: string): number => {
      const re = new RegExp(name + '="([0-9.]+)');
      const m = text.match(re);
      return m ? parseFloat(m[1]) : 0;
    };
    
    const result = {
      crudeOil: parsePrice('hf_CL'),
      naturalGas: parsePrice('hf_NG'),
      silver: parsePrice('hf_SI'),
      gold: parsePrice('hf_GC'),
    };
    setCached('commodities', result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/eth-gas', async (_req, res) => {
  try {
    const cached = getCached('ethGas');
    if (cached) return res.json({ success: true, data: cached });
    const response = await fetch('https://ethgasprice.org/api/gas', {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('API failed');
    const json: any = await response.json();
    const d = json?.data;
    if (!d) throw new Error('Empty');
    const result = {
      rapidGwei: Number(d.rapid) || 0,
      standardGwei: Number(d.standard) || 0,
      slowGwei: Number(d.slow) || 0,
      ethPriceUsd: Number(d.priceUSD) || 0,
    };
    setCached('ethGas', result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Chain TVL & Volume Rankings ---

app.get('/api/defi/chains', async (req, res) => {
  try {
    const cached = getCached('defiChains');
    if (cached) return res.json({ success: true, data: cached });
    const response = await fetch('https://api.llama.fi/v2/chains', { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('API failed');
    const all: any[] = await response.json() as any[];
    const top = all
      .filter((c: any) => c.tvl > 0)
      .sort((a: any, b: any) => b.tvl - a.tvl)
      .slice(0, 10)
      .map((c: any) => ({ name: c.name, tvl: Math.round(c.tvl) }));
    setCached('defiChains', top);
    res.json({ success: true, data: top });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/binance/volume-ranking', async (req, res) => {
  try {
    // Check long-term cache first
    const entry = responseCache.get('volRankV2');
    if (entry && Date.now() - entry.ts < 300000) {
      return res.json({ success: true, data: entry.data });
    }
    
    // Predefined top 50 USDT pairs - much faster than fetching all 3684
    const topPairs = [
      'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT',
      'DOGEUSDT','ADAUSDT','AVAXUSDT','DOTUSDT','LINKUSDT',
      'MATICUSDT','LTCUSDT','TRXUSDT','ATOMUSDT','NEARUSDT',
      'APTUSDT','ARBUSDT','OPUSDT','INJUSDT','SUIUSDT',
      'PEPEUSDT','SHIBUSDT','FLOKIUSDT','BONKUSDT','WIFUSDT'
    ];
    
    // Fetch in parallel batches of 10
    const results: any[] = [];
    for (let i = 0; i < topPairs.length; i += 10) {
      const batch = topPairs.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map(async (sym) => {
          try {
            const r = await fetch(`${'https://data-api.binance.vision'}/api/v3/ticker/24hr?symbol=${sym}`,
              { signal: AbortSignal.timeout(8000) });
            if (!r.ok) return null;
            const d: any = await r.json();
            return {
              symbol: d.symbol.replace('USDT', ''),
              price: parseFloat(d.lastPrice),
              changePct: parseFloat(d.priceChangePercent),
              volumeUsd: Math.round(parseFloat(d.quoteVolume)),
            };
          } catch { return null; }
        })
      );
      results.push(...batchResults.filter(Boolean));
    }
    
    // Sort by volume descending
    results.sort((a, b) => b.volumeUsd - a.volumeUsd);
    
    responseCache.set('volRankV2', { data: results, ts: Date.now() });
    res.json({ success: true, data: results });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/defi/yields', async (req, res) => {
  try {
    const cached = getCached('defiYields');
    if (cached) return res.json({ success: true, data: cached });
    const response = await fetch('https://yields.llama.fi/pools', {
      signal: AbortSignal.timeout(25000)
    });
    if (!response.ok) throw new Error('API failed');
    const json: any = await response.json();
    const pools = (json.data || [])
      .filter((p: any) => p.tvlUsd > 10000000 && p.apy > 5 && p.apy < 500)
      .sort((a: any, b: any) => b.tvlUsd * b.apy - a.tvlUsd * a.apy)
      .slice(0, 10)
      .map((p: any) => ({
        project: p.project,
        symbol: p.symbol,
        apy: Math.round(p.apy * 10) / 10,
        tvlUsd: Math.round(p.tvlUsd),
        chain: p.chain,
      }));
    setCached('defiYields', pools);
    res.json({ success: true, data: pools });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/defi/yield-quality', async (_req, res) => {
  try {
    res.json({ success: true, data: await getYieldQuality() });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/crypto-news-decrypt', async (req, res) => {
  try {
    const cached = getCached('decryptNews');
    if (cached) return res.json({ success: true, data: cached });
    
    const response = await fetch('https://decrypt.co/feed', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) throw new Error('RSS failed');
    
    const xml = await response.text();
    const items = parseRssItems(xml, 10);
    
    setCached('decryptNews', items);
    res.json({ success: true, data: items });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});


app.get('/api/crypto-news-btc-mag', async (req, res) => {
  try {
    const cached = getCached('btcMagNews');
    if (cached) return res.json({ success: true, data: cached });
    
    const response = await fetch('https://bitcoinmagazine.com/feed', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'application/rss+xml, application/xml, text/xml, */*', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!response.ok) throw new Error('RSS failed');
    
    const xml = await response.text();
    const items = parseRssItems(xml, 8);
    
    setCached('btcMagNews', items);
    res.json({ success: true, data: items });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Get balance
app.get('/api/balance', async (req, res) => {
  try {
    const balance = await tradingEngine.getBalance();
    // Convert BigInt to string for JSON serialization
    res.json({
      success: true,
      data: {
        wei: balance.wei.toString(),
        formatted: balance.formatted,
        usdtWei: balance.usdtWei.toString(),
        usdtFormatted: balance.usdtFormatted
      }
    });
  } catch (error: any) {
    console.error('[Balance] Error:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// Get positions
app.get('/api/positions', async (req, res) => {
  try {
    const response = await api.getPositions();
    res.json({ success: true, data: response.data });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// Get orders
app.get('/api/orders', async (req, res) => {
  try {
    const response = await api.getOrders('OPEN');
    res.json({ success: true, data: response.data });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// Get wallet address
app.get('/api/wallet', async (req, res) => {
  try {
    const address = tradingEngine.getSignerAddress();
    const walletInfo = tradingEngine.getWalletInfo();
    res.json({ success: true, data: { address, ...walletInfo } });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// Set approvals (required before trading)
app.post('/api/approvals', async (req, res) => {
  try {
    await tradingEngine.setApprovals();
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// Get market by ID
app.get('/api/markets/:id', async (req, res) => {
  try {
    const response = await api.getMarketById(parseInt(req.params.id));
    res.json({ success: true, data: response.data });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// Place order
app.post('/api/trade', async (req, res) => {
  try {
    const { marketId, side, outcomeIndex, orderType, price, quantity } = req.body;

    // Get market info
    const marketRes = await api.getMarketById(marketId);
    const market = marketRes.data;

    let hash: string;

    if (orderType === 'LIMIT') {
      hash = await tradingEngine.createLimitOrder({
        market,
        side,
        outcomeIndex,
        pricePerShare: price,
        quantity
      });
    } else {
      hash = await tradingEngine.createMarketOrder({
        market,
        side,
        outcomeIndex,
        quantity
      });
    }

    res.json({ success: true, data: { hash } });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// Cancel order
app.post('/api/orders/cancel', async (req, res) => {
  try {
    const { orderIds } = req.body;
    await tradingEngine.cancelOrders(orderIds);
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// Market analysis endpoint
const dataCollector = new DataCollector(30);
const analysisEngine = new AnalysisEngine(dataCollector);

app.get('/api/analysis', async (req, res) => {
  try {
    const report = await analysisEngine.analyzeAll();
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// Cross-market assistant: transparent reminders, not autonomous live orders.
let lastAdvisorReport: Awaited<ReturnType<typeof generateAssistantReport>> | null = null;
let advisorReportRefreshing = false;

function refreshAdvisorReportInBackground(): void {
  if (advisorReportRefreshing) return;
  advisorReportRefreshing = true;
  void generateAssistantReport()
    .then(report => {
      lastAdvisorReport = report;
    })
    .catch(() => {})
    .finally(() => {
      advisorReportRefreshing = false;
    });
}

app.get('/api/advisor', async (_req, res) => {
  try {
    const report = await generateAssistantReport();
    lastAdvisorReport = report;
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/risk/overview', async (_req, res) => {
  try {
    const radar = getCachedPredictionRadarSlice('', 240);
    const paper = paperEngine.getPortfolio();
    const metrics = paperEngine.getRiskMetrics();
    const report = lastAdvisorReport ?? {
      journal: { openTrades: getAssistantJournalTrades().filter(trade => trade.status === 'OPEN') },
      regime: { labelZh: '本地快照（后台刷新中）' },
      context: {},
    };
    if (!lastAdvisorReport) refreshAdvisorReportInBackground();
    const overview = buildPortfolioRiskOverview(report, paper, metrics, {
      ready: !!radar,
      markets: radar?.markets || [],
    });
    await recordRiskHistory(overview);
    res.json({
      success: true,
      data: overview,
    });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/risk/history', (req, res) => {
  try {
    const limit = Number(req.query.limit || 72);
    res.json({ success: true, data: getRiskHistory(Number.isFinite(limit) ? limit : 72) });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/research/daily-briefing', (_req, res) => {
  try {
    const radar = getCachedPredictionRadarSlice('', 240);
    if (!radar) void warmPredictionRadarCache();
    const paper = paperEngine.getPortfolio();
    const metrics = paperEngine.getRiskMetrics();
    const briefing = buildDailyResearchBriefing({
      markets: radar?.markets || [],
      radarReady: !!radar,
      paper: {
        equity: paper.equity,
        cashBalance: paper.cashBalance,
        openPositionsValue: paper.openPositionsValue,
        totalPnl: paper.totalPnl,
        winRate: paper.winRate,
        openCount: paper.positions.filter(item => item.status === 'OPEN').length,
        closedCount: paper.positions.filter(item => item.status === 'CLOSED').length,
        maxDrawdownPct: paper.maxDrawdownPct,
      },
      metrics: { var95Usd: metrics.var95Usd, profitFactor: metrics.profitFactor },
      forecastLab: getForecastLabReport(),
    });
    res.json({ success: true, data: briefing });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/calibration', (_req, res) => {
  try {
    res.json({ success: true, data: getAssistantCalibration() });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/export/journal', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="moneymoney-signals.csv"');
  res.send(exportJournalCsv());
});

app.get('/api/export/paper', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="moneymoney-paper-trades.csv"');
  res.send(exportPaperCsv());
});

app.get('/api/export/calibration', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="moneymoney-calibration.csv"');
  res.send(exportCalibrationCsv());
});

app.get('/api/export/forecast-lab', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="moneymoney-forecast-lab.csv"');
  res.send(exportForecastLabCsv());
});

app.get('/api/export/radar', async (_req, res) => {
  try {
    const radar = await getPredictionRadar('', 500);
    const cell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = radar.markets.map(item => [
      item.platform,
      item.titleZh || item.title,
      item.title,
      item.group,
      (item.yesPrice * 100).toFixed(1),
      item.consensusProbability == null ? '' : (item.consensusProbability * 100).toFixed(1),
      Math.round(item.volume24h),
      Math.round(item.liquidity),
      item.endDate || '',
      item.url || '',
      item.signalZh || '',
    ].map(cell).join(','));
    const csv = '\uFEFF' + [
      ['平台', '中文标题', '原文标题', '分类', '概率%', '共识%', '24H成交$', '流动性$', '截止', '链接', '信号'].map(cell).join(','),
      ...rows,
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="prediction-radar.csv"');
    res.send(csv);
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/advisor/risk-patrol', (_req, res) => {
  res.json({ success: true, data: riskPatrol.status() });
});

app.post('/api/advisor/risk-patrol/run', async (_req, res) => {
  try {
    res.json({ success: true, data: await riskPatrol.runOnce({ push: true }) });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// --- Binance Feed ---

app.get('/api/binance/prices', async (req, res) => {
  const symbols = req.query.symbols ? (req.query.symbols as string).split(',') : ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
  const prices = await binanceFeed.getMultiplePrices(symbols);
  res.json({ success: true, data: prices });
});

app.get('/api/binance/price/:symbol', async (req, res) => {
  const ticker = await binanceFeed.getPrice(req.params.symbol.toUpperCase());
  if (!ticker) return res.json({ success: false, error: '获取行情失败' });
  res.json({ success: true, data: ticker });
});

// --- Price Alerts ---

app.get('/api/alerts', (req, res) => {
  res.json({ success: true, data: alertManager.getAlerts() });
});

app.post('/api/alerts/add', async (req, res) => {
  const { symbol, targetPrice, direction } = req.body;
  const alert = alertManager.addAlert(symbol.toUpperCase(), parseFloat(targetPrice), direction.toUpperCase());
  res.json({ success: true, data: alert });
});

app.post('/api/alerts/remove', (req, res) => {
  const removed = alertManager.removeAlert(req.body.id);
  res.json({ success: removed, message: removed ? '预警已删除' : '未找到预警' });
});

// --- Anomaly Detection ---

app.get('/api/anomalies', async (req, res) => {
  try {
    const events = [];
    for (const symbol of ['BTCUSDT', 'ETHUSDT', 'BNBUSDT']) {
      const ticker = await binanceFeed.getPrice(symbol);
      if (!ticker) continue;
      anomalyDetector.recordTick(symbol, ticker.price, ticker.volume24hUsd);
      const anomaly = anomalyDetector.detect(symbol);
      if (anomaly) {
        events.push(anomaly);
        await telegram.send(`⚠️ <b>Anomaly Detected</b>\n\n${anomaly.message}`);
      }
    }
    res.json({ success: true, data: events });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- AI Analysis ---

app.post('/api/ai/market-analysis', async (req, res) => {
  try {
    const { title, prices, sentiment } = req.body;
    const analysis = await llmAnalyzer.summarizeMarket(title, prices, sentiment);
    if (!analysis) return res.json({ success: false, error: 'AI 分析不可用；请在 .env 中添加 GROQ_API_KEY' });
    res.json({ success: true, data: { analysis } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/ai/market-commentary', async (req, res) => {
  try {
    const force = req.body?.force === true;
    const radar = await getPredictionRadar('', 120);
    const result = await getAiMarketCommentary(radar, force);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({
      success: false,
      error: e?.status === 429 ? 'AI 免费额度或上游通道暂时限流，请稍后再试。' : String(e?.message || e),
    });
  }
});

// --- Reddit Sentiment ---

app.get('/api/reddit', async (req, res) => {
  try {
    const posts = await redditSentiment.getPosts();
    res.json({ success: true, data: posts });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Whale Monitor ---

app.get('/api/whales', async (req, res) => {
  try {
    const threshold = parseInt(String(req.query.threshold || '1000000'));
    const txs = await whaleMonitor.getRecentWhaleTransactions(threshold);
    res.json({ success: true, data: txs });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Strategy Comparison ---

app.get('/api/strategies', (req, res) => {
  res.json({ success: true, data: strategyComparison.get() });
});

app.post('/api/strategies/reset', (req, res) => {
  res.json({ success: true, data: strategyComparison.resetAll() });
});

// --- Trade Journal ---

app.get('/api/journal', (req, res) => {
  res.json({ success: true, data: tradeJournal.get(50) });
});

app.post('/api/journal/note', express.json(), (req, res) => {
  const { id, noteZh, tags } = req.body ?? {};
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: '缺少交易 ID' });
  }
  const ok = saveTradeNote(id, typeof noteZh === 'string' ? noteZh : '', Array.isArray(tags) ? tags.map(String) : []);
  if (!ok) return res.status(404).json({ success: false, error: '未找到该笔交易' });
  res.json({ success: true });
});

app.get('/api/journal/trades', (_req, res) => {
  const trades = getAssistantJournalTrades();
  res.json({ success: true, data: trades.map(t => ({
    id: t.id,
    venue: t.venue,
    symbol: t.symbol,
    title: t.title,
    direction: t.direction,
    result: t.result,
    rMultiple: t.rMultiple,
    confidencePct: t.confidencePct,
    openedAt: t.openedAt,
    closedAt: t.closedAt ?? '',
    status: t.status,
    noteZh: t.noteZh ?? '',
    tags: t.tags ?? [],
  })) });
});

// --- Binance Portfolio ---

app.get('/api/binance/portfolio', async (req, res) => {
  if (!binancePortfolio.isConfigured) {
    return res.json({ success: false, error: '请在 .env 中添加 BINANCE_API_KEY 和 BINANCE_API_SECRET（建议使用只读密钥）' });
  }
  const portfolio = await binancePortfolio.getPortfolio();
  if (!portfolio) return res.json({ success: false, error: '获取币安账户失败' });
  res.json({ success: true, data: portfolio });
});

// --- Portfolio Overview Dashboard (combines all data) ---

app.get('/api/overview', async (req, res) => {
  try {
    const [binancePrices, paperPortfolio, settings] = await Promise.all([
      binanceFeed.getMultiplePrices(['BTCUSDT', 'ETHUSDT']),
      Promise.resolve(paperEngine.getPortfolio()),
      Promise.resolve(settingsManager.get()),
    ]);

    const openPositions = paperEngine.getOpenPositions();
    const recentTrades = paperEngine.getRecentTrades(5);

    res.json({
      success: true,
      data: {
        crypto: binancePrices,
        paper: {
          equity: paperPortfolio.equity,
          totalPnl: paperPortfolio.totalPnl,
          winRate: paperPortfolio.winRate,
          openPositions: openPositions.length,
          maxDrawdown: paperPortfolio.maxDrawdownPct,
        },
        recentTrades,
        settings: { autoTradeEnabled: settings.autoTradeEnabled, paperTradingEnabled: settings.paperTradingEnabled },
        timestamp: new Date().toISOString(),
      }
    });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Connection Info (for mobile sync) ---

app.get('/api/connection-info', async (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    let lanIp = '';
    // Find first non-internal IPv4 address (prefer Wi-Fi/Ethernet)
    for (const name of Object.keys(interfaces)) {
      if (/wi-?fi|ethernet|eth|wlan/i.test(name)) {
        const addr = interfaces[name]?.find(a => a.family === 'IPv4' && !a.internal);
        if (addr) { lanIp = addr.address; break; }
      }
    }
    if (!lanIp) {
      outer: for (const name of Object.keys(interfaces)) {
        for (const addr of interfaces[name] || []) {
          if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('127.')) {
            lanIp = addr.address; break outer;
          }
        }
      }
    }

    const url = `http://${lanIp}:3000`;
    const qrDataUrl = await QRCode.toDataURL(url, { width: 300, margin: 1 });

    res.json({ success: true, data: { lanIp, url, qrCode: qrDataUrl } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Serve service worker with correct MIME type
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// Serve manifest
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

// --- Notification Center ---

import { pushNotification as pushNotif, getNotifications, markAllRead } from '../features/notifications';


// --- Response Cache ---
const responseCache = new Map<string, { data: any; ts: number }>();
const externalLoads = new Map<string, Promise<any>>();
const CACHE_TTL = 60_000; // 60 seconds

function getCached(key: string): any | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    responseCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key: string, data: any) {
  responseCache.set(key, { data, ts: Date.now() });
  if (responseCache.size > 500) {
    const oldest = [...responseCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) responseCache.delete(oldest[0]);
  }
}

async function getFreshExternal<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const entry = responseCache.get(key) as { data: T; ts: number } | undefined;
  if (entry && Date.now() - entry.ts <= ttlMs) return entry.data;
  const pending = externalLoads.get(key);
  if (pending) return pending;

  const request = loader().then(data => {
    responseCache.set(key, { data, ts: Date.now() });
    return data;
  }).finally(() => {
    externalLoads.delete(key);
  });
  externalLoads.set(key, request);
  return request;
}


app.get('/api/notifications', (req, res) => {
  res.json({ success: true, data: getNotifications() });
});

app.post('/api/notifications/mark-read', (req, res) => {
  markAllRead();
  res.json({ success: true });
});

// --- Paper Trading APIs ---

app.get('/api/paper/portfolio', (req, res) => {
  res.json({ success: true, data: paperEngine.getPortfolio() });
});

app.get('/api/paper/risk-metrics', (_req, res) => {
  res.json({ success: true, data: paperEngine.getRiskMetrics() });
});

app.post('/api/paper/monte-carlo', express.json(), (req, res) => {
  const simulations = Math.min(10_000, Math.max(100, Number(req.body?.simulations) || 2000));
  const tradesPerSim = Math.min(100, Math.max(5, Number(req.body?.tradesPerSim) || 20));
  const result = paperEngine.runMonteCarlo(simulations, tradesPerSim);
  if ('error' in result) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, data: result });
});

app.post('/api/paper/reset', (req, res) => {
  const balance = req.body?.startingBalance || 1000;
  const portfolio = paperEngine.reset(balance);
  res.json({ success: true, data: paperEngine.getPortfolio() });
});

app.post('/api/paper/open', async (req, res) => {
  try {
    const { marketId, marketTitle, outcomeIndex, outcomeName, price, amountUsd, reason } = req.body;
    const result = paperEngine.openPosition(marketId, marketTitle, outcomeIndex, outcomeName, price, amountUsd, reason || 'Manual');
    if (result.success && settingsManager.get().telegramEnabled) {
      await telegram.notifyTrade('BUY', `${outcomeName} on "${marketTitle}" @ ${price} | ${amountUsd}`);
    }
    res.json({ success: result.success, message: result.message });
  } catch (e: any) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/paper/close', async (req, res) => {
  try {
    const { positionId, exitPrice } = req.body;
    const result = paperEngine.closePosition(positionId, exitPrice);
    if (result.success && settingsManager.get().telegramEnabled) {
      await telegram.notifyTrade('SELL', `Closed position | ${result.message}`);
    }
    res.json({ success: result.success, message: result.message });
  } catch (e: any) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/api/paper/trades', (req, res) => {
  res.json({ success: true, data: paperEngine.getRecentTrades(30) });
});

// --- Kelly Criterion ---

import {
  createAiRunner, stopAiRunner, getAiRunners,
  runnerOpenPosition, runnerClosePosition,
  summarizeRunner,
} from '../features/ai-paper-runner';

app.post('/api/kelly', (req, res) => {
  const { probability, price, bankroll, fraction } = req.body;
  const result = kellySizer.calculate(probability, price, bankroll || 1000, fraction);
  res.json({ success: true, data: result });
});

// --- AI Paper Runner ---

app.get('/api/ai-runners', (_req, res) => {
  const runners = getAiRunners().map(r => ({ ...r, summary: summarizeRunner(r) }));
  res.json({ success: true, data: runners });
});

app.post('/api/ai-runners/create', express.json(), (req, res) => {
  const { venue, symbolOrMarketId, title, budgetUsd } = req.body ?? {};
  if (!venue || !symbolOrMarketId || !budgetUsd || typeof budgetUsd !== 'number' || budgetUsd < 1) {
    return res.status(400).json({ success: false, error: '请填写平台、标的和金额（≥$1）' });
  }
  try {
    const runner = createAiRunner(venue, String(symbolOrMarketId), String(title || symbolOrMarketId), budgetUsd);
    res.json({ success: true, data: runner });
  } catch (e: any) { res.status(400).json({ success: false, error: e.message }); }
});

app.post('/api/ai-runners/stop', express.json(), (req, res) => {
  const { id } = req.body ?? {};
  const runner = id ? stopAiRunner(String(id)) : null;
  if (!runner) return res.status(404).json({ success: false, error: '未找到跑单或已停止' });
  res.json({ success: true, data: runner });
});

async function tickAllAiRunners(): Promise<Array<{ id: string; actionZh: string }>> {
  const results: Array<{ id: string; actionZh: string }> = [];
  for (const runner of getAiRunners().filter(r => r.status === 'RUNNING')) {
    try {
      if (runner.venue === 'Binance') {
        const symbol = runner.symbolOrMarketId.toUpperCase();
        const klineRes = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=20`,
          { signal: AbortSignal.timeout(8_000) },
        );
        if (!klineRes.ok) continue;
        const klines = (await klineRes.json()) as unknown[][];
        const closes = klines.map(k => Number(k[4]));
        if (closes.length < 15) continue;

        // Simple RSI(14)
        let gains = 0, losses = 0;
        for (let i = 1; i < 15; i++) {
          const diff = closes[closes.length - i] - closes[closes.length - i - 1];
          if (diff > 0) gains += diff; else losses += Math.abs(diff);
        }
        const rs = gains / (losses || 1e-9);
        const rsi = 100 - 100 / (1 + rs);
        const price = closes[closes.length - 1];
        const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const aboveSma = price > sma10;

        const openPos = runner.positions.find(p => p.status === 'OPEN');
        if (!openPos && rsi < 32 && runner.cashUsd > 5) {
          const qty = Math.floor(runner.cashUsd * 0.95 / price * 1000) / 1000;
          if (qty > 0) {
            runnerOpenPosition(runner.id, price, qty, 'LONG', `RSI ${rsi.toFixed(0)} 超卖，价格${aboveSma ? '在' : '低于'}SMA10`);
            results.push({ id: runner.id, actionZh: `BUY ${qty} @ ${price.toFixed(2)} (RSI=${rsi.toFixed(0)})` });
          }
        } else if (openPos && (rsi > 68 || !aboveSma)) {
          const pnl = runnerClosePosition(runner.id, openPos.id, price,
            rsi > 68 ? `RSI ${rsi.toFixed(0)} 超买` : '跌破 SMA10 止损');
          results.push({ id: runner.id, actionZh: `SELL @ ${price.toFixed(2)} PnL=${pnl?.toFixed(2) ?? '?'}` });
        }
      }
      // Predict.fun tick can be added later with radar probability data.
    } catch { /* skip on error */ }
  }

  return results;
}

app.post('/api/ai-runners/tick', express.json(), async (_req, res) => {
  const results = await tickAllAiRunners();
  res.json({ success: true, actions: results });
});

// --- Server-Sent Events: live AI runner updates + auto-tick ---
const sseClients = new Set<import('express').Response>();

function broadcastSse(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Auto-execute AI runners every 60 seconds and push updates to all open pages.
setInterval(() => {
  void (async () => {
    try {
      const actions = await tickAllAiRunners();
      broadcastSse('ai-runner-update', {
        at: new Date().toISOString(),
        actions,
      });
    } catch { /* keep interval alive */ }
  })();
}, 60_000);

// --- Backtesting ---

app.get('/api/backtest', (req, res) => {
  const lookback = parseInt(req.query.lookback as string) || 10;
  const threshold = parseFloat(req.query.threshold as string) || 0.03;
  const holding = parseInt(req.query.holding as string) || 5;
  const result = backtester.runMomentumBacktest(lookback, threshold, holding);
  res.json({ success: true, data: result });
});

// --- Price History ---

app.get('/api/history/:marketId', (req, res) => {
  const data = priceTracker.getMarketHistory(parseInt(req.params.marketId));
  if (!data) return res.json({ success: false, error: '暂无该市场的历史数据' });
  res.json({ success: true, data });
});

app.get('/api/correlations', (req, res) => {
  res.json({ success: true, data: priceTracker.allCorrelations() });
});

// --- News Feed ---

app.get('/api/news', async (req, res) => {
  try {
    const items = await newsFeed.getNews();
    res.json({ success: true, data: items });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Settings ---

app.get('/api/settings', (req, res) => {
  res.json({ success: true, data: settingsManager.get() });
});

app.post('/api/settings', (req, res) => {
  const updated = settingsManager.update(req.body);
  res.json({ success: true, data: updated });
});

app.post('/api/settings/reset', (req, res) => {
  const reset = settingsManager.reset();
  res.json({ success: true, data: reset });
});

// --- Telegram Test ---

app.post('/api/telegram/test', async (req, res) => {
  const sent = await telegram.send('🤖 Predict.fun Bot connected! You will receive trading signals here.');
  res.json({ success: sent, message: sent ? '测试消息已发送！' : 'Telegram 未配置或发送失败' });
});

// --- Notification Channel Test ---

app.post('/api/notification-channels/test', async (_req, res) => {
  const result = await testNotificationChannels();
  res.json({ success: true, data: result });
});

// --- Daily Report ---

app.post('/api/report/daily', async (req, res) => {
  const report = await reportScheduler.sendDailyReport();
  res.json({ success: true, data: { report } });
});

// Start server
async function main() {
  const hasWallet = !!config.privateKey;

  if (hasWallet) {
    validateConfig();
  }


  if (hasWallet) {
    console.log('\n  Initializing trading engine...');
    await tradingEngine.initialize();
    console.log('  Ready!\n');
  } else {
    console.log('\n  Running in VIEW-ONLY mode (no wallet configured)\n');
  }


  const PORT = 3000;
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`  ╔══════════════════════════════════════════════╗`);
    console.log(`  ║  💰 MONEYMONEY TRADING DASHBOARD                   ║`);
    console.log(`  ╠══════════════════════════════════════════════╣`);
    console.log(`  ║  Open in browser:                            ║`);
    console.log(`  ║  http://localhost:${PORT}                        ║`);
    console.log(`  ╚══════════════════════════════════════════════╝\n`);
    riskPatrol.start();
    // Pre-fetch radar data so the first click on the tab is already warm.
    void warmPredictionRadarCache();
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  ❌ Port ${PORT} is already in use!`);
      console.error('  Try: taskkill /F /IM node.exe\n');
    } else {
      console.error('  Server error:', err.message);
    }
    process.exit(1);
  });

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('\n  Shutting down...');
    server.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('  ❌ Startup error:', err.message);
  process.exit(1);
});

