/**
 * MoneyMoney Trade Assistant
 * Aggregates keyless market data into transparent, risk-aware reminders.
 * It does not place live orders and should never be treated as financial advice.
 */

import { api } from '../api';
import iconv from 'iconv-lite';
import type { Category } from '../types';
import { binanceFeed } from './binance';
import { getEquityOptionsSnapshot, getOptionsSnapshot, type OptionRow } from './options-market';
import { getFearGreed, getFundingRates } from './market-sentiment';
import { getGlobalMacroSpotSnapshot, type GlobalMacroSpotSnapshot } from './global-macro-spot';
import { getCrossAssetRisk, type CrossAssetRisk, type VolatilityTermStructure } from './cross-asset-risk';
import { getCrossAssetCorrelationRadar, type CrossAssetCorrelationResult } from './cross-asset-correlation';
import { getMarketRegime, type RegimeResult } from './market-regime';
import { getSupportResistance, type SrResult } from './support-resistance';
import { getMultiTimeframeConfluence, type ConfluenceResult } from './multi-timeframe';
import { getEventRisk, type EventRiskResult } from './event-risk';
import { getStablecoinLiquidity, type StablecoinLiquidityResult } from './stablecoin-liquidity';
import { getCotRadar, type CotRadarResult } from './cftc-positioning';
import { getPerpetualCrowding, type PerpetualCrowdingResult } from './perpetual-crowding';
import { getOrderFlowLiquidityRadar, type OrderFlowLiquidityResult } from './order-flow-liquidity';
import { getShortInterestRadar, getShortInterestSnapshot, type ShortInterestRadar } from './short-interest';
import { getMarketBreadthSnapshot, type MarketBreadthSnapshot } from './market-breadth';
import {
  getInstitutionalOwnershipRadar,
  getInstitutionalOwnershipSnapshot,
  type InstitutionalOwnershipRadar,
} from './institutional-ownership';
import {
  getAnalystConsensusRadar,
  getAnalystConsensusSnapshot,
  type AnalystConsensusRadar,
} from './analyst-consensus';
import { getBitcoinOnchainRadar, type BitcoinOnchainResult } from './bitcoin-onchain';
import { getMacroMarketSnapshot, type MacroSeries } from './macro-market';
import { getTreasuryYields, type TreasuryYields } from './treasury-yields';
import { getSectorRotationSnapshot, type SectorRotationSnapshot } from './sector-rotation';
import {
  syncAssistantJournal,
  type AssistantGroupStats,
  type AssistantJournalSummary,
} from './assistant-journal';
import { notifyHighSuccessResults } from './high-success-notifier';

export interface OptionStrategySpec {
  kind: 'iron-condor' | 'bull-put-spread' | 'bear-call-spread' | 'protective-put';
  nameZh: string;
  netPremium: number;
  shortPut?: number;
  longPut?: number;
  shortCall?: number;
  longCall?: number;
}

export interface AssistantAction {
  id: string;
  venue: 'Binance' | 'Predict.fun' | 'Stocks' | 'Options' | 'Macro';
  symbol: string;
  title: string;
  action: 'BUY' | 'SELL' | 'WAIT';
  actionZh: string;
  direction?: 'UP' | 'DOWN' | 'LONG' | 'SHORT';
  categoryId?: number;
  slug?: string;
  expiresAt?: string;
  confidencePct: number;
  probabilityPct?: number;
  historicalWinRatePct?: number;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  suggestedRiskPct: number;
  horizon: string;
  reasons: string[];
  metrics: Record<string, string | number>;
  marketId?: number;
  optionStrategy?: OptionStrategySpec;
}

export interface AssistantReport {
  generatedAt: string;
  regime: {
    label: string;
    labelZh: string;
    score: number;
    descriptionZh: string;
  };
  reminders: AssistantAction[];
  cryptoActions: AssistantAction[];
  stockActions: AssistantAction[];
  macroActions: AssistantAction[];
  sectorActions: AssistantAction[];
  sectorRotation?: SectorRotationSnapshot;
  predictionPicks: AssistantAction[];
  optionActions: AssistantAction[];
  journal?: AssistantJournalSummary;
  calibration?: AssistantCalibration;
  strategyTilt?: AssistantStrategyTilt;
  context: {
    fearGreed: { value: number; labelZh: string } | null;
    fundingBias: string;
    fundingAvgPct?: number | null;
  crossAssetRisk?: CrossAssetRisk;
  crossAssetCorrelation?: CrossAssetCorrelationResult;
  marketRegime?: RegimeResult;
  eventRisk?: EventRiskResult;
  stablecoinLiquidity?: StablecoinLiquidityResult;
  cotPositioning?: CotRadarResult;
  perpetualCrowding?: PerpetualCrowdingResult;
  orderFlowLiquidity?: OrderFlowLiquidityResult;
  shortInterest?: ShortInterestRadar;
  marketBreadth?: MarketBreadthSnapshot;
  institutionalOwnership?: InstitutionalOwnershipRadar;
  analystConsensus?: AnalystConsensusRadar;
  globalMacroSpot?: GlobalMacroSpotSnapshot;
  bitcoinOnchain?: BitcoinOnchainResult;
  liquidityBias: string;
  cotBias: string;
  derivativesBias: string;
  cautionFlags?: AssistantCautionFlag[];
  cautionSummaryZh?: string;
  sources: string[];
    warnings: string[];
  };
}

export interface AssistantCalibration {
  enabled: boolean;
  closed: number;
  adjustedCount: number;
  noteZh: string;
}

export interface AssistantStrategyTilt {
  regime: string;
  regimeZh: string;
  enabled: boolean;
  sampleCount: number;
  longPriority: number;
  shortPriority: number;
  priorityGap: number;
  preferredDirectionZh: string;
  noteZh: string;
}

export interface AssistantCautionFlag {
  id: string;
  severity: 'high' | 'medium' | 'info';
  severityZh: '高' | '中' | '观察';
  titleZh: string;
  adviceZh: string;
  source: string;
}

interface KlineLike {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}

const CRYPTO_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];
const STOCK_SYMBOLS = [
  'usAAPL', 'usMSFT', 'usNVDA', 'usTSLA',
  'usSPY', 'usQQQ', 'hk00700', 'sh600519',
];
const STOCK_API_SYMBOLS: Record<string, string> = {
  usAAPL: 'usAAPL.OQ',
  usMSFT: 'usMSFT.OQ',
  usNVDA: 'usNVDA.OQ',
  usTSLA: 'usTSLA.OQ',
  usSPY: 'usSPY.AM',
  usQQQ: 'usQQQ.OQ',
  hk00700: 'hk00700',
  sh600519: 'sh600519',
};
const STOCK_FALLBACK_NAMES: Record<string, string> = {
  usAAPL: '苹果',
  usMSFT: '微软',
  usNVDA: '英伟达',
  usTSLA: '特斯拉',
  usSPY: '标普500 ETF',
  usQQQ: '纳指100 ETF',
  hk00700: '腾讯控股',
  sh600519: '贵州茅台',
};
const CACHE_TTL_MS = 60_000;
let cache: { ts: number; value: AssistantReport } | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gain += diff; else loss -= diff;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function macdHistogram(closes: number[]): number {
  if (closes.length < 35) return 0;
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const signal = ema(macdLine.slice(25), 9);
  return signal.length ? macdLine[macdLine.length - 1] - signal[signal.length - 1] : 0;
}

function atr(klines: KlineLike[], period = 14): number {
  if (klines.length < 2) return 0;
  const ranges: number[] = [];
  for (let i = Math.max(1, klines.length - period); i < klines.length; i++) {
    const prevClose = klines[i - 1].close;
    ranges.push(Math.max(
      klines[i].high - klines[i].low,
      Math.abs(klines[i].high - prevClose),
      Math.abs(klines[i].low - prevClose),
    ));
  }
  return ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
}

function assetFromCategory(category: Category): string | null {
  const raw = category.variantData?.priceFeedSymbol
    || category.markets?.[0]?.variantData?.priceFeedSymbol;
  const normalized = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z0-9]+USDT$/.test(normalized)) return normalized;
  const title = category.title.toUpperCase();
  if (title.includes('BITCOIN') || title.includes(' BTC')) return 'BTCUSDT';
  if (title.includes('ETHEREUM') || title.includes(' ETH')) return 'ETHUSDT';
  if (title.includes('BNB') || title.includes(' BNB')) return 'BNBUSDT';
  if (title.includes('SOLANA') || title.includes(' SOL')) return 'SOLUSDT';
  if (title.includes('XRP')) return 'XRPUSDT';
  if (title.includes('DOGE')) return 'DOGEUSDT';
  return null;
}

async function analyzePredictionMarkets(): Promise<AssistantAction[]> {
  const collected: Category[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 2; page++) {
    const response = await api.getCategories(50, cursor, 'OPEN');
    collected.push(...response.data);
    cursor = response.cursor || undefined;
    if (!cursor) break;
  }

  const now = Date.now();
  const candidates = collected
    .filter(item => item.status === 'OPEN'
      && item.isVisible !== false
      && item.marketVariant === 'CRYPTO_UP_DOWN')
    .filter(item => !item.endsAt || new Date(item.endsAt).getTime() > now + 45_000)
    .sort((a, b) => new Date(a.endsAt || a.startsAt).getTime()
      - new Date(b.endsAt || b.startsAt).getTime())
    .slice(0, 12);

  const results = await Promise.allSettled(candidates.map(async (category): Promise<AssistantAction | null> => {
    const symbol = assetFromCategory(category);
    const startPrice = Number(category.variantData?.startPrice
      ?? category.markets?.[0]?.variantData?.startPrice ?? NaN);
    if (!symbol || !Number.isFinite(startPrice)) return null;

    const klines = await binanceFeed.getKlines(symbol, '1m', 20) as KlineLike[];
    const last = klines[klines.length - 1];
    if (!last) return null;

    const current = last.close;
    const change = current - startPrice;
    const volatility = atr(klines, 14) || Math.max(current * 0.0004, 1e-8);
    const edge = clamp(change / volatility, -3.5, 3.5);

    // Recent micro-momentum nudges the estimate, but never lets it become a certainty.
    const recent = klines.slice(-4);
    const trendUp = recent.length > 1 && recent[recent.length - 1].close >= recent[0].close;
    const adjustedEdge = edge + (trendUp ? 0.18 : -0.18);
    const upProbability = clamp(logistic(adjustedEdge * 1.15), 0.08, 0.92);
    const preferUp = upProbability >= 0.5;
    const probability = preferUp ? upProbability : 1 - upProbability;
    const confidence = probability * 100;

    const endMs = category.endsAt ? new Date(category.endsAt).getTime() : now;
    const minutesLeft = Math.max(0, Math.round((endMs - now) / 60000));
    const windowMinutes = Math.max(1, Math.round(
      (endMs - new Date(category.startsAt).getTime()) / 60000,
    ));

    return {
      id: `predict-${category.id}`,
      venue: 'Predict.fun',
      symbol,
      title: `${symbol.replace(/USDT$/, '')} Up or Down ${windowMinutes}m`,
      action: confidence >= 57 ? 'BUY' : 'WAIT',
      actionZh: confidence < 57
        ? '等待'
        : `${preferUp ? '买入 UP' : '买入 DOWN'}（${preferUp ? '涨' : '跌'}）`,
      direction: preferUp ? 'UP' : 'DOWN',
      categoryId: category.id,
      slug: category.slug,
      expiresAt: category.endsAt,
      confidencePct: round(confidence, 1),
      probabilityPct: round(probability * 100, 1),
      suggestedRiskPct: confidence >= 70 ? 1 : 0.5,
      horizon: minutesLeft <= 1 ? '1 分钟内结算' : `${minutesLeft} 分钟结算`,
      reasons: [
        `相对窗口开盘价${change >= 0 ? '高' : '低'} ${round(Math.abs(change / startPrice * 100), 3)}%`,
        `近几分钟价格${trendUp ? '持续偏强' : '持续偏弱'}`,
        `波动归一后优势 ${round(Math.abs(edge) * 100, 0)} / 100`,
      ],
      metrics: {
        开盘价: round(startPrice, current < 10 ? 5 : 2),
        当前价: round(current, current < 10 ? 5 : 2),
        剩余: `${minutesLeft}m`,
      },
      marketId: category.markets?.[0]?.id ?? category.id,
    };
  }));

  return results
    .filter((item): item is PromiseFulfilledResult<AssistantAction | null> => item.status === 'fulfilled')
    .map(item => item.value)
    .filter((item): item is AssistantAction => item !== null)
    .sort((a, b) => b.probabilityPct! - a.probabilityPct!);
}

async function analyzeCryptoTechnicals(): Promise<AssistantAction[]> {
  // Fetch BTC multi-timeframe confluence as market-wide proxy
  const btcConfluence = await getMultiTimeframeConfluence('BTCUSDT').catch(() => null as ConfluenceResult | null);
  const results = await Promise.allSettled(CRYPTO_SYMBOLS.map(async (symbol): Promise<AssistantAction> => {
    const [ticker, hourly, sr] = await Promise.all([
      binanceFeed.getPrice(symbol),
      binanceFeed.getKlines(symbol, '1h', 120) as Promise<KlineLike[]>,
      getSupportResistance(symbol, '4h').catch(() => null as SrResult | null),
    ]);
    if (!ticker || hourly.length < 60) throw new Error(`${symbol} data unavailable`);

    const closes = hourly.map(item => item.close);
    const ma20 = sma(closes, 20)!;
    const ma50 = sma(closes, 50)!;
    const rsiValue = rsi(closes, 14);
    const histogram = macdHistogram(closes);
    const volatility = atr(hourly, 14);
    const roc = ((closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11]) * 100;

    let score = 0;
    const reasons: string[] = [];
    if (ticker.price > ma20) { score += 16; reasons.push('价格站上 20 小时均线'); }
    else { score -= 16; reasons.push('价格跌破 20 小时均线'); }

    if (ma20 > ma50) { score += 13; reasons.push('20/50 小时均线多头排列'); }
    else { score -= 13; reasons.push('20/50 小时均线空头排列'); }

    if (rsiValue <= 30) { score += 24; reasons.push(`RSI ${round(rsiValue, 1)}，进入超卖区`); }
    else if (rsiValue <= 45) { score += 7; reasons.push(`RSI ${round(rsiValue, 1)}，偏弱但有修复空间`); }
    else if (rsiValue >= 70) { score -= 24; reasons.push(`RSI ${round(rsiValue, 1)}，进入超买区`); }
    else if (rsiValue >= 55) { score -= 6; reasons.push(`RSI ${round(rsiValue, 1)}，强势但追价风险升高`); }
    else { reasons.push(`RSI ${round(rsiValue, 1)}，动能中性`); }

    if (histogram > 0) { score += 17; reasons.push('MACD 柱状图转正'); }
    else if (histogram < 0) { score -= 17; reasons.push('MACD 柱状图为负'); }

    if (roc > 1.5) { score += 12; reasons.push(`10 小时涨幅 ${round(roc, 2)}%`); }
    else if (roc < -1.5) { score -= 12; reasons.push(`10 小时跌幅 ${round(roc, 2)}%`); }
    else { reasons.push(`10 小时变动 ${round(roc, 2)}%`); }

    const direction = score > 0 ? 1 : -1;
    const confidence = 50 + clamp(Math.abs(score) * 0.48, 0, 34);
    const action: AssistantAction['action'] = confidence >= 58
      ? (direction > 0 ? 'BUY' : 'SELL')
      : 'WAIT';
    const stopDistance = Math.max(volatility * 1.6, ticker.price * 0.006);

    // Use S/R levels for smarter stop / target when available
    let stopLoss = direction > 0 ? ticker.price - stopDistance : ticker.price + stopDistance;
    let takeProfit = direction > 0 ? ticker.price + stopDistance * 2 : ticker.price - stopDistance * 2;
    const srDecimals = ticker.price < 10 ? 5 : 2;
    if (sr) {
      if (direction > 0 && sr.nearestSupport) {
        // Place stop just below nearest support
        stopLoss = Math.min(stopLoss, sr.nearestSupport.price * 0.998);
        if (sr.nearestResistance) takeProfit = Math.max(takeProfit, sr.nearestResistance.price);
        reasons.push(`下方关键支撑 $${sr.nearestSupport.price}（${sr.nearestSupport.touches}次触碰）`);
        if (sr.nearestResistance) reasons.push(`上方目标阻力 $${sr.nearestResistance.price}`);
      } else if (direction < 0 && sr.nearestResistance) {
        stopLoss = Math.max(stopLoss, sr.nearestResistance.price * 1.002);
        if (sr.nearestSupport) takeProfit = Math.min(takeProfit, sr.nearestSupport.price);
        reasons.push(`上方关键阻力 $${sr.nearestResistance.price}（${sr.nearestResistance.touches}次触碰）`);
        if (sr.nearestSupport) reasons.push(`下方目标支撑 $${sr.nearestSupport.price}`);
      }
    }

    // Multi-timeframe confluence adjustment (BTC as crypto market proxy)
    let mtfAdjustment = 0;
    if (btcConfluence && btcConfluence.confluenceScore >= 50) {
      const signalDir = direction > 0 ? 'bullish' : 'bearish';
      if (btcConfluence.overallDirection === signalDir) {
        mtfAdjustment = Math.min(5, Math.round(btcConfluence.confluenceScore / 15));
      } else if (btcConfluence.overallDirection !== 'neutral') {
        mtfAdjustment = -Math.min(4, Math.round(btcConfluence.confluenceScore / 20));
      }
      if (mtfAdjustment !== 0) {
        reasons.push(`BTC 多周期${btcConfluence.overallDirection === 'bullish' ? '看多' : btcConfluence.overallDirection === 'bearish' ? '看空' : '分歧'}共振 ${btcConfluence.confluenceScore}%，信心微调 ${mtfAdjustment > 0 ? '+' : ''}${mtfAdjustment} 分。`);
      }
    }

    return {
      id: `crypto-${symbol}`,
      venue: 'Binance',
      symbol,
      title: `${symbol.replace('USDT', '/USDT')} 技术面`,
      action,
      actionZh: action === 'BUY' ? '考虑买入' : action === 'SELL' ? '考虑减仓/卖出' : '等待',
      direction: direction > 0 ? 'LONG' : 'SHORT',
      confidencePct: round(clamp(confidence + mtfAdjustment, 30, 95), 1),
      entry: round(ticker.price, ticker.price < 10 ? 5 : 2),
      stopLoss: round(stopLoss, srDecimals),
      takeProfit: round(takeProfit, srDecimals),
      suggestedRiskPct: confidence >= 68 ? 1 : 0.5,
      horizon: '数小时至 1-3 天',
      reasons,
      metrics: {
        RSI: round(rsiValue, 1),
        ROC10h: `${round(roc, 2)}%`,
        MACD: round(histogram, 4),
        ATR: round(volatility, ticker.price < 10 ? 5 : 2),
        ...(sr ? { '支撑/阻力': `${sr.nearestSupport?.price ?? '—'} / ${sr.nearestResistance?.price ?? '—'}` } : {}),
        ...(btcConfluence ? { '多周期共振': `${btcConfluence.overallDirection === 'bullish' ? '看多' : btcConfluence.overallDirection === 'bearish' ? '看空' : '中性'} ${btcConfluence.confluenceScore}%` } : {}),
      },
    };
  }));

  return results
    .filter((item): item is PromiseFulfilledResult<AssistantAction> => item.status === 'fulfilled')
    .map(item => item.value)
    .sort((a, b) => b.confidencePct - a.confidencePct);
}

interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
}

function parseStockQuote(raw: string): StockQuote | null {
  const match = raw.match(/v_\w+="([^"]+)"/);
  if (!match) return null;
  const parts = match[1].split('~');
  const price = Number(parts[3]);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    symbol: String(parts[2] || ''),
    name: String(parts[1] || ''),
    price,
    changePct: Number(parts[32]) || 0,
  };
}

async function fetchStockQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
  const response = await fetch(`https://qt.gtimg.cn/q=${symbols.join(',')}`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('Tencent quotes unavailable');
  // Tencent serves legacy Chinese quotes in GB18030; iconv-lite keeps this working in packaged builds.
  const text = iconv.decode(Buffer.from(await response.arrayBuffer()), 'gb18030');
  return new Map(text.split(';')
    .map(row => parseStockQuote(row.trim()))
    .filter((row): row is StockQuote => row !== null)
    .flatMap(row => {
      // Tencent returns AAPL.OQ while the dashboard uses usAAPL as its stable key.
      const normalized = row.symbol.toUpperCase();
      const aliases = [normalized, normalized.replace(/\..*$/, '')];
      return aliases.map(alias => [alias, row] as const);
    }));
}

async function fetchStockKlines(symbol: string, apiSymbolOverride?: string): Promise<KlineLike[]> {
  const apiSymbol = STOCK_API_SYMBOLS[symbol]
    || (symbol.startsWith('us') && !symbol.includes('.') ? `${symbol}.OQ` : symbol);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${apiSymbol},day,,,120,qfq`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${symbol} daily data unavailable`);
  const payload: any = await response.json();
  const dataKey = Object.keys(payload.data || {})[0];
  const rows = payload.data?.[dataKey]?.qfqday || payload.data?.[dataKey]?.day;
  if (!Array.isArray(rows) || rows.length < 60) {
    throw new Error(`${symbol} daily history unavailable (${apiSymbol})`);
  }
  return rows.map((row: string[]) => ({
    time: new Date(row[0]).getTime(),
    open: Number(row[1]),
    close: Number(row[2]),
    high: Number(row[3]),
    low: Number(row[4]),
    volume: Number(row[5]) || 0,
  })).filter(item => [item.open, item.close, item.high, item.low].every(Number.isFinite));
}

function marketLabel(symbol: string): string {
  if (symbol.startsWith('us')) return symbol.toLowerCase() === 'usspy' || symbol.toLowerCase() === 'usqqq'
    ? '美股 ETF'
    : '美股';
  if (symbol.startsWith('hk')) return '港股';
  if (symbol.startsWith('sh') || symbol.startsWith('sz')) return 'A股';
  return '全球股票';
}

async function analyzeStockTechnicals(): Promise<AssistantAction[]> {
  let quotes = new Map<string, StockQuote>();
  try {
    quotes = await fetchStockQuotes(STOCK_SYMBOLS);
  } catch {
    // Daily bars still contain a usable last close.
  }

  const results = await Promise.allSettled(STOCK_SYMBOLS.map(async (symbol): Promise<AssistantAction> => {
    const quote = quotes.get(symbol.toUpperCase())
      || quotes.get(symbol.replace(/^(us|hk|sh|sz)/i, '').toUpperCase());
    const daily = await fetchStockKlines(symbol, quote?.symbol);
    const current = quote?.price ?? daily[daily.length - 1].close;
    if (!Number.isFinite(current) || current <= 0) throw new Error(`${symbol} price unavailable`);

    const closes = daily.map(item => item.close);
    const ma20 = sma(closes, 20)!;
    const ma50 = sma(closes, 50)!;
    const rsiValue = rsi(closes, 14);
    const histogram = macdHistogram(closes);
    const volatility = atr(daily, 14);
    const roc = ((closes[closes.length - 1] - closes[closes.length - 11])
      / closes[closes.length - 11]) * 100;
    const shortInterest = /^us[A-Z]/.test(symbol) && symbol.toLowerCase() !== 'usspy'
      ? await getShortInterestSnapshot(symbol.slice(2)).catch(() => null)
      : null;
    const institutionalOwnership = /^us[A-Z]/.test(symbol)
      && !['usspy', 'usqqq'].includes(symbol.toLowerCase())
      ? await getInstitutionalOwnershipSnapshot(symbol.slice(2)).catch(() => null)
      : null;
    const analystConsensus = /^us[A-Z]/.test(symbol)
      && !['usspy', 'usqqq'].includes(symbol.toLowerCase())
      ? await getAnalystConsensusSnapshot(symbol.slice(2)).catch(() => null)
      : null;

    let score = 0;
    const reasons: string[] = [];
    if (current > ma20) { score += 16; reasons.push('价格站上 20 日均线'); }
    else { score -= 16; reasons.push('价格跌破 20 日均线'); }

    if (ma20 > ma50) { score += 13; reasons.push('20/50 日均线多头排列'); }
    else { score -= 13; reasons.push('20/50 日均线空头排列'); }

    if (rsiValue <= 30) { score += 24; reasons.push(`RSI ${round(rsiValue, 1)}，进入超卖区`); }
    else if (rsiValue <= 45) { score += 7; reasons.push(`RSI ${round(rsiValue, 1)}，偏弱但有修复空间`); }
    else if (rsiValue >= 70) { score -= 24; reasons.push(`RSI ${round(rsiValue, 1)}，进入超买区`); }
    else if (rsiValue >= 55) { score -= 6; reasons.push(`RSI ${round(rsiValue, 1)}，强势但追高风险升高`); }
    else { reasons.push(`RSI ${round(rsiValue, 1)}，动能中性`); }

    if (histogram > 0) { score += 17; reasons.push('MACD 柱状图转正'); }
    else if (histogram < 0) { score -= 17; reasons.push('MACD 柱状图为负'); }

    if (roc > 3) { score += 12; reasons.push(`10 日涨幅 ${round(roc, 2)}%`); }
    else if (roc < -3) { score -= 12; reasons.push(`10 日跌幅 ${round(roc, 2)}%`); }
    else { reasons.push(`10 日变动 ${round(roc, 2)}%`); }

    if (shortInterest) {
      if (shortInterest.signal === 'covering') {
        score += 4;
        reasons.push('空头利息回落，回补压力减轻');
      } else if (shortInterest.signal === 'squeeze-risk') {
        // A crowded short can amplify either side; treat it as a small
        // volatility bonus only when the price structure already leans bullish.
        const tilt = score > 0 ? 4 : -3;
        score += tilt;
        reasons.push(tilt > 0 ? '空头拥挤升高，突破有逼空放大可能' : '空头拥挤升高，方向分歧和波动风险加大');
      } else if (shortInterest.signal === 'crowded') {
        const tilt = score > 0 ? 3 : -3;
        score += tilt;
        reasons.push('空头押注集中，警惕急速反向波动');
      }
    }

    if (institutionalOwnership) {
      if (institutionalOwnership.signal === 'accumulation') {
        score += 4;
        reasons.push('机构净增持，中期筹码背景偏正面');
      } else if (institutionalOwnership.signal === 'distribution') {
        score -= 4;
        reasons.push('机构减持压力明显，反弹要求更高确认');
      } else if (institutionalOwnership.signal === 'mixed') {
        const tilt = institutionalOwnership.netSharePctOfHoldings > 0 ? 2 : -2;
        score += tilt;
        reasons.push('机构持仓分歧加大，方向需等价格确认');
      }
    }

    if (analystConsensus) {
      if (analystConsensus.signal === 'strong-buy' || analystConsensus.signal === 'buy') {
        const tilt = analystConsensus.signal === 'strong-buy' ? 4 : 3;
        score += tilt;
        reasons.push(`卖方共识${analystConsensus.consensus}，分析师背景偏正面`);
      } else if (analystConsensus.signal === 'sell' || analystConsensus.signal === 'strong-sell') {
        const tilt = analystConsensus.signal === 'strong-sell' ? -4 : -3;
        score += tilt;
        reasons.push(`卖方共识${analystConsensus.consensus}，机构研究偏谨慎`);
      } else if (Math.abs(analystConsensus.impliedUpsidePctFromMedian) >= 20) {
        const tilt = analystConsensus.impliedUpsidePctFromMedian > 0 ? 2 : -2;
        score += tilt;
        reasons.push('目标价与现价分歧较大，只作小幅方向提示');
      }
    }

    const direction = score > 0 ? 1 : -1;
    // Daily signals are slower and noisier after gaps, so confidence is capped lower.
    const confidence = 50 + clamp(Math.abs(score) * 0.42, 0, 28);
    const action: AssistantAction['action'] = confidence >= 57
      ? (direction > 0 ? 'BUY' : 'SELL')
      : 'WAIT';
    const stopDistance = Math.max(volatility * 1.8, current * 0.025);
    const digits = current < 10 ? 4 : 2;

    return {
      id: `stock-${symbol}`,
      venue: 'Stocks',
      symbol,
      title: `${quote?.name || STOCK_FALLBACK_NAMES[symbol] || symbol} 技术面`,
      action,
      actionZh: action === 'BUY' ? '考虑买入/加仓' : action === 'SELL' ? '考虑减仓/卖出' : '等待',
      direction: direction > 0 ? 'LONG' : 'SHORT',
      confidencePct: round(confidence, 1),
      entry: round(current, digits),
      stopLoss: round(direction > 0 ? current - stopDistance : current + stopDistance, digits),
      takeProfit: round(direction > 0 ? current + stopDistance * 2 : current - stopDistance * 2, digits),
      suggestedRiskPct: confidence >= 66 ? 1 : 0.5,
      horizon: '数日至数周（日线）',
      reasons,
      metrics: {
        市场: marketLabel(symbol),
        RSI: round(rsiValue, 1),
        ROC10d: `${round(roc, 2)}%`,
        ATR: round(volatility, digits),
        当日涨跌: `${round(quote?.changePct ?? 0, 2)}%`,
        ...(shortInterest ? { 空头信号: shortInterest.signalZh } : {}),
        ...(institutionalOwnership ? { 机构信号: institutionalOwnership.signalZh } : {}),
        ...(analystConsensus ? { 分析师共识: `${analystConsensus.consensus} ${analystConsensus.score}/5` } : {}),
      },
    };
  }));

  return results
    .filter((item): item is PromiseFulfilledResult<AssistantAction> => item.status === 'fulfilled')
    .map(item => item.value)
    .sort((a, b) => b.confidencePct - a.confidencePct);
}

function macroGroupLabel(group: MacroSeries['group']): string {
  return group === 'Forex'
    ? '外汇'
    : group === 'Commodity'
      ? '大宗商品代理 ETF'
      : '债券 / 信用代理 ETF';
}

async function analyzeMacroTechnicals(): Promise<AssistantAction[]> {
  const [snapshotResult, treasuryResult] = await Promise.allSettled([
    getMacroMarketSnapshot(),
    getTreasuryYields(),
  ]);
  if (snapshotResult.status === 'rejected') throw snapshotResult.reason;
  const snapshot = snapshotResult.value;
  const treasury = treasuryResult.status === 'fulfilled' ? treasuryResult.value : null;
  const twoTenSpread = treasury?.spreads.find(item => item.label === '2s10s');

  return snapshot.series.map(series => {
    const daily = series.bars.map(bar => ({ ...bar, volume: 0 }));
    const current = series.current;
    const closes = daily.map(item => item.close);
    const ma20 = sma(closes, 20)!;
    const ma50 = sma(closes, 50)!;
    const rsiValue = rsi(closes, 14);
    const histogram = macdHistogram(closes);
    const volatility = atr(daily, 14);
    const roc = ((closes[closes.length - 1] - closes[closes.length - 11])
      / closes[closes.length - 11]) * 100;

    let score = 0;
    const reasons: string[] = [];
    if (current > ma20) { score += 16; reasons.push('价格站上 20 日均线'); }
    else { score -= 16; reasons.push('价格跌破 20 日均线'); }

    if (ma20 > ma50) { score += 13; reasons.push('20/50 日均线多头排列'); }
    else { score -= 13; reasons.push('20/50 日均线空头排列'); }

    if (rsiValue <= 30) { score += 24; reasons.push(`RSI ${round(rsiValue, 1)}，进入超卖区`); }
    else if (rsiValue <= 45) { score += 7; reasons.push(`RSI ${round(rsiValue, 1)}，偏弱但有修复空间`); }
    else if (rsiValue >= 70) { score -= 24; reasons.push(`RSI ${round(rsiValue, 1)}，进入超买区`); }
    else if (rsiValue >= 55) { score -= 6; reasons.push(`RSI ${round(rsiValue, 1)}，强势但追高风险升高`); }
    else { reasons.push(`RSI ${round(rsiValue, 1)}，动能中性`); }

    if (histogram > 0) { score += 17; reasons.push('MACD 柱状图转正'); }
    else if (histogram < 0) { score -= 17; reasons.push('MACD 柱状图为负'); }

    if (roc > 3) { score += 12; reasons.push(`10 日涨幅 ${round(roc, 2)}%`); }
    else if (roc < -3) { score -= 12; reasons.push(`10 日跌幅 ${round(roc, 2)}%`); }
    else { reasons.push(`10 日变动 ${round(roc, 2)}%`); }

    // The official curve is a slow macro overlay, not a standalone trigger.
    let curveLabel = '暂无';
    if (series.group === 'Bond' && twoTenSpread && treasury) {
      const changeBp = twoTenSpread.changeBp;
      curveLabel = `${twoTenSpread.valuePct >= 0 ? '+' : ''}${twoTenSpread.valuePct}%${
        changeBp == null ? '' : ` (${changeBp > 0 ? '+' : ''}${changeBp}bp)`}`;
      const isDurationProxy = ['TLT', 'IEF', 'SHY'].includes(series.symbol);
      if (isDurationProxy && changeBp != null && changeBp <= -5) {
        score += 4;
        reasons.push('美债 2s10s 利差走低，久期品种对利率下行更敏感');
      } else if (isDurationProxy && changeBp != null && changeBp >= 5) {
        score -= 4;
        reasons.push('美债 2s10s 利差走高，长端利率压力上升');
      }
      if (treasury.curveInverted2s10s && !isDurationProxy) {
        reasons.push('收益率曲线倒挂，信用债需额外关注周期与信用风险');
      }
    }

    const direction = score > 0 ? 1 : -1;
    const confidence = 50 + clamp(Math.abs(score) * 0.42, 0, 28);
    const action: AssistantAction['action'] = confidence >= 57
      ? (direction > 0 ? 'BUY' : 'SELL')
      : 'WAIT';
    const stopDistance = Math.max(
      volatility * 1.8,
      current * (series.group === 'Forex' ? 0.012 : series.group === 'Bond' ? 0.008 : 0.025),
    );
    const digits = current < 10 ? 4 : current < 200 ? 3 : 2;

    const signal: AssistantAction = {
      id: `macro-${series.symbol.toLowerCase()}`,
      venue: 'Macro' as const,
      symbol: series.symbol,
      title: `${series.name} 技术面`,
      action,
      actionZh: action === 'BUY' ? '考虑买入/加仓' : action === 'SELL' ? '考虑减仓/卖出' : '等待',
      direction: direction > 0 ? 'LONG' : 'SHORT',
      confidencePct: round(confidence, 1),
      entry: round(current, digits),
      stopLoss: round(direction > 0 ? current - stopDistance : current + stopDistance, digits),
      takeProfit: round(direction > 0 ? current + stopDistance * 2 : current - stopDistance * 2, digits),
      suggestedRiskPct: confidence >= 66 ? 0.75 : 0.5,
      horizon: '数日至数周（日线）',
      reasons,
      metrics: {
        市场: macroGroupLabel(series.group),
        ...(series.group === 'Bond' ? { '2s10s': curveLabel } : {}),
        RSI: round(rsiValue, 1),
        ROC10d: `${round(roc, 2)}%`,
        ATR: round(volatility, digits),
        当日涨跌: `${round(series.changePct, 2)}%`,
      },
    };
    return signal;
  }).sort((a, b) => b.confidencePct - a.confidencePct);
}

function buildSectorRotationActions(
  snapshot: SectorRotationSnapshot,
): AssistantAction[] {
  const selected = [
    ...snapshot.rows.filter(row => row.rank <= 2),
    ...snapshot.rows.slice(-2),
  ];

  return selected.map(row => {
    const isLeader = row.excessMomentum >= 0;
    const trendConfirms = isLeader
      ? row.aboveMa20 && row.aboveMa50
      : !row.aboveMa20 && !row.aboveMa50;
    const action: AssistantAction['action'] = trendConfirms
      ? (isLeader ? 'BUY' : 'SELL')
      : 'WAIT';
    const confidence = 50 + clamp(
      Math.abs(row.excessMomentum) * 3.5
      + (row.aboveMa20 === (isLeader || row.rank > 2) ? 5 : 0)
      + (row.aboveMa50 === (isLeader || row.rank > 2) ? 3 : 0)
      + Math.min(6, Math.abs(row.trendScore) * 0.18),
      0,
      24,
    );
    const stopDistance = Math.max(row.current * 0.022, row.current * 0.018);
    const digits = row.current < 100 ? 2 : 2;

    return {
      id: row.id,
      venue: 'Macro' as const,
      symbol: row.symbol,
      title: `${row.name}（${row.symbol}）行业轮动`,
      action,
      actionZh: action === 'BUY'
        ? '相对强势，关注顺势机会'
        : action === 'SELL'
          ? '相对弱势，优先防守/回避'
          : '轮动方向未确认',
      direction: (isLeader ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
      confidencePct: round(confidence, 1),
      entry: round(row.current, digits),
      stopLoss: round(isLeader
        ? row.current - stopDistance
        : row.current + stopDistance, digits),
      takeProfit: round(isLeader
        ? row.current + stopDistance * 2
        : row.current - stopDistance * 2, digits),
      suggestedRiskPct: confidence >= 66 ? 0.75 : 0.5,
      horizon: '数日至数周（20 日行业动量）',
      reasons: [
        `20 日涨幅 ${row.roc20d}%，相对 ${snapshot.benchmarkSymbol} ${row.excessMomentum >= 0 ? '高' : '低'} ${Math.abs(row.excessMomentum)} 个百分点`,
        `行业排名 ${row.rank}/11，趋势分 ${row.trendScore}`,
        `价格${row.aboveMa20 ? '站上' : '跌破'} 20 日线，${row.aboveMa50 ? '站上' : '跌破'} 50 日线`,
      ],
      metrics: {
        轮动状态: snapshot.rotationRegimeZh,
        SPY20日: `${snapshot.benchmarkRoc20d}%`,
        '10日动量': `${row.roc10d}%`,
        当日涨跌: `${round(row.changePct)}%`,
      },
    };
  }).sort((a, b) => b.confidencePct - a.confidencePct);
}

async function analyzeSectorRotation(): Promise<{
  actions: AssistantAction[];
  snapshot: SectorRotationSnapshot;
}> {
  const snapshot = await getSectorRotationSnapshot();
  return { actions: buildSectorRotationActions(snapshot), snapshot };
}

function optionPremium(
  rows: OptionRow[],
  optionType: 'call' | 'put',
  strike: number,
): number | null {
  const row = rows.find(item => item.optionType === optionType && item.strike === strike);
  return row && row.premiumUsd > 0 ? row.premiumUsd : null;
}

function buildOptionSignal(
  snapshot: Awaited<ReturnType<typeof getOptionsSnapshot>>,
  expiry: Awaited<ReturnType<typeof getOptionsSnapshot>>['expiries'][number],
  idea: typeof expiry.strategyIdeas[number],
): AssistantAction | null {
  const rows = expiry.rows;
  const strikes = idea.strikes;
  let spec: OptionStrategySpec | null = null;

  if (strikes?.shortPut != null && strikes.longPut != null
    && strikes.shortCall != null && strikes.longCall != null) {
    const sellPut = optionPremium(rows, 'put', strikes.shortPut);
    const buyPut = optionPremium(rows, 'put', strikes.longPut);
    const sellCall = optionPremium(rows, 'call', strikes.shortCall);
    const buyCall = optionPremium(rows, 'call', strikes.longCall);
    if (sellPut != null && buyPut != null && sellCall != null && buyCall != null) {
      spec = {
        kind: 'iron-condor',
        nameZh: idea.nameZh,
        netPremium: sellPut + sellCall - buyPut - buyCall,
        ...strikes,
      };
    }
  } else if (strikes?.shortPut != null && strikes.longPut != null) {
    const sellPut = optionPremium(rows, 'put', strikes.shortPut);
    const buyPut = optionPremium(rows, 'put', strikes.longPut);
    if (sellPut != null && buyPut != null) {
      spec = {
        kind: 'bull-put-spread',
        nameZh: idea.nameZh,
        netPremium: sellPut - buyPut,
        shortPut: strikes.shortPut,
        longPut: strikes.longPut,
      };
    }
  } else if (strikes?.shortCall != null && strikes.longCall != null) {
    const sellCall = optionPremium(rows, 'call', strikes.shortCall);
    const buyCall = optionPremium(rows, 'call', strikes.longCall);
    if (sellCall != null && buyCall != null) {
      spec = {
        kind: 'bear-call-spread',
        nameZh: idea.nameZh,
        netPremium: sellCall - buyCall,
        shortCall: strikes.shortCall,
        longCall: strikes.longCall,
      };
    }
  } else if (strikes?.longPut != null) {
    const buyPut = optionPremium(rows, 'put', strikes.longPut);
    if (buyPut != null) {
      spec = {
        kind: 'protective-put',
        nameZh: idea.nameZh,
        netPremium: buyPut,
        longPut: strikes.longPut,
      };
    }
  }
  if (!spec || spec.netPremium <= 0) return null;

  return {
    id: `option-${snapshot.asset}-${expiry.expiryMs}-${idea.id}`,
    venue: 'Options',
    symbol: snapshot.asset,
    title: `${snapshot.asset} ${idea.nameZh}`,
    action: idea.score >= 60 ? 'BUY' : 'WAIT',
    actionZh: idea.score >= 60
      ? `模拟跟踪：${idea.riskZh}`
      : '等待更清晰的期权结构',
    direction: idea.id === 'bear-call-spread' ? 'SHORT' : 'LONG',
    expiresAt: new Date(expiry.expiryMs).toISOString(),
    confidencePct: Math.round(idea.score),
    entry: Math.round(spec.netPremium * 10000) / 10000,
    suggestedRiskPct: idea.score >= 75 ? 0.75 : 0.5,
    horizon: `至到期 ${expiry.label}`,
    reasons: [...idea.reasonsZh],
    metrics: {
      策略: idea.nameZh,
      展望: idea.outlookZh,
      净权利金: `$${spec.netPremium.toFixed(2)} / 股`,
      行权价: [
        spec.shortPut ? `P ${spec.shortPut}/${spec.longPut}` : '',
        spec.shortCall ? `C ${spec.shortCall}/${spec.longCall}` : '',
      ].filter(Boolean).join(' · ') || `P ${spec.longPut}`,
      PCR: expiry.putCallOIRatio == null ? '无' : expiry.putCallOIRatio.toFixed(2),
      最大痛点: expiry.maxPainStrike ?? '无',
    },
    optionStrategy: spec,
  };
}

async function analyzeOptionStrategies(): Promise<AssistantAction[]> {
  const results = await Promise.allSettled([
    getEquityOptionsSnapshot('SPY'),
    getOptionsSnapshot('BTC'),
  ]);

  return results
    .filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof getOptionsSnapshot>>> =>
      item.status === 'fulfilled')
    .flatMap(item => {
      const snapshot = item.value;
      const expiry = snapshot.expiries.find(node =>
        node.daysToExpiry >= 1
        && new Date(node.expiryMs).getTime() > Date.now()
        && node.strategyIdeas.length > 0);
      if (!expiry) return [];

      return expiry.strategyIdeas
        .filter(idea => idea.score >= 55)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map(idea => buildOptionSignal(snapshot, expiry, idea))
        .filter((signal): signal is AssistantAction => signal !== null);
    })
    .sort((a, b) => b.confidencePct - a.confidencePct);
}

type AssistantContext = AssistantReport['context'] & {
  regime: AssistantReport['regime'];
};

async function buildContext(
  symbolScores: number[],
  sectorRotation?: SectorRotationSnapshot,
): Promise<AssistantContext> {
  const [fearGreedResult, fundingResult, crossAssetResult, regimeResult, eventRiskResult, stablecoinResult, cotResult, perpetualResult, bitcoinOnchainResult, crossCorrelationResult, orderFlowResult, shortInterestResult, marketBreadthResult, institutionalOwnershipResult, analystConsensusResult, macroSpotResult] = await Promise.allSettled([
    getFearGreed(),
    getFundingRates(80),
    getCrossAssetRisk(),
    getMarketRegime(),
    getEventRisk(),
    getStablecoinLiquidity(),
    getCotRadar(),
    getPerpetualCrowding(),
    getBitcoinOnchainRadar(),
    getCrossAssetCorrelationRadar(),
    getOrderFlowLiquidityRadar(),
    getShortInterestRadar(),
    getMarketBreadthSnapshot(),
    getInstitutionalOwnershipRadar(),
    getAnalystConsensusRadar(),
    getGlobalMacroSpotSnapshot(),
  ]);

  const fearGreed = fearGreedResult.status === 'fulfilled'
    ? {
        value: fearGreedResult.value.current.value,
        labelZh: fearGreedResult.value.current.classificationZh,
      }
    : null;

  let fundingBias = '资金费率数据暂不可用';
  let fundingAvgPct: number | null = null;
  const fundingRows = fundingResult.status === 'fulfilled' ? fundingResult.value.rows : [];
  const relevant = ['BTC_USDT', 'ETH_USDT', 'BNB_USDT', 'SOL_USDT']
    .map(prefix => fundingRows.find(row => String(row.symbol).toUpperCase().startsWith(prefix)))
    .filter(Boolean) as any[];
  if (relevant.length) {
    const average = relevant.reduce((sum, row) => sum + row.fundingRatePct, 0) / relevant.length;
    fundingAvgPct = average;
    fundingBias = average > 0.03
      ? `主要合约资金费率偏高（均值 ${round(average, 3)}%），多头拥挤，谨防回调`
      : average < -0.01
        ? `主要合约资金费率偏低（均值 ${round(average, 3)}%），空头压力较重，可能出现反弹`
        : `主要合约资金费率中性（均值 ${round(average, 3)}%）`;
  }

  const warnings: string[] = [];
  if (fearGreedResult.status === 'rejected') warnings.push('恐贪指数暂时不可用');
  if (fundingResult.status === 'rejected') warnings.push('资金费率暂时不可用');
  if (crossAssetResult.status === 'rejected') warnings.push('全球指数/VIX 风险雷达暂时不可用');
  if (eventRiskResult.status === 'rejected') warnings.push('宏观事件风险日历暂时不可用');
  if (stablecoinResult.status === 'rejected') warnings.push('稳定币流动性暂时不可用');
  if (cotResult.status === 'rejected') warnings.push('CFTC 持仓暂时不可用');
  if (perpetualResult.status === 'rejected') warnings.push('永续持仓拥挤雷达暂时不可用');
  if (orderFlowResult.status === 'rejected') warnings.push('主动资金流与盘口雷达暂时不可用');
  if (shortInterestResult.status === 'rejected') warnings.push('美股空头利息雷达暂时不可用');
  if (marketBreadthResult.status === 'rejected') warnings.push('美股市场宽度雷达暂时不可用');
  if (institutionalOwnershipResult.status === 'rejected') warnings.push('美股机构持仓雷达暂时不可用');
  if (analystConsensusResult.status === 'rejected') warnings.push('美股分析师共识雷达暂时不可用');
  if (macroSpotResult.status === 'rejected') warnings.push('全球宏观现货雷达暂时不可用');
  if (bitcoinOnchainResult.status === 'rejected') warnings.push('比特币链上雷达暂时不可用');
  if (crossCorrelationResult.status === 'rejected') warnings.push('跨资产联动雷达暂时不可用');
  const crossAssetRisk = crossAssetResult.status === 'fulfilled' ? crossAssetResult.value : undefined;
  const marketRegime = regimeResult.status === 'fulfilled' ? regimeResult.value : undefined;
  const eventRisk = eventRiskResult.status === 'fulfilled' ? eventRiskResult.value : undefined;
  const stablecoinLiquidity = stablecoinResult.status === 'fulfilled' ? stablecoinResult.value : undefined;
  const cotPositioning = cotResult.status === 'fulfilled' ? cotResult.value : undefined;
  const perpetualCrowding = perpetualResult.status === 'fulfilled' ? perpetualResult.value : undefined;
  const orderFlowLiquidity = orderFlowResult.status === 'fulfilled' ? orderFlowResult.value : undefined;
  const shortInterest = shortInterestResult.status === 'fulfilled' ? shortInterestResult.value : undefined;
  const marketBreadth = marketBreadthResult.status === 'fulfilled' ? marketBreadthResult.value : undefined;
  const institutionalOwnership = institutionalOwnershipResult.status === 'fulfilled' ? institutionalOwnershipResult.value : undefined;
  const analystConsensus = analystConsensusResult.status === 'fulfilled' ? analystConsensusResult.value : undefined;
  const globalMacroSpot = macroSpotResult.status === 'fulfilled' ? macroSpotResult.value : undefined;
  const bitcoinOnchain = bitcoinOnchainResult.status === 'fulfilled' ? bitcoinOnchainResult.value : undefined;
  const crossAssetCorrelation = crossCorrelationResult.status === 'fulfilled' ? crossCorrelationResult.value : undefined;

  const sources = [
    'Binance public market data',
    'Predict.fun OPEN categories',
    'Tencent Finance public daily quotes',
    'Frankfurter / European Central Bank FX time series',
    'Tencent Finance public commodity-proxy ETF quotes',
    'Nasdaq public bond and credit ETF history',
    ...(sectorRotation ? ['Nasdaq public US sector and SPY ETF history'] : []),
    'U.S. Department of the Treasury yield curve',
    'CBOE delayed index/VIX quotes & volatility term structure',
    'Binance kline ADX / ATR / Bollinger Band regime detection',
    'CBOE delayed equity option chains',
    'Deribit public crypto option chains',
    'ForexFactory high-impact macro event calendar',
    'DefiLlama stablecoin supply and net-flow history',
    'CFTC CME futures positioning',
    'alternative.me Fear & Greed',
    'Gate.io public funding rates',
    'Gate.io public USDT futures positioning',
    'Binance public spot taker-flow & book depth',
    'Blockchain.com public on-chain charts',
    'Nasdaq public cross-asset ETF history',
    'Nasdaq public short interest',
    'Nasdaq Public Screener (US market breadth)',
    'Nasdaq public institutional holdings',
    'StockAnalysis public analyst consensus',
    'Tencent Finance public overseas spot quotes',
    'Frankfurter / European Central Bank USD fixings',
  ];

  const technicalAverage = symbolScores.length
    ? symbolScores.reduce((a, b) => a + b, 0) / symbolScores.length
    : 0;
  const sentimentBoost = fearGreed ? (fearGreed.value - 50) * 0.12 : 0;
  const crossAssetBoost = crossAssetRisk ? (crossAssetRisk.riskScore - 50) * 0.45 : 0;
  const sectorBreadthBoost = sectorRotation ? (sectorRotation.breadthPct - 50) * 0.22 : 0;
  const sectorMomentumBoost = sectorRotation
    ? clamp(sectorRotation.averageExcessMomentum * 5, -8, 8)
    : 0;
  const liquidityBoost = stablecoinLiquidity?.regimeBoost ?? 0;
  const cotBoost = cotPositioning?.regimeBoost ?? 0;
  const derivativesBoost = perpetualCrowding?.regimeBoost ?? 0;
  const orderFlowBoost = orderFlowLiquidity?.regimeBoost ?? 0;
  const onchainBoost = bitcoinOnchain?.regimeBoost ?? 0;
  const correlationBoost = crossAssetCorrelation?.regimeBoost ?? 0;
  const shortInterestBoost = shortInterest?.regimeBoost ?? 0;
  const marketBreadthBoost = marketBreadth?.regimeBoost ?? 0;
  const institutionalOwnershipBoost = institutionalOwnership?.regimeBoost ?? 0;
  const analystConsensusBoost = analystConsensus?.regimeBoost ?? 0;
  const macroSpotBoost = globalMacroSpot?.regimeBoost ?? 0;
  const regimeScore = clamp(
    technicalAverage + sentimentBoost + crossAssetBoost + sectorBreadthBoost + sectorMomentumBoost + liquidityBoost + cotBoost + derivativesBoost + orderFlowBoost + onchainBoost + correlationBoost + shortInterestBoost + marketBreadthBoost + institutionalOwnershipBoost + analystConsensusBoost + macroSpotBoost,
    -100,
    100,
  );
  const regimeLabel = regimeScore > 18 ? 'Risk-on' : regimeScore < -18 ? 'Risk-off' : 'Neutral';
  const regimeLabelZh = regimeScore > 18 ? '偏多环境' : regimeScore < -18 ? '偏空环境' : '震荡中性';
  const descriptionZh = regimeScore > 18
    ? '技术与全球风险偏好整体偏强，适合关注回调后的顺势机会，但避免在过热时重仓追高。'
    : regimeScore < -18
      ? '技术面或全球风险偏好偏弱，反弹可能反复；卖出/防守信号应优先于抄底冲动。'
      : '多空与全球风险信号接近平衡，建议降低仓位并等更明确的突破或反转确认。';

  const cautionFlags: AssistantCautionFlag[] = [];
  if (eventRisk?.riskLevel === 'High' || eventRisk?.riskLevel === 'Elevated') {
    cautionFlags.push({
      id: 'macro-event',
      severity: 'high',
      severityZh: '高',
      titleZh: '重要宏观数据临近',
      adviceZh: '事件前降低新仓规模；已持仓单可考虑减仓或设置保护，避免数据公布瞬间被扫损。',
      source: eventRisk.summaryZh,
    });
  } else if (eventRisk?.riskLevel === 'Watch') {
    cautionFlags.push({
      id: 'macro-window',
      severity: 'medium',
      severityZh: '中',
      titleZh: '宏观事件窗口开启',
      adviceZh: '优先等待关键数据落地，再确认突破是否有效。',
      source: eventRisk.summaryZh,
    });
  }

  if (crossAssetRisk?.riskLevel === 'Stress') {
    cautionFlags.push({
      id: 'global-stress',
      severity: 'high',
      severityZh: '高',
      titleZh: '全球风险资产处于高压',
      adviceZh: '防守优先：降低杠杆，避免逆势加仓，等待波动收敛。',
      source: crossAssetRisk.summaryZh,
    });
  } else if (crossAssetRisk?.riskLevel === 'Risk-off' || (crossAssetRisk?.vixChangePct ?? 0) >= 5) {
    cautionFlags.push({
      id: 'risk-off',
      severity: 'medium',
      severityZh: '中',
      titleZh: '避险压力上升',
      adviceZh: '减少追多；若持仓已有利润，可分批落袋并保留观察仓。',
      source: crossAssetRisk?.summaryZh || 'CBOE VIX / 全球指数',
    });
  }

  if ((fundingAvgPct ?? 0) > 0.03) {
    cautionFlags.push({
      id: 'funding-long-crowded',
      severity: 'medium',
      severityZh: '中',
      titleZh: '永续多头偏拥挤',
      adviceZh: '多头成本升高，追高性价比下降；关注回调后低吸或相对强势标的。',
      source: fundingBias,
    });
  } else if ((fundingAvgPct ?? 0) < -0.01) {
    cautionFlags.push({
      id: 'funding-short-pressure',
      severity: 'medium',
      severityZh: '中',
      titleZh: '永续空头压力偏重',
      adviceZh: '空头拥挤时反弹可能更急，不要在恐慌低点直接重仓追空。',
      source: fundingBias,
    });
  }

  if ((fearGreed?.value ?? 50) >= 75) {
    cautionFlags.push({
      id: 'greed',
      severity: 'medium',
      severityZh: '中',
      titleZh: '情绪进入贪婪区',
      adviceZh: '市场容易过度乐观；只做高确认信号，仓位比平时更保守。',
      source: `Alternative.me Fear & Greed：${fearGreed?.value}`,
    });
  } else if ((fearGreed?.value ?? 50) <= 25) {
    cautionFlags.push({
      id: 'fear',
      severity: 'medium',
      severityZh: '中',
      titleZh: '情绪进入恐惧区',
      adviceZh: '恐慌可能带来错杀机会，但先等止跌结构，不要接飞刀。',
      source: `Alternative.me Fear & Greed：${fearGreed?.value}`,
    });
  }

  if (perpetualCrowding) {
    const crowdedAssets = perpetualCrowding.rows.filter(row => row.crowdState !== 'balanced');
    if (crowdedAssets.length) {
      const crowdedLong = crowdedAssets.some(row => row.crowdState === 'long-crowded');
      const crowdedShort = crowdedAssets.some(row => row.crowdState === 'short-crowded');
      const crowdingAdvice = crowdedLong && crowdedShort
        ? '多头拥挤的合约降低追多优先级；空头拥挤的合约警惕急速轧空，分开处理。'
        : crowdedLong
          ? '多头拥挤的合约先降低追多优先级，等回踩确认或改看相对强势标的。'
          : '空头拥挤的合约可能出现急速轧空，不要在情绪低点追加空单。';
      cautionFlags.push({
        id: 'perpetual-crowding',
        severity: 'medium',
        severityZh: '中',
        titleZh: '永续持仓拥挤',
        adviceZh: crowdingAdvice,
        source: `${crowdedAssets.map(row => `${row.symbol} ${row.crowdZh}`).join(' · ')}；${perpetualCrowding.advisorBiasZh}`,
      });
    }
  }

  if (orderFlowLiquidity) {
    if (orderFlowLiquidity.confirmedOutflowCount >= 2
      || (orderFlowLiquidity.averageNetFlowSharePct <= -5 && orderFlowLiquidity.averageBookImbalancePct <= -10)) {
      cautionFlags.push({
        id: 'order-flow-outflow',
        severity: 'medium',
        severityZh: '中',
        titleZh: '主动卖出与卖压确认',
        adviceZh: '短线抛压更实，追多前等止跌；有利润的仓位先保护，不要逆势补仓。',
        source: `${orderFlowLiquidity.summaryZh} · ${orderFlowLiquidity.advisorBiasZh}`,
      });
    } else if (orderFlowLiquidity.conflictingCount >= 3) {
      cautionFlags.push({
        id: 'order-flow-conflict',
        severity: 'medium',
        severityZh: '中',
        titleZh: '主动流与盘口广泛背离',
        adviceZh: '成交方向和挂单结构不一致，容易双向扫损；缩小仓位或等待信号收敛。',
        source: orderFlowLiquidity.summaryZh,
      });
    } else if (orderFlowLiquidity.confirmedInflowCount >= 2) {
      cautionFlags.push({
        id: 'order-flow-inflow',
        severity: 'info',
        severityZh: '观察',
        titleZh: '主流币主动流入确认',
        adviceZh: '买方执行和挂单支持更一致，但仍按技术触发入场，不因为资金流单独追高。',
        source: orderFlowLiquidity.summaryZh,
      });
    }
  }

  if (shortInterest && (shortInterest.crowdedCount >= 2 || shortInterest.squeezeRiskCount >= 2)) {
    const focus = shortInterest.rows.filter(row => row.signal === 'crowded' || row.signal === 'squeeze-risk');
    cautionFlags.push({
      id: 'us-short-crowding',
      severity: 'medium',
      severityZh: '中',
      titleZh: '美股空头拥挤升高',
      adviceZh: '空头拥挤可能带来急速逼空，也可能反映知情看空；不要只凭空头数据追多或做空，等待价格确认并缩小试错仓。',
      source: `${focus.map(row => `${row.symbol} ${row.signalZh}`).join(' · ')}；${shortInterest.advisorBiasZh}`,
    });
  } else if (shortInterest?.coveringCount) {
    cautionFlags.push({
      id: 'us-short-covering',
      severity: 'info',
      severityZh: '观察',
      titleZh: '美股空头回补背景',
      adviceZh: '部分美股空头压力减轻，对顺势多头是背景加分，但仍按技术触发入场。',
      source: shortInterest.summaryZh,
    });
  }

  if (marketBreadth?.signal === 'stress' || marketBreadth?.signal === 'risk-off') {
    cautionFlags.push({
      id: 'us-market-broad-risk-off',
      severity: 'medium',
      severityZh: '中',
      titleZh: '美股广度广泛转弱',
      adviceZh: '下跌家数明显占优时，指数韧性可能掩盖多数股票的抛压；降低新仓规模，防守优先。',
      source: `${marketBreadth.summaryZh} ${marketBreadth.advisorBiasZh}`,
    });
  } else if (marketBreadth?.signal === 'risk-on' || marketBreadth?.signal === 'constructive') {
    cautionFlags.push({
      id: 'us-market-broad-risk-on',
      severity: 'info',
      severityZh: '观察',
      titleZh: '美股上涨参与度扩大',
      adviceZh: '广度背景对顺势多头偏友好，但仍等价格、成交量和单标的信号共同确认。',
      source: `${marketBreadth.summaryZh} ${marketBreadth.advisorBiasZh}`,
    });
  }

  if (institutionalOwnership && institutionalOwnership.distributionCount >= 2) {
    cautionFlags.push({
      id: 'us-institutional-distribution',
      severity: 'medium',
      severityZh: '中',
      titleZh: '机构筹码转弱',
      adviceZh: '多家美股机构持仓呈净减持，反弹更依赖放量确认；新仓规模先保守。',
      source: `${institutionalOwnership.summaryZh} ${institutionalOwnership.advisorBiasZh}`,
    });
  } else if (institutionalOwnership && institutionalOwnership.accumulationCount >= 2) {
    cautionFlags.push({
      id: 'us-institutional-accumulation',
      severity: 'info',
      severityZh: '观察',
      titleZh: '机构筹码净增持',
      adviceZh: '机构增仓对中期顺势多头是背景加分，但仍等价格、成交量和单标的信号共同确认。',
      source: `${institutionalOwnership.summaryZh} ${institutionalOwnership.advisorBiasZh}`,
    });
  }

  if (analystConsensus && analystConsensus.bearishCount >= 2) {
    const focus = analystConsensus.rows.filter(row => row.signal === 'sell' || row.signal === 'strong-sell');
    cautionFlags.push({
      id: 'us-analyst-consensus-bearish',
      severity: 'medium',
      severityZh: '中',
      titleZh: '卖方共识转谨慎',
      adviceZh: '多家美股分析师评级偏空或目标价下调，反弹更依赖盈利与资金流确认；新仓先保守。',
      source: `${focus.map(row => `${row.symbol} ${row.consensus}`).join(' · ')}；${analystConsensus.advisorBiasZh}`,
    });
  } else if (analystConsensus && analystConsensus.bullishCount >= 3) {
    cautionFlags.push({
      id: 'us-analyst-consensus-bullish',
      severity: 'info',
      severityZh: '观察',
      titleZh: '卖方共识偏正面',
      adviceZh: '分析师买入评级占优，对中期顺势多头是背景加分；但共识拥挤时更要等回调确认，不单独追高。',
      source: `${analystConsensus.summaryZh} ${analystConsensus.advisorBiasZh}`,
    });
  }

  if (globalMacroSpot?.signal === 'dollar-strong') {
    cautionFlags.push({
      id: 'macro-dollar-strong',
      severity: 'medium',
      severityZh: '中',
      titleZh: '美元指数短线偏强',
      adviceZh: '美元走强会压制高估值和无现金流资产；追多前等回调确认，必要时降低总仓位。',
      source: `${globalMacroSpot.summaryZh} ${globalMacroSpot.advisorBiasZh}`,
    });
  } else if (globalMacroSpot?.signal === 'energy-shock') {
    cautionFlags.push({
      id: 'macro-energy-shock',
      severity: 'medium',
      severityZh: '中',
      titleZh: '原油出现明显冲击',
      adviceZh: '油价异动会改变通胀与需求预期；先看方向是否连续两日延续，再调整成长股和加密仓位。',
      source: `${globalMacroSpot.summaryZh} ${globalMacroSpot.advisorBiasZh}`,
    });
  } else if (globalMacroSpot?.signal === 'hard-asset-strong') {
    cautionFlags.push({
      id: 'macro-hard-asset-strong',
      severity: 'info',
      severityZh: '观察',
      titleZh: '金银硬资产背景偏强',
      adviceZh: '抗通胀/避险资金活跃对风险资产不是直接买入信号，但顺势机会可优先观察，仍不追高。',
      source: `${globalMacroSpot.summaryZh} ${globalMacroSpot.advisorBiasZh}`,
    });
  }

  if (stablecoinLiquidity?.signal === 'contraction') {
    cautionFlags.push({
      id: 'stablecoin-contraction',
      severity: 'medium',
      severityZh: '中',
      titleZh: '稳定币流动性收缩',
      adviceZh: '场内可用弹药减少，反弹持续性要打折；降低预期和仓位。',
      source: stablecoinLiquidity.advisorBiasZh,
    });
  }

  if (bitcoinOnchain?.signal === 'cooling') {
    cautionFlags.push({
      id: 'bitcoin-onchain-cooling',
      severity: 'medium',
      severityZh: '中',
      titleZh: '比特币链上参与度转弱',
      adviceZh: '链上真实需求落后，追多前先等价格结构和成交量确认。',
      source: bitcoinOnchain.summaryZh,
    });
  } else if (bitcoinOnchain?.signal === 'healthy') {
    cautionFlags.push({
      id: 'bitcoin-onchain-healthy',
      severity: 'info',
      severityZh: '观察',
      titleZh: '比特币链上背景偏健康',
      adviceZh: '链上使用和安全背景不拖累多头，但仍按技术触发和仓位规则执行。',
      source: bitcoinOnchain.summaryZh,
    });
  }

  if (crossAssetCorrelation?.signal === 'concentrated' || (crossAssetCorrelation?.deepDrawdownCount ?? 0) >= 2) {
    cautionFlags.push({
      id: 'cross-asset-concentration',
      severity: 'medium',
      severityZh: '中',
      titleZh: '跨资产同向承压',
      adviceZh: '多个市场开始一起下跌或波动放大，先降总风险，再谈选哪个标的。',
      source: crossAssetCorrelation?.summaryZh || '跨资产相关性与回撤数据',
    });
  } else if ((crossAssetCorrelation?.averageCryptoEquityCorrelation ?? 0) >= 0.55) {
    cautionFlags.push({
      id: 'crypto-equity-correlation',
      severity: 'medium',
      severityZh: '中',
      titleZh: '加密与美股联动升高',
      adviceZh: '此时加密更像风险资产；不要把它当作股票回调里的天然避风港。',
      source: crossAssetCorrelation?.summaryZh || '跨资产相关性与回撤数据',
    });
  } else if (crossAssetCorrelation?.signal === 'diversified') {
    cautionFlags.push({
      id: 'cross-asset-diversified',
      severity: 'info',
      severityZh: '观察',
      titleZh: '跨资产分散背景较好',
      adviceZh: '互补资产仍在工作，可按信号执行，但不要因此放松单笔止损。',
      source: crossAssetCorrelation.summaryZh,
    });
  }

  const crowdedCot = cotPositioning?.assets.filter(item => item.crowding !== 'balanced') || [];
  if (crowdedCot.length === 1) {
    const asset = crowdedCot[0];
    cautionFlags.push({
      id: `cot-${asset.symbol.toLowerCase()}-${asset.crowding}`,
      severity: 'medium',
      severityZh: '中',
      titleZh: `${asset.nameZh}机构持仓拥挤`,
      adviceZh: asset.adviceZh,
      source: `${asset.signalZh} · 净持仓占未平仓 ${asset.netPctOfOpenInterest}% · ${asset.reportDate}`,
    });
  } else if (crowdedCot.length > 1) {
    cautionFlags.push({
      id: 'cot-divergence',
      severity: 'info',
      severityZh: '观察',
      titleZh: 'BTC 与 ETH 机构持仓分歧',
      adviceZh: '两者拥挤方向不一致，说明加密内部强弱分化；分开判断，不要用单一币种信号带全场。',
      source: cotPositioning?.summaryZh || 'CFTC CME futures positioning',
    });
  }

  if (marketRegime?.label === 'volatile-expansion') {
    cautionFlags.push({
      id: 'volatile-expansion',
      severity: 'high',
      severityZh: '高',
      titleZh: '波动率正在扩张',
      adviceZh: '止损距离要放大或仓位缩小；避免在震荡区间内频繁进出。',
      source: marketRegime.summaryZh,
    });
  } else if (marketRegime?.volumeTrend === 'falling' && marketRegime.label.includes('trend-up')) {
    cautionFlags.push({
      id: 'volume-divergence',
      severity: 'info',
      severityZh: '观察',
      titleZh: '上涨但量能萎缩',
      adviceZh: '趋势还在，但动能不足；突破失败时更快离场。',
      source: marketRegime.summaryZh,
    });
  }

  if (warnings.length) {
    cautionFlags.push({
      id: 'missing-data',
      severity: 'info',
      severityZh: '观察',
      titleZh: '部分风险数据暂缺',
      adviceZh: '当前判断置信度下降，建议等数据恢复或用更小的试探仓。',
      source: warnings.join('；'),
    });
  }

  const severityRank = { high: 0, medium: 1, info: 2 } as const;
  cautionFlags.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const visibleCautionFlags = cautionFlags.slice(0, 6);
  const highCount = visibleCautionFlags.filter(flag => flag.severity === 'high').length;
  const mediumCount = visibleCautionFlags.filter(flag => flag.severity === 'medium').length;
  const cautionSummaryZh = visibleCautionFlags.length
    ? `当前有 ${highCount} 条高优先级、${mediumCount} 条中等优先级提醒，建议先看红色/黄色卡片。`
    : '主要风险数据正常，可按既定规则观察机会。';

  const result: AssistantContext = {
    regime: { label: regimeLabel, labelZh: regimeLabelZh, score: round(regimeScore, 1), descriptionZh },
    fearGreed,
    fundingBias,
    fundingAvgPct,
    crossAssetRisk,
    crossAssetCorrelation,
    marketRegime,
    eventRisk,
    stablecoinLiquidity,
    cotPositioning,
    perpetualCrowding,
    orderFlowLiquidity,
    shortInterest,
    marketBreadth,
    institutionalOwnership,
    analystConsensus,
    globalMacroSpot,
    bitcoinOnchain,
    liquidityBias: stablecoinLiquidity?.advisorBiasZh || '稳定币流动性数据暂不可用',
    cotBias: cotPositioning?.advisorBiasZh || 'CFTC 持仓数据暂不可用',
    derivativesBias: perpetualCrowding?.advisorBiasZh || '永续持仓拥挤数据暂不可用',
    cautionFlags: visibleCautionFlags,
    cautionSummaryZh,
    sources,
    warnings,
  };
  return result;
}

function confidenceBucket(confidencePct: number): string {
  if (confidencePct >= 70) return '70%+';
  if (confidencePct >= 65) return '65-69%';
  return '57-64%';
}

function findGroup(
  groups: AssistantGroupStats[] | undefined,
  name: string,
  minimum = 5,
): AssistantGroupStats | null {
  const group = groups?.find(item => item.name === name);
  return group && group.closed >= minimum ? group : null;
}

function conservativeWinRate(wins: number, total: number): number {
  if (total <= 0) return 0;
  const z = 1.64;
  const p = wins / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt(
    p * (1 - p) / total + z * z / (4 * total * total),
  ) / denominator;
  return Math.max(0, center - margin) * 100;
}

function calibrateWithJournal(report: AssistantReport): AssistantCalibration {
  const journal = report.journal;
  if (!journal || journal.closed < 8) {
    return {
      enabled: false,
      closed: journal?.closed || 0,
      adjustedCount: 0,
      noteZh: `模拟样本仍在积累（${journal?.closed || 0}/8），助手暂不根据历史战绩调整新信号。`,
    };
  }

  const allActions: AssistantAction[] = [
    ...report.reminders,
    ...report.cryptoActions,
    ...report.stockActions,
    ...report.macroActions,
    ...report.sectorActions,
    ...report.predictionPicks,
    ...report.optionActions,
  ];
  // The same action object can appear in both its category list and the
  // prioritized reminder list; calibration must run once per signal.
  const uniqueActions = [...new Set(allActions)];
  let adjustedCount = 0;

  for (const action of uniqueActions) {
    const venueGroup = findGroup(journal.byVenue, action.venue);
    const confidenceGroup = findGroup(journal.byConfidence, confidenceBucket(action.confidencePct));
    const strategyGroup = action.optionStrategy
      ? findGroup(journal.byStrategy, action.optionStrategy.nameZh)
      : null;
    const evidence = [venueGroup, confidenceGroup, strategyGroup].filter(
      (group): group is AssistantGroupStats => Boolean(group),
    );
    if (!evidence.length) {
      action.historicalWinRatePct = round(
        conservativeWinRate(journal.wins, journal.closed),
        1,
      );
      continue;
    }

    const sampleWeightSum = evidence.reduce((sum, group) => sum + Math.min(20, group.closed), 0);
    const historicalWinRate = evidence.reduce(
      (sum, group) => sum + group.conservativeWinRatePct * Math.min(20, group.closed),
      0,
    ) / sampleWeightSum;
    const historicalAvgR = evidence.reduce(
      (sum, group) => sum + (group.totalR / group.closed) * Math.min(20, group.closed),
      0,
    ) / sampleWeightSum;

    // Keep the adjustment deliberately small: paper history is context, not a
    // promise. Venue/confidence/strategy evidence can move confidence by at
    // most six points and risk down by at most 40%.
    const winRateDelta = (historicalWinRate - 50) / 10;
    const expectancyDelta = clamp(historicalAvgR * 4, -4, 4);
    const scoreDelta = clamp(winRateDelta * 0.7 + expectancyDelta * 0.3, -6, 6);
    const originalConfidence = action.confidencePct;
    const calibratedConfidence = clamp(originalConfidence + scoreDelta, 35, 90);
    const riskMultiplier = scoreDelta <= -3 ? 0.6 : scoreDelta <= -1 ? 0.8 : 1;

    action.confidencePct = round(calibratedConfidence, 1);
    action.suggestedRiskPct = round(action.suggestedRiskPct * riskMultiplier, 2);
    action.historicalWinRatePct = round(historicalWinRate, 1);
    action.metrics['模拟校准'] = `${round(originalConfidence, 1)}% → ${action.confidencePct}%`;
    action.metrics['保守历史胜率'] = `${action.historicalWinRatePct}%`;
    action.reasons.push(
      `模拟账本校准：${evidence.map(group => `${group.name} ${group.closed}笔/${group.winRatePct}%`).join('，')}；近期期望 ${historicalAvgR >= 0 ? '+' : ''}${round(historicalAvgR, 2)}R。`,
    );
    adjustedCount += 1;
  }

  report.reminders.sort((a, b) => b.confidencePct - a.confidencePct);
  return {
    enabled: true,
    closed: journal.closed,
    adjustedCount,
    noteZh: `已用 ${journal.closed} 笔模拟结算校准新信号：历史表现好的组合小幅加分，表现差的组合降低信心和单笔风险。`,
  };
}

function signalDirection(action: AssistantAction): 'LONG' | 'SHORT' | null {
  if (action.direction === 'UP' || action.direction === 'LONG') return 'LONG';
  if (action.direction === 'DOWN' || action.direction === 'SHORT') return 'SHORT';
  if (action.action === 'BUY') return 'LONG';
  if (action.action === 'SELL') return 'SHORT';
  return null;
}

function buildStrategyTilt(
  regime: AssistantReport['regime'],
  journal: AssistantJournalSummary,
): AssistantStrategyTilt {
  const baseLong = regime.label === 'Risk-on' ? 3 : regime.label === 'Risk-off' ? -2 : 0;
  const baseShort = regime.label === 'Risk-off' ? 4 : regime.label === 'Risk-on' ? -3 : 0;
  let longPriority = baseLong;
  let shortPriority = baseShort;
  let evidenceGroups = 0;
  const evidenceTexts: string[] = [];

  for (const group of journal.byRegimeDirection || []) {
    const [groupRegime, direction] = group.name.split(':');
    if (groupRegime !== regime.label || (direction !== 'LONG' && direction !== 'SHORT')) continue;

    // Require the same conservative-evidence threshold used elsewhere. A few
    // lucky paper trades must not reshape the whole reminder queue.
    if (group.closed < 5) continue;
    const avgR = group.totalR / group.closed;
    const winRateEdge = clamp((group.conservativeWinRatePct - 50) / 8, -5, 5);
    const expectancyEdge = clamp(avgR * 1.5, -3, 3);
    const evidenceBoost = clamp(winRateEdge * 0.7 + expectancyEdge * 0.3, -6, 6);
    if (direction === 'LONG') longPriority = clamp(baseLong + evidenceBoost, -8, 8);
    else shortPriority = clamp(baseShort + evidenceBoost, -8, 8);
    evidenceGroups += 1;
    evidenceTexts.push(
      `${direction === 'LONG' ? '做多/上涨' : '做空/下跌'} ${group.closed}笔，保守胜率 ${group.conservativeWinRatePct}%`,
    );
  }

  longPriority = round(longPriority, 1);
  shortPriority = round(shortPriority, 1);
  const priorityGap = round(Math.abs(longPriority - shortPriority), 1);
  const sampleCount = (journal.byRegimeDirection || [])
    .filter(group => group.name.startsWith(`${regime.label}:`))
    .reduce((sum, group) => sum + group.closed, 0);
  const preferred = Math.max(longPriority, shortPriority);
  const avoided = Math.min(longPriority, shortPriority);
  const enabled = sampleCount >= 5 && Math.abs(preferred - avoided) >= 2;
  const preferredDirectionZh = !enabled
    ? '暂不启用方向倾斜'
    : longPriority >= shortPriority ? '顺势/看涨优先' : '防守/看跌优先';

  const noteZh = sampleCount < 5
    ? `当前环境样本还在积累（${sampleCount}/5），只使用基础风险偏好排序。`
    : !enabled
      ? `当前环境已积累 ${sampleCount} 笔，但看涨/防守优先级差距仅 ${priorityGap}（需 ≥2），暂不改变排序。`
      : `${regime.labelZh}下，${preferredDirectionZh}；${evidenceTexts.join('；')}。该权重只调整提醒顺序，不放大信心或仓位。`;

  return {
    regime: regime.label,
    regimeZh: regime.labelZh,
    enabled,
    sampleCount,
    longPriority,
    shortPriority,
    priorityGap,
    preferredDirectionZh,
    noteZh,
  };
}

function applyStrategyTilt(report: AssistantReport): void {
  const tilt = buildStrategyTilt(report.regime, report.journal!);
  report.strategyTilt = tilt;
  if (!tilt.enabled) return;

  const allActions: AssistantAction[] = [
    ...report.reminders,
    ...report.cryptoActions,
    ...report.stockActions,
    ...report.macroActions,
    ...report.sectorActions,
    ...report.predictionPicks,
    ...report.optionActions,
  ];
  const uniqueActions = [...new Set(allActions)];
  for (const action of uniqueActions) {
    const direction = signalDirection(action);
    if (!direction) continue;
    const priority = direction === 'LONG' ? tilt.longPriority : tilt.shortPriority;
    if (Math.abs(priority) < 0.5) continue;
    action.metrics['环境排序'] = `${priority > 0 ? '+' : ''}${priority}`;
    action.reasons.push(`环境联动：${tilt.regimeZh}下${direction === 'LONG' ? '看涨' : '防守'}经验优先级 ${priority > 0 ? '+' : ''}${priority}。`);
  }

  const effectiveScore = (action: AssistantAction): number => {
    const direction = signalDirection(action);
    const priority = direction === 'LONG'
      ? tilt.longPriority
      : direction === 'SHORT' ? tilt.shortPriority : 0;
    return action.confidencePct + priority;
  };
  report.reminders.sort((a, b) => effectiveScore(b) - effectiveScore(a));
}

/**
 * Volatility term structure is a risk filter, not a reason to oversize.
 * Keep the adjustment small and explain it on every option signal.
 */
function applyVolatilityTermToOptions(report: AssistantReport): void {
  const term = report.context.crossAssetRisk?.volatilityTerm;
  if (!term) return;

  const adjustmentFor = (kind: OptionStrategySpec['kind']): number => {
    if (term.shape === 'backwardation') {
      if (kind === 'protective-put') return 3;
      if (kind === 'bear-call-spread') return 1;
      if (kind === 'bull-put-spread') return -2;
      if (kind === 'iron-condor') return -1;
    }
    if (term.shape === 'contango') {
      if (kind === 'iron-condor') return 2;
      if (kind === 'bull-put-spread') return 1;
      if (kind === 'bear-call-spread') return 1;
      if (kind === 'protective-put') return -1;
    }
    return 0;
  };

  for (const action of report.optionActions) {
    const kind = action.optionStrategy?.kind;
    if (!kind) continue;
    const adjustment = adjustmentFor(kind);
    action.metrics['波动期限'] = term.shapeZh;
    if (adjustment !== 0) {
      action.confidencePct = clamp(action.confidencePct + adjustment, 30, 95);
      action.metrics['期限微调'] = `${adjustment > 0 ? '+' : ''}${adjustment}`;
      action.reasons.push(`波动率期限结构：${term.shapeZh}，${kind} 信心微调 ${adjustment > 0 ? '+' : ''}${adjustment} 分。`);
    }
  }

  report.optionActions.sort((a, b) => b.confidencePct - a.confidencePct);
}

/**
 * Market regime adjusts strategy confidence based on current conditions.
 * Trending markets favor directional strategies; ranging favors premium-selling;
 * squeeze favors breakout-prepared strategies; volatile-expansion reduces all.
 */
function applyRegimeToOptions(report: AssistantReport): void {
  const regime = report.context.marketRegime;
  if (!regime) return;

  const adjustmentFor = (kind: OptionStrategySpec['kind']): number => {
    switch (regime.label) {
      case 'strong-trend-up':
        return kind === 'bull-put-spread' ? 1 : kind === 'bear-call-spread' ? -1 : 0;
      case 'strong-trend-down':
        return kind === 'bear-call-spread' ? 2 : kind === 'bull-put-spread' ? -1 : 0;
      case 'weak-trend-up':
        return kind === 'bull-put-spread' ? 1 : kind === 'bear-call-spread' ? -1 : 0;
      case 'weak-trend-down':
        return kind === 'bear-call-spread' ? 1 : kind === 'bull-put-spread' ? -1 : 0;
      case 'ranging':
        return kind === 'iron-condor' ? 3 : kind === 'bull-put-spread' || kind === 'bear-call-spread' ? -1 : 0;
      case 'volatile-expansion':
        return -2;
      case 'squeeze':
        return kind === 'iron-condor' ? -1 : 0;
      default:
        return 0;
    }
  };

  for (const action of report.optionActions) {
    const kind = action.optionStrategy?.kind;
    if (!kind) continue;
    const adjustment = adjustmentFor(kind);
    action.metrics['市场状态'] = regime.labelZh;
    if (adjustment !== 0) {
      action.confidencePct = clamp(action.confidencePct + adjustment, 30, 95);
      action.metrics['状态微调'] = `${adjustment > 0 ? '+' : ''}${adjustment}`;
      action.reasons.push(`市场状态：${regime.labelZh}，${kind} 信心微调 ${adjustment > 0 ? '+' : ''}${adjustment} 分。`);
    }
  }

  report.optionActions.sort((a, b) => b.confidencePct - a.confidencePct);
}

/**
 * A scheduled macro release is a timing hazard, not a market direction.
 * Keep the penalty bounded so a weekly calendar cannot suppress every signal.
 */
function applyEventRiskGuard(report: AssistantReport): void {
  const eventRisk = report.context.eventRisk;
  if (!eventRisk || eventRisk.globalConfidenceAdjustment >= 0) return;

  const allActions: AssistantAction[] = [
    ...report.reminders,
    ...report.cryptoActions,
    ...report.stockActions,
    ...report.macroActions,
    ...report.sectorActions,
    ...report.predictionPicks,
    ...report.optionActions,
  ];
  const uniqueActions = [...new Set(allActions)].filter(action => action.action !== 'WAIT');
  const nearestGlobal = eventRisk.events
    .filter(event => event.relevance === 'global' && event.hoursUntil >= 0)
    .sort((a, b) => a.hoursUntil - b.hoursUntil)[0];
  if (!nearestGlobal) return;

  const hoursText = nearestGlobal.hoursUntil < 1
    ? `${Math.max(1, Math.round(nearestGlobal.hoursUntil * 60))} 分钟`
    : `${Math.round(nearestGlobal.hoursUntil)} 小时`;
  for (const action of uniqueActions) {
    const originalConfidence = action.confidencePct;
    const originalRisk = action.suggestedRiskPct;
    action.confidencePct = clamp(action.confidencePct + eventRisk.globalConfidenceAdjustment, 30, 95);
    action.suggestedRiskPct = Math.max(0.05, round(originalRisk * eventRisk.globalRiskMultiplier, 2));
    action.metrics['事件风险'] = `${eventRisk.riskLevelZh} · ${hoursText}后`;
    action.metrics['事件微调'] = `${eventRisk.globalConfidenceAdjustment}`;
    action.reasons.push(
      `宏观事件护栏：${nearestGlobal.country} ${nearestGlobal.title} 约 ${hoursText}后发布；信心 ${round(originalConfidence, 1)}% → ${action.confidencePct}%，单笔风险 ×${eventRisk.globalRiskMultiplier}。`,
    );
  }
}

export async function generateAssistantReport(): Promise<AssistantReport> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const [predictionResult, cryptoResult, stockResult, optionResult, macroResult, sectorResult] = await Promise.allSettled([
    analyzePredictionMarkets(),
    analyzeCryptoTechnicals(),
    analyzeStockTechnicals(),
    analyzeOptionStrategies(),
    analyzeMacroTechnicals(),
    analyzeSectorRotation(),
  ]);

  const cryptoActions = cryptoResult.status === 'fulfilled' ? cryptoResult.value : [];
  const predictionPicks = predictionResult.status === 'fulfilled' ? predictionResult.value : [];
  const stockActions = stockResult.status === 'fulfilled' ? stockResult.value : [];
  const optionActions = optionResult.status === 'fulfilled' ? optionResult.value : [];
  const macroActions = macroResult.status === 'fulfilled' ? macroResult.value : [];
  const sectorAnalysis = sectorResult.status === 'fulfilled' ? sectorResult.value : null;
  const sectorActions = sectorAnalysis?.actions || [];

  // Convert signed technical strength into the regime score.
  const symbolScores = cryptoActions.map(action => {
    const strength = (action.confidencePct - 50) / 0.48;
    return action.action === 'SELL' ? -Math.abs(strength) : Math.abs(strength);
  });

  const context = await buildContext(symbolScores, sectorAnalysis?.snapshot);
  const warnings = [...context.warnings];
  if (predictionResult.status === 'rejected') warnings.push('预测市场助手暂时不可用');
  if (cryptoResult.status === 'rejected') warnings.push('币安技术助手暂时不可用');
  if (stockResult.status === 'rejected') warnings.push('股票技术助手暂时不可用');
  if (optionResult?.status === 'rejected') warnings.push('期权策略助手暂时不可用');
  if (macroResult.status === 'rejected') warnings.push('外汇/商品/债券技术助手暂时不可用');
  if (sectorResult.status === 'rejected') warnings.push('行业轮动雷达暂时不可用');

  // Apply before reminders are selected so option ordering uses the same view.
  const preReport: AssistantReport = {
    generatedAt: new Date().toISOString(),
    regime: context.regime,
    reminders: [],
    cryptoActions,
    stockActions: stockActions.slice(0, 8),
    macroActions: macroActions.slice(0, 16),
    sectorActions,
    sectorRotation: sectorAnalysis?.snapshot,
    predictionPicks: predictionPicks.slice(0, 8),
    optionActions,
    context: { ...context, warnings },
  };
  applyVolatilityTermToOptions(preReport);
  applyRegimeToOptions(preReport);
  applyEventRiskGuard(preReport);

  const reminders = [
    ...cryptoActions,
    ...stockActions,
    ...macroActions.filter(item => item.action !== 'WAIT'),
    ...sectorActions.filter(item => item.action !== 'WAIT'),
    ...predictionPicks,
    ...optionActions,
  ]
    .filter(item => item.action !== 'WAIT')
    .sort((a, b) => b.confidencePct - a.confidencePct)
    .slice(0, 8);

  preReport.reminders = reminders;
  const report = preReport;
  report.journal = await syncAssistantJournal(report);
  report.calibration = calibrateWithJournal(report);
  applyStrategyTilt(report);
  void notifyHighSuccessResults(report);
  cache = { ts: Date.now(), value: report };
  return report;
}
