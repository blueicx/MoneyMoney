/**
 * Assistant Paper Journal
 * Records the advisor's own actionable signals, resolves them at expiry and
 * turns the results into transparent performance lessons. This never trades.
 */

import fs from 'fs';
import path from 'path';
import { api } from '../api';
import { binanceFeed } from './binance';
import { getMacroCurrentPrices } from './macro-market';
import { getSectorCurrentPrices } from './sector-rotation';
import { pushNotification } from './notifications';
import { telegram } from './telegram';
import { DATA_ROOT, ensureDir } from '../utils/paths';

export type AssistantDirection = 'UP' | 'DOWN' | 'LONG' | 'SHORT';

export interface AssistantOptionStrategy {
  kind: 'iron-condor' | 'bull-put-spread' | 'bear-call-spread' | 'protective-put';
  nameZh: string;
  netPremium: number;
  shortPut?: number;
  longPut?: number;
  shortCall?: number;
  longCall?: number;
}

export interface AssistantPaperTrade {
  id: string;
  signalId: string;
  signalKey: string;
  venue: 'Binance' | 'Predict.fun' | 'Stocks' | 'Options' | 'Macro';
  symbol: string;
  title: string;
  direction: AssistantDirection;
  actionZh: string;
  confidencePct: number;
  probabilityPct?: number;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  optionStrategy?: AssistantOptionStrategy;
  marketId?: number;
  categoryId?: number;
  slug?: string;
  regimeLabel: string;
  openedAt: string;
  expiresAt?: string;
  closedAt?: string;
  status: 'OPEN' | 'CLOSED';
  exitPrice?: number;
  result: 'WIN' | 'LOSS' | 'FLAT' | 'PENDING';
  pnlPct?: number;
  rMultiple?: number;
  closeReason: string;
  noteZh?: string;
  tags?: string[];
}

export interface AssistantGroupStats {
  name: string;
  closed: number;
  wins: number;
  winRatePct: number;
  conservativeWinRatePct: number;
  totalR: number;
}

export interface AssistantExperienceEntry {
  key: string;
  dimension: '市场' | '策略' | '信心' | '环境';
  name: string;
  closed: number;
  wins: number;
  winRatePct: number;
  conservativeWinRatePct: number;
  avgR: number;
  totalR: number;
  verdict: 'strong' | 'watch' | 'weak';
  recommendationZh: string;
}

export interface AssistantExitCoach {
  currentPrice: number | null;
  unrealizedPct: number | null;
  riskStateZh: '危险' | '止盈区' | '保护利润' | '持仓观察' | '等待结算' | '数据不足';
  adviceZh: string;
}

export interface AssistantOpenTrade extends AssistantPaperTrade {
  exitCoach?: AssistantExitCoach;
}

export interface AssistantRiskAlert {
  id: string;
  tradeId: string;
  venue: AssistantPaperTrade['venue'];
  symbol: string;
  title: string;
  direction: AssistantDirection;
  confidencePct: number;
  riskStateZh: AssistantExitCoach['riskStateZh'];
  severity: 'danger' | 'profit' | 'watch';
  currentPrice: number | null;
  unrealizedPct: number | null;
  minutesToExpiry: number | null;
  adviceZh: string;
}

export interface AssistantRiskPatrolResult {
  updatedAt: string;
  openPositions: number;
  dangerCount: number;
  profitCount: number;
  watchCount: number;
  alerts: AssistantRiskAlert[];
}

export interface AssistantJournalSummary {
  updatedAt: string;
  total: number;
  open: number;
  closed: number;
  wins: number;
  losses: number;
  flat: number;
  winRatePct: number;
  totalR: number;
  avgR: number;
  profitFactor: number;
  byVenue: AssistantGroupStats[];
  byConfidence: AssistantGroupStats[];
  byStrategy: AssistantGroupStats[];
  byRegimeDirection: AssistantGroupStats[];
  experienceRanking: AssistantExperienceEntry[];
  lessons: string[];
  recentClosed: AssistantPaperTrade[];
  openTrades: AssistantOpenTrade[];
}

export interface CalibrationBucket {
  label: string;
  count: number;
  avgForecastPct: number;
  hitRatePct: number;
  brierScore: number;
}

export interface AssistantCalibrationStats {
  updatedAt: string;
  closed: number;
  evaluated: number;
  brierScore: number;
  logLoss: number;
  buckets: CalibrationBucket[];
  noteZh: string;
}

interface JournalFile {
  version: 1;
  trades: AssistantPaperTrade[];
}

const JOURNAL_FILE = path.join(DATA_ROOT, 'assistant-journal.json');
const SIMULATION_STAKE_USD = 100;
const MAX_TRADES = 500;

function load(): JournalFile {
  ensureDir(DATA_ROOT);
  if (fs.existsSync(JOURNAL_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8')) as JournalFile;
      if (Array.isArray(parsed.trades)) return { version: 1, trades: parsed.trades };
    } catch {
    }
  }
  return { version: 1, trades: [] };
}

function save(state: JournalFile): void {
  ensureDir(DATA_ROOT);
  fs.writeFileSync(JOURNAL_FILE, JSON.stringify(state, null, 2));
}

export function getAssistantCalibration(): AssistantCalibrationStats {
  const state = load();
  const rows = state.trades
    .filter(trade => trade.status === 'CLOSED')
    .filter(trade => (trade.probabilityPct ?? trade.confidencePct) != null)
    .map(trade => ({
      forecast: Math.min(99, Math.max(1, trade.probabilityPct ?? trade.confidencePct)) / 100,
      outcome: trade.result === 'WIN' ? 1 : trade.result === 'LOSS' ? 0 : null,
    }))
    .filter(row => row.outcome != null) as Array<{ forecast: number; outcome: number }>;

  const brier = rows.length
    ? rows.reduce((sum, row) => sum + (row.forecast - row.outcome) ** 2, 0) / rows.length
    : 0;
  const logLoss = rows.length
    ? -rows.reduce((sum, row) => sum + (
        row.outcome === 1 ? Math.log(row.forecast) : Math.log(1 - row.forecast)
      ), 0) / rows.length
    : 0;

  const ranges = [
    ['0-20%', 0, 20],
    ['21-40%', 21, 40],
    ['41-60%', 41, 60],
    ['61-80%', 61, 80],
    ['81-100%', 81, 100],
  ] as const;
  const buckets = ranges.map(([label, low, high]) => {
    const group = rows.filter(row => {
      const pct = row.forecast * 100;
      return pct >= low && pct <= high;
    });
    return {
      label,
      count: group.length,
      avgForecastPct: group.length ? Math.round(group.reduce((s, r) => s + r.forecast * 100, 0) / group.length * 10) / 10 : 0,
      hitRatePct: group.length ? Math.round(group.reduce((s, r) => s + r.outcome, 0) / group.length * 1000) / 10 : 0,
      brierScore: group.length ? Math.round(group.reduce((s, r) => s + (r.forecast - r.outcome) ** 2, 0) / group.length * 10000) / 10000 : 0,
    };
  });

  const quality = rows.length < 20 ? '样本不足，先当学习记录看' : brier <= 0.18 ? '判断质量很好' : brier <= 0.25 ? '判断质量可用' : '概率判断仍偏粗糙';
  return {
    updatedAt: new Date().toISOString(),
    closed: state.trades.filter(item => item.status === 'CLOSED').length,
    evaluated: rows.length,
    brierScore: Math.round(brier * 10000) / 10000,
    logLoss: Math.round(logLoss * 10000) / 10000,
    buckets,
    noteZh: `${quality}。Brier 分数越接近 0 越准；当前已评估 ${rows.length} 条可核对概率信号。`,
  };
}

export function getAssistantJournalTrades(): AssistantPaperTrade[] {
  return load().trades;
}

export interface DailyLossBreaker {
  triggered: boolean;
  realizedR: number;
  closedToday: number;
  messageZh: string | null;
}

const DAILY_LOSS_R_LIMIT = -2;

export function getDailyLossBreaker(): DailyLossBreaker {
  const state = load();
  const today = new Date().toISOString().slice(0, 10);
  const todayClosed = state.trades.filter(t =>
    t.status === 'CLOSED'
    && t.closedAt
    && t.closedAt.slice(0, 10) === today
    && typeof t.rMultiple === 'number',
  );
  const realizedR = round(todayClosed.reduce((sum, t) => sum + (t.rMultiple || 0), 0), 2);
  const triggered = realizedR <= DAILY_LOSS_R_LIMIT;
  return {
    triggered,
    realizedR,
    closedToday: todayClosed.length,
    messageZh: triggered
      ? `日亏熔断已触发：今日已结算 ${todayClosed.length} 笔，累计 ${realizedR.toFixed(1)}R ≤ ${DAILY_LOSS_R_LIMIT}R。新信号信心将降至 40% 以下，建议暂停开新仓。`
      : null,
  };
}

export function saveTradeNote(id: string, noteZh: string, tags: string[]): boolean {
  const state = load();
  const trade = state.trades.find(t => t.id === id);
  if (!trade) return false;
  trade.noteZh = noteZh.trim() || undefined;
  trade.tags = tags.map(t => t.trim()).filter(Boolean);
  save(state);
  return true;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wilsonLowerBound(wins: number, total: number): number {
  if (total <= 0) return 0;
  const z = 1.64; // One-sided 90% lower bound.
  const p = wins / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt(
    p * (1 - p) / total + z * z / (4 * total * total),
  ) / denominator;
  return Math.max(0, center - margin);
}

function groupStats(
  trades: AssistantPaperTrade[],
  name: (trade: AssistantPaperTrade) => string,
): AssistantGroupStats[] {
  const groups = new Map<string, AssistantPaperTrade[]>();
  for (const trade of trades.filter(item => item.status === 'CLOSED')) {
    const key = name(trade);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(trade);
  }

  return [...groups.entries()].map(([groupName, rows]) => {
    const wins = rows.filter(row => row.result === 'WIN').length;
    const totalR = rows.reduce((sum, row) => sum + (row.rMultiple || 0), 0);
    return {
      name: groupName,
      closed: rows.length,
      wins,
      winRatePct: round(wins / rows.length * 100, 1),
      conservativeWinRatePct: round(wilsonLowerBound(wins, rows.length) * 100, 1),
      totalR: round(totalR, 2),
    };
  }).sort((a, b) => b.closed - a.closed);
}

function buildExperienceRanking(
  venueGroups: AssistantGroupStats[],
  strategyGroups: AssistantGroupStats[],
  confidenceGroups: AssistantGroupStats[],
  regimeGroups: AssistantGroupStats[] = [],
): AssistantExperienceEntry[] {
  const entries: AssistantExperienceEntry[] = [];
  const push = (
    dimension: AssistantExperienceEntry['dimension'],
    groups: AssistantGroupStats[],
  ): void => {
    for (const group of groups.filter(item => item.closed >= 5)) {
      const avgR = group.totalR / group.closed;
      const verdict: AssistantExperienceEntry['verdict'] = group.conservativeWinRatePct >= 60 && avgR >= 0
        ? 'strong'
        : group.conservativeWinRatePct < 42 || avgR < -0.15
          ? 'weak'
          : 'watch';
      entries.push({
        key: `${dimension}:${group.name}`,
        dimension,
        name: group.name,
        closed: group.closed,
        wins: group.wins,
        winRatePct: group.winRatePct,
        conservativeWinRatePct: group.conservativeWinRatePct,
        avgR: round(avgR, 3),
        totalR: group.totalR,
        verdict,
        recommendationZh: verdict === 'strong'
          ? '优先观察；仍按信号止损与单笔风险执行'
          : verdict === 'weak'
            ? '降低优先级，等待更多确认或跳过边缘信号'
            : '继续跟踪，不作为加仓依据',
      });
    }
  };

  push('市场', venueGroups);
  push('策略', strategyGroups);
  push('信心', confidenceGroups);
  push('环境', regimeGroups);
  return entries.sort((a, b) =>
    b.conservativeWinRatePct - a.conservativeWinRatePct
    || b.avgR - a.avgR
    || b.closed - a.closed,
  );
}

function buildLessons(state: JournalFile): string[] {
  const closed = state.trades.filter(trade => trade.status === 'CLOSED');
  const lessons: string[] = [];
  if (closed.length < 5) {
    lessons.push(`样本仍在积累（已结算 ${closed.length}/5），当前战绩只用于观察，不适合评估策略优劣。`);
    return lessons;
  }

  const wins = closed.filter(trade => trade.result === 'WIN').length;
  const winRate = wins / closed.length * 100;
  const totalR = closed.reduce((sum, trade) => sum + (trade.rMultiple || 0), 0);
  lessons.push(`${winRate >= 55 ? '当前规则在近期样本中偏稳' : winRate >= 45 ? '近期胜率接近抛硬币，需依赖风险控制' : '近期样本表现偏弱，应降低跟单冲动'}：胜率 ${round(winRate, 1)}%，累计 ${totalR >= 0 ? '+' : ''}${round(totalR, 2)}R。`);

  const confidenceGroups = groupStats(state.trades, trade => {
    if (trade.confidencePct >= 70) return '70%+';
    if (trade.confidencePct >= 65) return '65-69%';
    return '57-64%';
  }).filter(group => group.closed >= 3);
  if (confidenceGroups.length >= 2) {
    const best = [...confidenceGroups].sort((a, b) => b.winRatePct - a.winRatePct)[0];
    const worst = [...confidenceGroups].sort((a, b) => a.winRatePct - b.winRatePct)[0];
    if (best.name !== worst.name && best.winRatePct - worst.winRatePct >= 10) {
      lessons.push(`${best.name} 信心组表现更好（胜率 ${best.winRatePct}%），${worst.name} 组更容易被噪声消耗，可优先看前者。`);
    }
  }

  const venueGroups = groupStats(state.trades, trade => trade.venue).filter(group => group.closed >= 3);
  if (venueGroups.length >= 2) {
    const best = [...venueGroups].sort((a, b) => b.totalR - a.totalR)[0];
    const worst = [...venueGroups].sort((a, b) => a.totalR - b.totalR)[0];
    if (best.name !== worst.name && best.totalR - worst.totalR > 0.5) {
      lessons.push(`${best.name} 样本的期望值更高（${best.totalR >= 0 ? '+' : ''}${best.totalR}R），${worst.name} 样本需要更严格的过滤。`);
    }
  }

  const strategyGroups = groupStats(
    state.trades.filter(trade => trade.optionStrategy),
    trade => trade.optionStrategy?.nameZh || '未命名策略',
  ).filter(group => group.closed >= 3);
  if (strategyGroups.length >= 2) {
    const best = [...strategyGroups].sort((a, b) => b.winRatePct - a.winRatePct)[0];
    const worst = [...strategyGroups].sort((a, b) => a.winRatePct - b.winRatePct)[0];
    if (best.name !== worst.name && best.winRatePct - worst.winRatePct >= 10) {
      lessons.push(`期权/结构信号里，${best.name} 近期比 ${worst.name} 更稳（胜率 ${best.winRatePct}% 对 ${worst.winRatePct}%）。`);
    }
  }

  if (winRate < 45) lessons.push('连续低胜率时，优先减少 57%-64% 边缘信号，而不是放大仓位。');
  if (winRate >= 60) lessons.push('高胜率也不代表可以加杠杆；仍按单笔 0.5%-1% 风险执行。');
  return lessons;
}

function summarize(state: JournalFile): AssistantJournalSummary {
  const closed = state.trades.filter(trade => trade.status === 'CLOSED');
  const wins = closed.filter(trade => trade.result === 'WIN').length;
  const losses = closed.filter(trade => trade.result === 'LOSS').length;
  const flat = closed.filter(trade => trade.result === 'FLAT').length;
  const grossWin = closed.reduce((sum, trade) => sum + Math.max(0, trade.rMultiple || 0), 0);
  const grossLoss = closed.reduce((sum, trade) => sum + Math.abs(Math.min(0, trade.rMultiple || 0)), 0);
  const totalR = closed.reduce((sum, trade) => sum + (trade.rMultiple || 0), 0);
  const byVenue = groupStats(state.trades, trade => trade.venue);
  const byStrategy = groupStats(
    state.trades,
    trade => trade.optionStrategy?.nameZh || '普通方向信号',
  );
  const byConfidence = groupStats(state.trades, trade => {
    if (trade.confidencePct >= 70) return '70%+';
    if (trade.confidencePct >= 65) return '65-69%';
    return '57-64%';
  });
  const byRegimeDirection = groupStats(state.trades, trade => {
    const regime = trade.regimeLabel || 'Unknown';
    const direction = trade.direction === 'UP'
      ? 'LONG'
      : trade.direction === 'DOWN'
        ? 'SHORT'
        : trade.direction || 'UNKNOWN';
    return `${regime}:${direction}`;
  });

  return {
    updatedAt: new Date().toISOString(),
    total: state.trades.length,
    open: state.trades.filter(trade => trade.status === 'OPEN').length,
    closed: closed.length,
    wins,
    losses,
    flat,
    winRatePct: closed.length ? round(wins / closed.length * 100, 1) : 0,
    totalR: round(totalR, 2),
    avgR: closed.length ? round(totalR / closed.length, 3) : 0,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : grossWin > 0 ? 99 : 0,
    byVenue,
    byStrategy,
    byConfidence,
    byRegimeDirection,
    experienceRanking: buildExperienceRanking(byVenue, byStrategy, byConfidence, byRegimeDirection),
    lessons: buildLessons(state),
    recentClosed: closed.slice(0, 5),
    openTrades: state.trades.filter(trade => trade.status === 'OPEN').slice(0, 5),
  };
}

function exitCoachForPrice(
  trade: AssistantPaperTrade,
  current: number | null,
): AssistantExitCoach {
  if (!Number.isFinite(current) || !current || current <= 0) {
    return {
      currentPrice: null,
      unrealizedPct: null,
      riskStateZh: '数据不足',
      adviceZh: '暂无可靠现价；不追加仓位，继续按原止损和目标执行。',
    };
  }

  const directionSign = trade.direction === 'SHORT' || trade.direction === 'DOWN' ? -1 : 1;
  const unrealizedPct = (current - trade.entryPrice) / trade.entryPrice * 100 * directionSign;
  const minutesToExpiry = trade.expiresAt
    ? (new Date(trade.expiresAt).getTime() - Date.now()) / 60_000
    : null;

  if (trade.venue === 'Predict.fun' && minutesToExpiry != null && minutesToExpiry <= 0) {
    return {
      currentPrice: round(current, 6),
      unrealizedPct: round(unrealizedPct, 2),
      riskStateZh: '等待结算',
      adviceZh: '已到结算时间，不加仓、不手动接飞刀；等结果揭晓后再总结。',
    };
  }

  if (trade.stopLoss && ((directionSign > 0 && current <= trade.stopLoss)
    || (directionSign < 0 && current >= trade.stopLoss))) {
    return {
      currentPrice: round(current, 8),
      unrealizedPct: round(unrealizedPct, 2),
      riskStateZh: '危险',
      adviceZh: '止损位已经触发/穿越，优先退出或确认自动平仓，不要为了避免实损而放大风险。',
    };
  }

  if (trade.takeProfit && ((directionSign > 0 && current >= trade.takeProfit)
    || (directionSign < 0 && current <= trade.takeProfit))) {
    return {
      currentPrice: round(current, 8),
      unrealizedPct: round(unrealizedPct, 2),
      riskStateZh: '止盈区',
      adviceZh: '目标区已到：先落袋一部分，其余把止损移到成本附近，让剩余仓位免费跟踪。',
    };
  }

  const riskDistance = trade.stopLoss ? Math.abs(trade.entryPrice - trade.stopLoss) : null;
  const favorableMove = (current - trade.entryPrice) * directionSign;
  const stopBufferPct = trade.stopLoss
    ? (current - trade.stopLoss) * directionSign / trade.entryPrice * 100
    : null;

  if (trade.venue === 'Predict.fun' && minutesToExpiry != null && minutesToExpiry <= 10) {
    if (unrealizedPct >= 50) {
      return {
        currentPrice: round(current, 6),
        unrealizedPct: round(unrealizedPct, 2),
        riskStateZh: '止盈区',
        adviceZh: '临近结算且浮盈很大，优先盘口卖出锁定利润；不要为了“吃满”承受反向全损。',
      };
    }
    if (unrealizedPct < -20) {
      return {
        currentPrice: round(current, 6),
        unrealizedPct: round(unrealizedPct, 2),
        riskStateZh: '危险',
        adviceZh: '临近结算且方向落后，若盘口仍有流动性，可小亏退出；没有优势就不要摊平。',
      };
    }
  }

  if (stopBufferPct != null && stopBufferPct <= 0.5) {
    return {
      currentPrice: round(current, 8),
      unrealizedPct: round(unrealizedPct, 2),
      riskStateZh: '危险',
      adviceZh: '价格贴近保护位：不移动止损、不补仓；可考虑提前减半，避免滑点穿过止损。',
    };
  }

  if (riskDistance && favorableMove >= riskDistance * 2) {
    return {
      currentPrice: round(current, 8),
      unrealizedPct: round(unrealizedPct, 2),
      riskStateZh: '保护利润',
      adviceZh: '浮盈超过 2R：先止盈一半，止损上移到保本/最近支撑，剩余让利润奔跑。',
    };
  }

  if (riskDistance && favorableMove >= riskDistance) {
    return {
      currentPrice: round(current, 8),
      unrealizedPct: round(unrealizedPct, 2),
      riskStateZh: '保护利润',
      adviceZh: '浮盈约 1R：止损至少上移到成本，把这笔交易从“可能亏”转成“基本不亏”。',
    };
  }

  if (trade.venue === 'Predict.fun' && minutesToExpiry != null) {
    return {
      currentPrice: round(current, 6),
      unrealizedPct: round(unrealizedPct, 2),
      riskStateZh: '持仓观察',
      adviceZh: `距结算约 ${Math.max(0, Math.ceil(minutesToExpiry))} 分钟：按原方向观察，不加仓；若盘口优势消失再退出。`,
    };
  }

  return {
    currentPrice: round(current, 8),
    unrealizedPct: round(unrealizedPct, 2),
    riskStateZh: '持仓观察',
    adviceZh: '未触及保护位或目标；不追加，等价格给出止损/止盈证据。',
  };
}

async function buildExitCoaches(
  trades: AssistantPaperTrade[],
): Promise<Map<string, AssistantExitCoach>> {
  const result = new Map<string, AssistantExitCoach>();
  const selected = [...trades]
    .sort((a, b) => new Date(a.expiresAt || a.openedAt).getTime() - new Date(b.expiresAt || b.openedAt).getTime())
    .slice(0, 8);
  if (!selected.length) return result;

  const predictIds = [...new Set(selected
    .filter(trade => trade.venue === 'Predict.fun' && trade.marketId)
    .map(trade => trade.marketId!))];
  const cryptoSymbols = [...new Set(selected.filter(trade => trade.venue === 'Binance').map(trade => trade.symbol))];
  const stockSymbols = [...new Set(selected.filter(trade => trade.venue === 'Stocks').map(trade => trade.symbol))];
  const macroTrades = selected.filter(trade => trade.venue === 'Macro');

  const [predictResult, cryptoResult, stockResult, macroResult] = await Promise.allSettled([
    Promise.allSettled(predictIds.map(async id => {
      const response = await api.getOrderbook(id);
      const bestBid = Number(response.data?.bids?.[0]?.[0]);
      const bestAsk = Number(response.data?.asks?.[0]?.[0]);
      const upPrice = Number.isFinite(bestBid) && Number.isFinite(bestAsk)
        ? (bestBid + bestAsk) / 2
        : Number.isFinite(bestBid) ? bestBid : Number.isFinite(bestAsk) ? bestAsk : NaN;
      return [id, upPrice] as const;
    })),
    Promise.allSettled(cryptoSymbols.map(async symbol =>
      [symbol, Number((await binanceFeed.getPrice(symbol))?.price)] as const)),
    fetchTencentPrices(stockSymbols),
    (async () => {
      const sectorTrades = macroTrades.filter(trade => trade.signalId.startsWith('sector-'));
      const pureMacroTrades = macroTrades.filter(trade => !trade.signalId.startsWith('sector-'));
      const [sectorResult, macroPriceResult] = await Promise.allSettled([
        sectorTrades.length
          ? getSectorCurrentPrices([...new Set(sectorTrades.map(trade => trade.symbol))])
          : Promise.resolve(new Map<string, number>()),
        pureMacroTrades.length
          ? getMacroCurrentPrices([...new Set(pureMacroTrades.map(trade => trade.symbol))])
          : Promise.resolve(new Map<string, number>()),
      ]);
      const prices = new Map<string, number>();
      if (sectorResult.status === 'fulfilled') {
        for (const [symbol, price] of sectorResult.value) prices.set(symbol, price);
      }
      if (macroPriceResult.status === 'fulfilled') {
        for (const [symbol, price] of macroPriceResult.value) prices.set(symbol, price);
      }
      return prices;
    })(),
  ]);

  const upPrices = new Map<number, number>();
  if (predictResult.status === 'fulfilled') {
    for (const item of predictResult.value) {
      if (item.status !== 'fulfilled') continue;
      const [id, price] = item.value;
      if (Number.isFinite(price) && price! > 0 && price! < 1) upPrices.set(id, price!);
    }
  }
  const cryptoPrices = new Map<string, number>();
  if (cryptoResult.status === 'fulfilled') {
    for (const item of cryptoResult.value) {
      if (item.status !== 'fulfilled') continue;
      const [symbol, price] = item.value;
      if (Number.isFinite(price) && price! > 0) cryptoPrices.set(symbol, price!);
    }
  }
  const stockPrices = stockResult.status === 'fulfilled' ? stockResult.value : new Map<string, number>();
  const macroPrices = macroResult.status === 'fulfilled' ? macroResult.value : new Map<string, number>();

  for (const trade of selected) {
    let current: number | null = null;
    if (trade.venue === 'Predict.fun') {
      const upPrice = trade.marketId ? upPrices.get(trade.marketId) : null;
      current = upPrice == null ? null : trade.direction === 'DOWN' ? 1 - upPrice : upPrice;
    } else if (trade.venue === 'Binance') {
      current = cryptoPrices.get(trade.symbol) ?? null;
    } else if (trade.venue === 'Stocks') {
      current = stockPrices.get(trade.symbol) ?? null;
    } else if (trade.venue === 'Macro') {
      current = macroPrices.get(trade.symbol.toUpperCase()) ?? null;
    }
    result.set(trade.id, exitCoachForPrice(trade, current));
  }
  return result;
}

function closeTrade(
  trade: AssistantPaperTrade,
  exitPrice: number,
  reason: string,
): AssistantPaperTrade {
  const isBinary = trade.venue === 'Predict.fun';
  const directionSign = trade.direction === 'SHORT' || trade.direction === 'DOWN' ? -1 : 1;
  let pnlPct: number;

  if (isBinary) {
    const won = exitPrice >= 0.999 && ((directionSign > 0 && trade.direction === 'UP')
      || (directionSign < 0 && trade.direction === 'DOWN'));
    const payout = won ? SIMULATION_STAKE_USD / trade.entryPrice : 0;
    pnlPct = (payout - SIMULATION_STAKE_USD) / SIMULATION_STAKE_USD * 100;
  } else {
    pnlPct = (exitPrice - trade.entryPrice) / trade.entryPrice * 100 * directionSign;
  }

  let riskPct = 100;
  if (!isBinary && trade.stopLoss && trade.entryPrice > 0) {
    riskPct = Math.abs(trade.entryPrice - trade.stopLoss) / trade.entryPrice * 100;
  }
  riskPct = Math.max(riskPct, 0.01);

  return {
    ...trade,
    status: 'CLOSED',
    closedAt: new Date().toISOString(),
    exitPrice: round(exitPrice, 8),
    result: pnlPct > 0.01 ? 'WIN' : pnlPct < -0.01 ? 'LOSS' : 'FLAT',
    pnlPct: round(pnlPct, 2),
    rMultiple: round(pnlPct / riskPct, 3),
    closeReason: reason,
  };
}

function closeOptionStrategy(
  trade: AssistantPaperTrade,
  spot: number,
  reason: string,
): AssistantPaperTrade {
  const spec = trade.optionStrategy;
  if (!spec) {
    return closeTrade(trade, spot, reason);
  }

  let payoffPerShare = spec.netPremium;
  let riskPerShare = Math.max(spec.netPremium, 0.01);

  if (spec.kind === 'iron-condor'
    && spec.shortPut != null && spec.longPut != null
    && spec.shortCall != null && spec.longCall != null) {
    const putLoss = Math.max(0, spec.shortPut - Math.max(spot, spec.longPut));
    const callLoss = Math.max(0, Math.min(spot, spec.longCall) - spec.shortCall);
    const width = Math.max(spec.shortPut - spec.longPut, spec.longCall - spec.shortCall);
    payoffPerShare -= putLoss + callLoss;
    riskPerShare = Math.max(width - spec.netPremium, 0.01);
  } else if (spec.kind === 'bull-put-spread'
    && spec.shortPut != null && spec.longPut != null) {
    payoffPerShare -= Math.max(0, spec.shortPut - Math.max(spot, spec.longPut));
    riskPerShare = Math.max(spec.shortPut - spec.longPut - spec.netPremium, 0.01);
  } else if (spec.kind === 'bear-call-spread'
    && spec.shortCall != null && spec.longCall != null) {
    payoffPerShare -= Math.max(0, Math.min(spot, spec.longCall) - spec.shortCall);
    riskPerShare = Math.max(spec.longCall - spec.shortCall - spec.netPremium, 0.01);
  } else if (spec.kind === 'protective-put' && spec.longPut != null) {
    payoffPerShare = Math.max(0, spec.longPut - spot) - spec.netPremium;
    riskPerShare = Math.max(spec.netPremium, 0.01);
  }

  return {
    ...trade,
    status: 'CLOSED',
    closedAt: new Date().toISOString(),
    exitPrice: round(spot, 8),
    result: payoffPerShare > 0.005 ? 'WIN' : payoffPerShare < -0.005 ? 'LOSS' : 'FLAT',
    pnlPct: round(payoffPerShare / Math.max(spec.netPremium, 0.01) * 100, 2),
    rMultiple: round(payoffPerShare / riskPerShare, 3),
    closeReason: reason,
  };
}

async function resolvePredictions(state: JournalFile): Promise<void> {
  const due = state.trades.filter(trade =>
    trade.venue === 'Predict.fun'
    && trade.status === 'OPEN'
    && trade.expiresAt
    && new Date(trade.expiresAt).getTime() <= Date.now());
  if (!due.length) return;

  const resolved = new Map<number, CategoryResult>();
  let cursor: string | undefined;
  for (let page = 0; page < 4; page++) {
    const response = await api.getCategories(50, cursor, 'RESOLVED');
    for (const category of response.data) {
      if (due.some(trade => trade.categoryId === category.id)) resolved.set(category.id, category);
    }
    cursor = response.cursor || undefined;
    if (!cursor || resolved.size === due.length) break;
  }

  for (const trade of due) {
    const category = trade.categoryId ? resolved.get(trade.categoryId) : undefined;
    const market = category?.markets?.find(item => item.resolution);
    const winner = market?.outcomes?.find((outcome): outcome is NonNullable<typeof outcome> =>
      Boolean(outcome) && outcome!.status === 'WON') || market?.resolution;
    if (!category || !winner) {
      if (trade.expiresAt && Date.now() - new Date(trade.expiresAt).getTime() > 2 * 24 * 3600 * 1000) {
        state.trades.splice(state.trades.indexOf(trade), 1, {
          ...trade,
          status: 'CLOSED',
          closedAt: new Date().toISOString(),
          result: 'FLAT',
          pnlPct: 0,
          rMultiple: 0,
          closeReason: '结算结果长时间不可用，按中性退出',
        });
      }
      continue;
    }

    const winnerName = String(winner.name || '').toUpperCase();
    const won = (trade.direction === 'UP' && winnerName === 'UP')
      || (trade.direction === 'DOWN' && winnerName === 'DOWN');
    const updated = closeTrade(trade, won ? 1 : 0, `Predict.fun 结算为 ${winner.name}`);
    state.trades.splice(state.trades.indexOf(trade), 1, updated);
  }
}

interface CategoryResult {
  id: number;
  status: string;
  markets?: Array<{
    resolution?: { name?: string } | null;
    outcomes?: Array<{ name?: string; status?: 'WON' | 'LOST' | null } | null> | null;
  }>;
}

async function resolveCrypto(state: JournalFile): Promise<void> {
  // Check protective levels on every advisor refresh, then settle anything old.
  const active = state.trades.filter(trade => trade.venue === 'Binance' && trade.status === 'OPEN');
  for (const trade of active) {
    if (!trade.stopLoss || !trade.takeProfit) continue;
    try {
      const price = await binanceFeed.getPrice(trade.symbol);
      const current = Number(price?.price);
      if (!Number.isFinite(current) || current <= 0) continue;
      const isLong = trade.direction === 'LONG';
      const stopHit = isLong ? current <= trade.stopLoss : current >= trade.stopLoss;
      const targetHit = isLong ? current >= trade.takeProfit : current <= trade.takeProfit;
      if (stopHit || targetHit) {
        const updated = closeTrade(
          trade,
          current,
          stopHit ? '触发模拟止损' : '触发模拟止盈',
        );
        state.trades.splice(state.trades.indexOf(trade), 1, updated);
      }
    } catch {
    }
  }

  const due = state.trades.filter(trade =>
    trade.venue === 'Binance'
    && trade.status === 'OPEN'
    && trade.expiresAt
    && new Date(trade.expiresAt).getTime() <= Date.now());
  if (!due.length) return;

  for (const trade of due) {
    try {
      const price = await binanceFeed.getPrice(trade.symbol);
      if (!price?.price) continue;
      const updated = closeTrade(trade, Number(price.price), '到期按币安现货价结算');
      state.trades.splice(state.trades.indexOf(trade), 1, updated);
    } catch {
    }
  }
}

function parseTencentPrice(raw: string): number | null {
  const match = raw.match(/v_\w+="([^"]+)"/);
  if (!match) return null;
  const price = Number(match[1].split('~')[3]);
  return Number.isFinite(price) && price > 0 ? price : null;
}

async function fetchTencentPrices(symbols: string[]): Promise<Map<string, number>> {
  if (!symbols.length) return new Map();
  const response = await fetch(`https://qt.gtimg.cn/q=${symbols.join(',')}`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('Tencent quotes unavailable');
  const text = await response.text();
  const prices = new Map<string, number>();
  const expected = [...symbols];
  for (const raw of text.split(';')) {
    const match = raw.match(/v_([^=]+)=/);
    const price = parseTencentPrice(raw.trim());
    if (!match || price == null) continue;
    // Preserve request order because Tencent may echo a normalized exchange code.
    const requested = expected.shift();
    if (requested) prices.set(requested, price);
  }
  return prices;
}

async function resolveStocks(state: JournalFile): Promise<void> {
  const active = state.trades.filter(trade => trade.venue === 'Stocks' && trade.status === 'OPEN');
  if (!active.length) return;
  let prices: Map<string, number>;
  try {
    prices = await fetchTencentPrices([...new Set(active.map(trade => trade.symbol))]);
  } catch {
    return;
  }

  for (const trade of active) {
    const current = prices.get(trade.symbol);
    if (!Number.isFinite(current)) continue;
    const isLong = trade.direction === 'LONG';
    const stopHit = Boolean(trade.stopLoss)
      && (isLong ? current! <= trade.stopLoss! : current! >= trade.stopLoss!);
    const targetHit = Boolean(trade.takeProfit)
      && (isLong ? current! >= trade.takeProfit! : current! <= trade.takeProfit!);
    if ((stopHit || targetHit) && trade.stopLoss && trade.takeProfit) {
      const updated = closeTrade(
        trade,
        current!,
        stopHit ? '触发模拟止损' : '触发模拟止盈',
      );
      state.trades.splice(state.trades.indexOf(trade), 1, updated);
    }
  }

  for (const trade of active.filter(item =>
    item.status === 'OPEN'
    && item.expiresAt
    && new Date(item.expiresAt).getTime() <= Date.now())) {
    const current = prices.get(trade.symbol);
    if (!Number.isFinite(current)) continue;
    const updated = closeTrade(trade, current!, '到期按腾讯延迟行情结算');
    state.trades.splice(state.trades.indexOf(trade), 1, updated);
  }
}

async function resolveMacro(state: JournalFile): Promise<void> {
  const active = state.trades.filter(trade => trade.venue === 'Macro' && trade.status === 'OPEN');
  if (!active.length) return;

  const sectorTrades = active.filter(trade => trade.signalId.startsWith('sector-'));
  const macroTrades = active.filter(trade => !trade.signalId.startsWith('sector-'));
  const [macroResult, sectorResult] = await Promise.allSettled([
    macroTrades.length
      ? getMacroCurrentPrices(macroTrades.map(trade => trade.symbol))
      : Promise.resolve(new Map<string, number>()),
    sectorTrades.length
      ? getSectorCurrentPrices(sectorTrades.map(trade => trade.symbol))
      : Promise.resolve(new Map<string, number>()),
  ]);
  const prices = new Map<string, number>();
  if (macroResult.status === 'fulfilled') {
    for (const [symbol, price] of macroResult.value) prices.set(symbol, price);
  }
  if (sectorResult.status === 'fulfilled') {
    for (const [symbol, price] of sectorResult.value) prices.set(symbol, price);
  }

  for (const trade of active) {
    const current = prices.get(trade.symbol.toUpperCase());
    if (!Number.isFinite(current)) continue;
    const isLong = trade.direction === 'LONG';
    const stopHit = Boolean(trade.stopLoss)
      && (isLong ? current! <= trade.stopLoss! : current! >= trade.stopLoss!);
    const targetHit = Boolean(trade.takeProfit)
      && (isLong ? current! >= trade.takeProfit! : current! <= trade.takeProfit!);
    if ((stopHit || targetHit) && trade.stopLoss && trade.takeProfit) {
      const updated = closeTrade(
        trade,
        current!,
        stopHit ? '触发模拟止损' : '触发模拟止盈',
      );
      state.trades.splice(state.trades.indexOf(trade), 1, updated);
    }
  }

  for (const trade of active.filter(item =>
    item.status === 'OPEN'
    && item.expiresAt
    && new Date(item.expiresAt).getTime() <= Date.now())) {
    const current = prices.get(trade.symbol.toUpperCase());
    if (!Number.isFinite(current)) continue;
    const updated = closeTrade(trade, current!, '到期按宏观收盘价结算');
    state.trades.splice(state.trades.indexOf(trade), 1, updated);
  }
}

async function resolveOptions(state: JournalFile): Promise<void> {
  const due = state.trades.filter(trade =>
    trade.venue === 'Options'
    && trade.status === 'OPEN'
    && trade.expiresAt
    && new Date(trade.expiresAt).getTime() <= Date.now());
  if (!due.length) return;

  const prices = new Map<string, number>();
  const equitySymbols = [...new Set(due
    .filter(trade => trade.symbol !== 'BTC' && trade.symbol !== 'ETH')
    .map(trade => `us${trade.symbol}`))];
  try {
    const equityPrices = await fetchTencentPrices(equitySymbols);
    for (const [requestedSymbol, price] of equityPrices) {
      const symbol = requestedSymbol.replace(/^us/, '');
      if (symbol) prices.set(symbol, price);
    }
  } catch {
  }

  for (const symbol of [...new Set(due
    .filter(trade => trade.symbol === 'BTC' || trade.symbol === 'ETH')
    .map(trade => trade.symbol))]) {
    try {
      const ticker = await binanceFeed.getPrice(`${symbol}USDT`);
      if (Number.isFinite(ticker?.price)) prices.set(symbol, Number(ticker!.price));
    } catch {
    }
  }

  for (const trade of due) {
    const spot = prices.get(trade.symbol);
    if (!Number.isFinite(spot)) continue;
    const updated = closeOptionStrategy(
      trade,
      spot!,
      `到期按 ${trade.symbol} 现价 ${spot} 结算`,
    );
    state.trades.splice(state.trades.indexOf(trade), 1, updated);
  }
}

async function entryPriceForPrediction(trade: {
  marketId?: number;
  direction?: AssistantDirection;
  probabilityPct?: number;
}): Promise<number> {
  if (!trade.marketId) return clamp((trade.probabilityPct || 55) / 100, 0.05, 0.95);
  try {
    const response = await api.getOrderbook(trade.marketId);
    const book = response.data;
    const bestBid = book.bids?.[0]?.[0];
    const bestAsk = book.asks?.[0]?.[0];
    let upPrice = Number.isFinite(bestBid) && Number.isFinite(bestAsk)
      ? (bestBid + bestAsk) / 2
      : Number.isFinite(bestBid) ? bestBid : Number.isFinite(bestAsk) ? bestAsk : NaN;
    if (!Number.isFinite(upPrice) || upPrice <= 0 || upPrice >= 1) {
      return clamp((trade.probabilityPct || 55) / 100, 0.05, 0.95);
    }
    return clamp(trade.direction === 'DOWN' ? 1 - upPrice : upPrice, 0.03, 0.97);
  } catch {
    return clamp((trade.probabilityPct || 55) / 100, 0.05, 0.95);
  }
}

export async function syncAssistantJournal(report: {
  regime: { label: string };
  reminders: Array<{
  id: string;
  venue: 'Binance' | 'Predict.fun' | 'Stocks' | 'Options' | 'Macro';
    symbol: string;
    title: string;
    action: 'BUY' | 'SELL' | 'WAIT';
    actionZh: string;
    direction?: AssistantDirection;
    categoryId?: number;
    slug?: string;
    expiresAt?: string;
    confidencePct: number;
    probabilityPct?: number;
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
    marketId?: number;
    optionStrategy?: AssistantOptionStrategy;
  }>;
}): Promise<AssistantJournalSummary> {
  const state = load();
  await Promise.allSettled([
    resolvePredictions(state),
    resolveCrypto(state),
    resolveStocks(state),
    resolveOptions(state),
    resolveMacro(state),
  ]);

  for (const signal of report.reminders) {
    const direction: AssistantDirection | undefined = signal.direction
      || (signal.venue === 'Predict.fun'
        ? (signal.actionZh?.includes('DOWN') ? 'DOWN' : 'UP')
        : (signal.action === 'SELL' ? 'SHORT' : 'LONG'));
    if (!direction) continue;

    const signalKey = `${signal.venue}:${signal.id}:${direction}`;
    if (state.trades.some(trade => trade.signalKey === signalKey)) continue;

    const openedAt = new Date().toISOString();
    const entryPrice = signal.venue === 'Predict.fun'
      ? await entryPriceForPrediction(signal)
      : Number(signal.entry || 0);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) continue;

    state.trades.unshift({
      id: `asj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      signalId: signal.id,
      signalKey,
      venue: signal.venue,
      symbol: signal.symbol,
      title: signal.title,
      direction,
      actionZh: signal.actionZh,
      confidencePct: signal.confidencePct,
      probabilityPct: signal.probabilityPct,
      entryPrice: round(entryPrice, 8),
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      optionStrategy: signal.optionStrategy,
      marketId: signal.marketId,
      categoryId: signal.categoryId,
      slug: signal.slug,
      regimeLabel: report.regime.label,
      openedAt,
      expiresAt: signal.expiresAt || (signal.venue === 'Predict.fun' ? undefined : new Date(Date.now() + 24 * 3600 * 1000).toISOString()),
      status: 'OPEN',
      result: 'PENDING',
      closeReason: '',
    });
  }

  const openCount = state.trades.filter(trade => trade.status === 'OPEN').length;
  if (state.trades.length > MAX_TRADES) {
    state.trades = state.trades.slice(0, MAX_TRADES);
  }
  if (state.trades.length || openCount) save(state);
  const summary = summarize(state);
  const exitCoaches = await buildExitCoaches(summary.openTrades);
  summary.openTrades = summary.openTrades.map(trade => ({
    ...trade,
    exitCoach: exitCoaches.get(trade.id),
  }));
  return summary;
}

export async function refreshAssistantRiskPatrol(
  options: { push?: boolean } = {},
): Promise<AssistantRiskPatrolResult> {
  const state = load();
  await Promise.allSettled([
    resolvePredictions(state),
    resolveCrypto(state),
    resolveStocks(state),
    resolveOptions(state),
    resolveMacro(state),
  ]);

  if (state.trades.length) save(state);
  const openTrades = state.trades.filter(trade => trade.status === 'OPEN');
  const coaches = await buildExitCoaches(openTrades);
  const alerts: AssistantRiskAlert[] = openTrades.map(trade => {
    const coach = coaches.get(trade.id);
    const riskStateZh = coach?.riskStateZh || '数据不足';
    const severity: AssistantRiskAlert['severity'] = riskStateZh === '危险'
      ? 'danger'
      : riskStateZh === '止盈区' || riskStateZh === '保护利润'
        ? 'profit'
        : 'watch';
    const minutesToExpiry = trade.expiresAt
      ? Math.max(0, Math.round((new Date(trade.expiresAt).getTime() - Date.now()) / 60_000))
      : null;

    return {
      id: `${trade.id}:${riskStateZh}`,
      tradeId: trade.id,
      venue: trade.venue,
      symbol: trade.symbol,
      title: trade.title,
      direction: trade.direction,
      confidencePct: trade.confidencePct,
      riskStateZh,
      severity,
      currentPrice: coach?.currentPrice ?? null,
      unrealizedPct: coach?.unrealizedPct ?? null,
      minutesToExpiry,
      adviceZh: coach?.adviceZh || '现价暂不可用；保持原止损和目标，不追加仓位。',
    };
  }).sort((a, b) => {
    const rank = { danger: 0, profit: 1, watch: 2 } as const;
    return rank[a.severity] - rank[b.severity]
      || (a.minutesToExpiry ?? Number.MAX_SAFE_INTEGER) - (b.minutesToExpiry ?? Number.MAX_SAFE_INTEGER);
  });

  const result: AssistantRiskPatrolResult = {
    updatedAt: new Date().toISOString(),
    openPositions: openTrades.length,
    dangerCount: alerts.filter(alert => alert.severity === 'danger').length,
    profitCount: alerts.filter(alert => alert.severity === 'profit').length,
    watchCount: alerts.filter(alert => alert.severity === 'watch').length,
    alerts,
  };

  if (options.push) notifyNewRiskAlerts(alerts);
  return result;
}

const activeRiskSignatures = new Set<string>();

function notifyNewRiskAlerts(alerts: AssistantRiskAlert[]): void {
  const activeSignatures = new Set<string>();
  for (const alert of alerts) {
    if (alert.severity === 'watch') continue;
    activeSignatures.add(alert.id);
    if (activeRiskSignatures.has(alert.id)) continue;

    activeRiskSignatures.add(alert.id);
    const icon = alert.severity === 'danger' ? '🛑' : '🎯';
    const price = alert.currentPrice != null ? ` @ ${alert.currentPrice}` : '';
    const pnl = alert.unrealizedPct != null
      ? `（浮动 ${alert.unrealizedPct >= 0 ? '+' : ''}${alert.unrealizedPct}%）`
      : '';
    pushNotification('risk', `${icon} ${alert.venue} ${alert.symbol}${price}${pnl}：${alert.riskStateZh}。${alert.adviceZh}`);
    void telegram.send(
      `${icon} <b>MoneyMoney 持仓巡检</b>\n\n` +
      `📌 ${alert.title}\n` +
      `🏷️ ${alert.venue} · ${alert.symbol} · ${alert.direction}${price}${pnl}\n` +
      `⚠️ 状态：<b>${alert.riskStateZh}</b>\n` +
      `🧭 建议：${alert.adviceZh}`
    );
  }

  // If a position recovers, forget the old state so a later relapse warns again.
  for (const signature of [...activeRiskSignatures]) {
    if (!activeSignatures.has(signature)) activeRiskSignatures.delete(signature);
  }
}
