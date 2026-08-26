/**
 * Binance spot order-flow and book-liquidity radar.
 *
 * Taker-buy kline volume tells us which side crossed the spread; public depth
 * tells us whether resting liquidity supports that story. Both are keyless and
 * use the same Binance public data host as the existing dashboard.
 */

import { binanceFeed } from './binance';

export type OrderFlowState = 'buy-heavy' | 'sell-heavy' | 'balanced';
export type BookState = 'bid-heavy' | 'ask-heavy' | 'balanced';
export type OrderFlowSignal =
  | 'inflow-confirmed'
  | 'outflow-confirmed'
  | 'conflicting'
  | 'flow-leads'
  | 'book-leads'
  | 'neutral';

export interface OrderFlowLiquidityRow {
  symbol: string;
  nameZh: string;
  price: number;
  change24hPct: number;
  volume24hUsd: number;
  takerBuy24hUsd: number;
  takerSell24hUsd: number;
  netTakerFlow24hUsd: number;
  netFlowShare24hPct: number;
  takerBuyShare24hPct: number;
  flowAccelerationPct: number;
  bidUsd: number;
  askUsd: number;
  bookImbalancePct: number;
  spreadBps: number;
  nearTouchLiquidityUsd: number;
  flowState: OrderFlowState;
  flowStateZh: string;
  bookState: BookState;
  bookStateZh: string;
  signal: OrderFlowSignal;
  signalZh: string;
  adviceZh: string;
}

export interface OrderFlowLiquidityResult {
  generatedAt: string;
  source: string;
  rows: OrderFlowLiquidityRow[];
  averageNetFlowSharePct: number;
  averageBookImbalancePct: number;
  confirmedInflowCount: number;
  confirmedOutflowCount: number;
  conflictingCount: number;
  summaryZh: string;
  advisorBiasZh: string;
  regimeBoost: number;
}

interface FlowBar {
  time: number;
  open: number;
  close: number;
  quoteVolume: number;
  takerBuyQuoteVolume: number;
}

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'];
const NAMES_ZH: Record<string, string> = {
  BTC: '比特币',
  ETH: '以太坊',
  SOL: 'Solana',
  BNB: 'BNB',
  XRP: 'XRP',
  DOGE: '狗狗币',
};
const CACHE_TTL_MS = 120_000;
let cache: { ts: number; value: OrderFlowLiquidityResult } | null = null;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Number.isFinite(value) ? Math.round(value * factor) / factor : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sum<T>(items: T[], picker: (item: T) => number): number {
  return items.reduce((total, item) => total + (Number.isFinite(picker(item)) ? picker(item) : 0), 0);
}

function windowStats(bars: FlowBar[]): {
  volume: number;
  buy: number;
  sell: number;
  net: number;
  share: number;
} {
  const volume = sum(bars, bar => bar.quoteVolume);
  const buy = sum(bars, bar => bar.takerBuyQuoteVolume);
  const sell = Math.max(0, volume - buy);
  const net = buy - sell;
  return { volume, buy, sell, net, share: volume ? net / volume * 100 : 0 };
}

function bookStateAndAdvice(row: Pick<OrderFlowLiquidityRow, 'bookImbalancePct'>)
  : Pick<OrderFlowLiquidityRow, 'bookState' | 'bookStateZh'> {
  if (row.bookImbalancePct >= 15) {
    return { bookState: 'bid-heavy', bookStateZh: '买盘偏厚' };
  }
  if (row.bookImbalancePct <= -15) {
    return { bookState: 'ask-heavy', bookStateZh: '卖压偏厚' };
  }
  return { bookState: 'balanced', bookStateZh: '盘口平衡' };
}

function signalAndAdvice(
  row: Omit<OrderFlowLiquidityRow, 'signal' | 'signalZh' | 'adviceZh'>,
): Pick<OrderFlowLiquidityRow, 'signal' | 'signalZh' | 'adviceZh'> {
  if (row.flowState === 'buy-heavy' && row.bookState === 'bid-heavy') {
    return {
      signal: 'inflow-confirmed',
      signalZh: '主动买入确认',
      adviceZh: '短线买方更主动，下方挂单也偏厚；仍只做顺势确认，不在冲高时追大仓。',
    };
  }
  if (row.flowState === 'sell-heavy' && row.bookState === 'ask-heavy') {
    return {
      signal: 'outflow-confirmed',
      signalZh: '主动卖出确认',
      adviceZh: '卖方更主动且上方卖压偏厚；已有利润可分批保护，新多等止跌或更强证据。',
    };
  }
  if ((row.flowState === 'buy-heavy' && row.bookState === 'ask-heavy')
    || (row.flowState === 'sell-heavy' && row.bookState === 'bid-heavy')) {
    return {
      signal: 'conflicting',
      signalZh: '成交与盘口背离',
      adviceZh: '一边主动买卖强、一边挂单反向增厚，容易来回扫损；缩小仓位或等二者一致。',
    };
  }
  if (row.flowState === 'buy-heavy') {
    return {
      signal: 'flow-leads',
      signalZh: '主动买入领先',
      adviceZh: '成交方向偏买，但盘口支持还不充分；适合观察延续，不适合重仓抢跑。',
    };
  }
  if (row.flowState === 'sell-heavy') {
    return {
      signal: 'book-leads',
      signalZh: '主动卖出领先',
      adviceZh: '短线抛压较明显；先看关键支撑能否守住，再考虑防守或反转机会。',
    };
  }
  if (row.bookState === 'bid-heavy') {
    return {
      signal: 'book-leads',
      signalZh: '买盘挂单领先',
      adviceZh: '下方承接较厚但主动买盘不足；等价格和成交量确认，不提前赌反弹。',
    };
  }
  if (row.bookState === 'ask-heavy') {
    return {
      signal: 'book-leads',
      signalZh: '卖盘挂单领先',
      adviceZh: '上方挂单偏厚但主动卖出未放大；突破放量再看延续，否则避免追高。',
    };
  }
  return {
    signal: 'neutral',
    signalZh: '中性',
    adviceZh: '主动成交与盘口都接近平衡，按原有技术信号执行即可。',
  };
}

async function buildRow(symbol: string): Promise<OrderFlowLiquidityRow> {
  const pair = `${symbol.toUpperCase()}USDT`;
  const [rawBars, depth] = await Promise.all([
    binanceFeed.getKlines(pair, '1h', 25),
    binanceFeed.getDepth(pair, 100),
  ]);
  const bars = rawBars.map(bar => ({
    time: Number(bar.time),
    open: Number(bar.open),
    close: Number(bar.close),
    quoteVolume: Number(bar.quoteVolume),
    takerBuyQuoteVolume: Number(bar.takerBuyQuoteVolume),
  })).filter(bar => Number.isFinite(bar.close)
    && Number.isFinite(bar.quoteVolume)
    && Number.isFinite(bar.takerBuyQuoteVolume));
  if (bars.length < 20 || !depth?.bids?.length || !depth?.asks?.length) {
    throw new Error(`${pair} order-flow history unavailable`);
  }

  const latest = bars[bars.length - 1];
  const last24 = bars.slice(-24);
  const recent4 = bars.slice(-4);
  const older20 = bars.slice(0, Math.max(0, bars.length - 4)).slice(-20);
  const stats24 = windowStats(last24);
  const stats4 = windowStats(recent4);
  const statsOlder = windowStats(older20);

  const price = latest.close;
  const bids = depth.bids.map(level => ({ price: Number(level[0]), qty: Number(level[1]) }));
  const asks = depth.asks.map(level => ({ price: Number(level[0]), qty: Number(level[1]) }));
  const bestBid = bids[0]?.price ?? price;
  const bestAsk = asks[0]?.price ?? price;
  const mid = (bestBid + bestAsk) / 2;
  const bidUsd = sum(bids, level => level.price * level.qty);
  const askUsd = sum(asks, level => level.price * level.qty);
  const totalBook = bidUsd + askUsd;
  const nearBoundaryLow = mid * 0.995;
  const nearBoundaryHigh = mid * 1.005;
  const nearTouchLiquidityUsd = sum(bids.filter(level => level.price >= nearBoundaryLow), level => level.price * level.qty)
    + sum(asks.filter(level => level.price <= nearBoundaryHigh), level => level.price * level.qty);

  const base: Omit<OrderFlowLiquidityRow,
    'flowState' | 'flowStateZh' | 'bookState' | 'bookStateZh' | 'signal' | 'signalZh' | 'adviceZh'> = {
    symbol,
    nameZh: NAMES_ZH[symbol] || symbol,
    price: round(price, symbol === 'DOGE' || symbol === 'XRP' ? 5 : 2),
    change24hPct: round(last24[0].open ? (latest.close - last24[0].open) / last24[0].open * 100 : 0),
    volume24hUsd: Math.round(stats24.volume),
    takerBuy24hUsd: Math.round(stats24.buy),
    takerSell24hUsd: Math.round(stats24.sell),
    netTakerFlow24hUsd: Math.round(stats24.net),
    netFlowShare24hPct: round(stats24.share),
    takerBuyShare24hPct: round(stats24.volume ? stats24.buy / stats24.volume * 100 : 50),
    // Positive means the most recent four hours carry more buying pressure than the prior twenty.
    flowAccelerationPct: round(stats4.share - statsOlder.share),
    bidUsd: Math.round(bidUsd),
    askUsd: Math.round(askUsd),
    bookImbalancePct: round(totalBook ? (bidUsd - askUsd) / totalBook * 100 : 0),
    spreadBps: round(mid ? (bestAsk - bestBid) / mid * 10_000 : 0),
    nearTouchLiquidityUsd: Math.round(nearTouchLiquidityUsd),
  };

  const flowState: OrderFlowState = base.netFlowShare24hPct >= 5
    ? 'buy-heavy'
    : base.netFlowShare24hPct <= -5
      ? 'sell-heavy'
      : 'balanced';
  const withStates = {
    ...base,
    flowState,
    flowStateZh: flowState === 'buy-heavy' ? '主动买入强' : flowState === 'sell-heavy' ? '主动卖出强' : '主动流平衡',
    ...bookStateAndAdvice(base),
  };
  return { ...withStates, ...signalAndAdvice(withStates) };
}

export async function getOrderFlowLiquidityRadar(): Promise<OrderFlowLiquidityResult> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const results = await Promise.allSettled(SYMBOLS.map(buildRow));
  const rows = results
    .filter((result): result is PromiseFulfilledResult<OrderFlowLiquidityRow> => result.status === 'fulfilled')
    .map(result => result.value)
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd);
  const firstFailure = results.find(result => result.status === 'rejected');
  if (!rows.length || !rows.some(row => row.symbol === 'BTC')) {
    throw new Error(firstFailure && firstFailure.status === 'rejected'
      ? firstFailure.reason instanceof Error ? firstFailure.reason.message : '主动资金流数据不足'
      : '主动资金流数据不足');
  }

  const averageNetFlowSharePct = round(rows.reduce((total, row) => total + row.netFlowShare24hPct, 0) / rows.length);
  const averageBookImbalancePct = round(rows.reduce((total, row) => total + row.bookImbalancePct, 0) / rows.length);
  const confirmedInflowCount = rows.filter(row => row.signal === 'inflow-confirmed').length;
  const confirmedOutflowCount = rows.filter(row => row.signal === 'outflow-confirmed').length;
  const conflictingCount = rows.filter(row => row.signal === 'conflicting').length;

  let summaryZh = `主流币平均净主动流 ${averageNetFlowSharePct > 0 ? '+' : ''}${averageNetFlowSharePct}%，` +
    `平均盘口偏离 ${averageBookImbalancePct > 0 ? '+' : ''}${averageBookImbalancePct}%。`;
  if (confirmedInflowCount && confirmedOutflowCount) {
    summaryZh += `内部分化明显：${confirmedInflowCount} 个流入确认、${confirmedOutflowCount} 个流出确认。`;
  } else if (confirmedInflowCount >= 2) {
    summaryZh += `${confirmedInflowCount} 个主流币同时出现主动流入与买盘确认。`;
  } else if (confirmedOutflowCount >= 2) {
    summaryZh += `${confirmedOutflowCount} 个主流币同时出现主动流出与卖压确认。`;
  } else if (conflictingCount) {
    summaryZh += `${conflictingCount} 个标的成交与盘口背离，信号可靠性下降。`;
  }

  const flowBoost = clamp(averageNetFlowSharePct / 6 * 2.2, -3.2, 3.2);
  const bookBoost = clamp(averageBookImbalancePct / 18 * 1.2, -1.6, 1.6);
  const conflictPenalty = clamp(conflictingCount * -0.35, -1.2, 0);
  const regimeBoost = round(clamp(flowBoost + bookBoost + conflictPenalty, -4, 4), 2);
  const advisorBiasZh = regimeBoost >= 1.5
    ? '主动资金与盘口背景偏买，顺势信号可优先，但仍控制单笔风险'
    : regimeBoost <= -1.5
      ? '主动资金与盘口背景偏卖，防守和减仓优先于抄底'
      : '主动资金与盘口背景中性，等待更清晰确认';

  const value: OrderFlowLiquidityResult = {
    generatedAt: new Date().toISOString(),
    source: 'Binance public spot taker-flow klines & order-book depth',
    rows,
    averageNetFlowSharePct,
    averageBookImbalancePct,
    confirmedInflowCount,
    confirmedOutflowCount,
    conflictingCount,
    summaryZh,
    advisorBiasZh,
    regimeBoost,
  };
  cache = { ts: Date.now(), value };
  return value;
}
