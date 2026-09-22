import { stateStore, SQLiteStateStore } from '../storage/sqlite-state';
import { randomUUID } from 'node:crypto';

export type UnifiedPaperInstrumentType = 'stock' | 'option' | 'crypto' | 'prediction';
export type UnifiedPaperSide = 'BUY' | 'SELL' | 'YES' | 'NO';

export interface UnifiedPaperOrder {
  id?: string;
  instrumentId: string;
  instrumentType: UnifiedPaperInstrumentType;
  title?: string;
  side: UnifiedPaperSide;
  outcome?: 'YES' | 'NO';
  price: number;
  quantity: number;
  timestamp: string;
  strategy?: string;
  reason?: string;
  pnlUsd?: number;
  feeUsd?: number;
  slippageUsd?: number;
}

export interface UnifiedPaperPosition {
  instrumentId: string;
  instrumentType: UnifiedPaperInstrumentType;
  title: string;
  outcome?: 'YES' | 'NO';
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  openedAt: string;
  realizedPnl: number;
}

export interface UnifiedPaperLedger {
  startingCash: number;
  cash: number;
  positions: UnifiedPaperPosition[];
  orders: UnifiedPaperOrder[];
  realizedPnl: number;
  peakEquity: number;
  maxDrawdownPct: number;
}

export function emptyUnifiedPaperLedger(startingCash = 1000): UnifiedPaperLedger {
  const cash = Math.max(0, Number(startingCash) || 1000);
  return { startingCash: cash, cash, positions: [], orders: [], realizedPnl: 0, peakEquity: cash, maxDrawdownPct: 0 };
}

export function validateUnifiedPaperOrder(input: Partial<UnifiedPaperOrder>): { ok: boolean; error?: string } {
  const instrumentId = String(input.instrumentId || '').trim();
  if (!instrumentId) return { ok: false, error: '必须提供标的 ID' };
  if (!['stock', 'option', 'crypto', 'prediction'].includes(String(input.instrumentType))) return { ok: false, error: '标的类型无效' };
  const inferredType = instrumentTypeFromId(instrumentId);
  if (inferredType && inferredType !== input.instrumentType) return { ok: false, error: '标的类型与规范化 ID 不一致' };
  const allowed = input.instrumentType === 'prediction' ? ['YES', 'NO', 'SELL'] : ['BUY', 'SELL'];
  if (!allowed.includes(String(input.side))) return { ok: false, error: input.instrumentType === 'prediction' ? '预测市场订单只能选择 YES 或 NO' : '股票、期权和加密资产订单只能选择 BUY 或 SELL' };
  if (input.instrumentType === 'prediction' && input.side === 'SELL' && !['YES', 'NO'].includes(String(input.outcome))) return { ok: false, error: '平仓必须指定 YES 或 NO outcome' };
  if (!Number.isFinite(Number(input.price)) || Number(input.price) <= 0) return { ok: false, error: '价格必须大于 0' };
  if (input.instrumentType === 'prediction' && Number(input.price) > 1) return { ok: false, error: '预测市场价格必须在 0 到 1 之间' };
  if (!Number.isFinite(Number(input.quantity)) || Number(input.quantity) <= 0) return { ok: false, error: '数量必须大于 0' };
  if (input.timestamp != null && (!String(input.timestamp || '').trim() || !Number.isFinite(new Date(String(input.timestamp)).getTime()))) return { ok: false, error: '时间戳无效' };
  return { ok: true };
}

interface LegacyPredictionPosition {
  id: string; marketId: number; marketTitle: string; outcomeIndex: 0 | 1; outcomeName: string;
  entryPrice: number; currentPrice?: number; quantity: number; entryTime: string;
  exitPrice?: number; exitTime?: string; status: 'OPEN' | 'CLOSED'; pnlUsd?: number;
}

interface LegacyPredictionPortfolio {
  startingBalance: number; cashBalance: number; positions: LegacyPredictionPosition[];
}

function round(value: number, digits = 8): number { const factor = 10 ** digits; return Math.round(value * factor) / factor; }
function instrumentTypeFromId(value: string): UnifiedPaperInstrumentType | null {
  const id = String(value || '').trim().toLowerCase();
  if (id.startsWith('stock:')) return 'stock';
  if (id.startsWith('option:')) return 'option';
  if (id.startsWith('crypto:')) return 'crypto';
  if (id.startsWith('prediction:')) return 'prediction';
  return null;
}
function positionKey(order: UnifiedPaperOrder): string { return `${order.instrumentId}:${order.instrumentType === 'prediction' ? (order.side === 'SELL' ? order.outcome : order.side) : 'direction'}`; }
function orderCosts(order: UnifiedPaperOrder): number {
  const fee = Number(order.feeUsd);
  const slippage = Number(order.slippageUsd);
  return (Number.isFinite(fee) ? Math.abs(fee) : 0) + (Number.isFinite(slippage) ? Math.abs(slippage) : 0);
}

export function applyUnifiedPaperOrder(source: UnifiedPaperLedger, order: UnifiedPaperOrder): UnifiedPaperLedger {
  const validation = validateUnifiedPaperOrder(order);
  if (!validation.ok) throw new Error(validation.error);
  const ledger: UnifiedPaperLedger = { ...source, positions: source.positions.map(item => ({ ...item })), orders: [...source.orders] };
  const notional = order.price * order.quantity;
  const costs = orderCosts(order);
  const key = positionKey(order);
  let recordedOrder: UnifiedPaperOrder = { ...order };
  if ((order.side === 'BUY' || order.side === 'YES' || order.side === 'NO') && notional + costs > ledger.cash) throw new Error('模拟账户余额不足');
  let position = ledger.positions.find(item => `${item.instrumentId}:${item.instrumentType === 'prediction' ? item.outcome : 'direction'}` === key);
  if (order.side === 'SELL') {
    if (!position || position.quantity < order.quantity) throw new Error('没有足够的可卖持仓');
    const closePnl = round((order.price - position.averageEntryPrice) * order.quantity, 8);
    position.realizedPnl += closePnl;
    ledger.realizedPnl += closePnl;
    recordedOrder = { ...order, pnlUsd: closePnl };
    position.quantity = round(position.quantity - order.quantity);
    ledger.cash = round(ledger.cash + notional - costs, 8);
    if (position.quantity <= 0) ledger.positions = ledger.positions.filter(item => item !== position);
  } else {
    ledger.cash = round(ledger.cash - notional - costs, 8);
    if (position) {
      const totalQty = position.quantity + order.quantity;
      position.averageEntryPrice = round((position.averageEntryPrice * position.quantity + order.price * order.quantity) / totalQty, 8);
      position.quantity = round(totalQty);
    } else {
      position = { instrumentId: order.instrumentId, instrumentType: order.instrumentType, title: order.title || order.instrumentId, ...(order.instrumentType === 'prediction' ? { outcome: order.side as 'YES' | 'NO' } : {}), quantity: order.quantity, averageEntryPrice: order.price, currentPrice: order.price, openedAt: order.timestamp, realizedPnl: 0 };
      ledger.positions.push(position);
    }
  }
  ledger.orders.unshift(recordedOrder);
  const performance = calculateUnifiedPerformance(ledger);
  ledger.peakEquity = Math.max(ledger.peakEquity, performance.equity);
  ledger.maxDrawdownPct = Math.max(ledger.maxDrawdownPct, ledger.peakEquity > 0 ? ((ledger.peakEquity - performance.equity) / ledger.peakEquity) * 100 : 0);
  return ledger;
}

export function markUnifiedPaperPrices(source: UnifiedPaperLedger, prices: Map<string, number>): UnifiedPaperLedger {
  const ledger = { ...source, positions: source.positions.map(item => ({ ...item })), orders: [...source.orders] };
  for (const position of ledger.positions) {
    const price = prices.get(`${position.instrumentId}:${position.outcome || ''}`) ?? prices.get(position.instrumentId);
    if (price != null && Number.isFinite(price) && price > 0) position.currentPrice = price;
  }
  return ledger;
}

export function calculateUnifiedPerformance(ledger: UnifiedPaperLedger): {
  cash: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalTrades: number;
  winRate: number;
  maxDrawdownPct: number;
  positions: number;
  feeSlippageTotal: number;
  isRecovered: boolean;
  concentrationPct: number;
  attributionByAsset: Record<UnifiedPaperInstrumentType, number>;
  marketExposure: Record<UnifiedPaperInstrumentType, number>;
  strategyAttribution: Record<string, number>;
  stressTests: Array<{ shockPct: number; equity: number; totalPnl: number }>;
} {
  const positions = Array.isArray(ledger.positions) ? ledger.positions : [];
  const orders = Array.isArray(ledger.orders) ? ledger.orders : [];
  const unrealizedPnl = positions.reduce((sum, position) => sum + ((position.currentPrice || 0) - (position.averageEntryPrice || 0)) * (position.quantity || 0), 0);
  const positionValues = positions.map(position => (position.currentPrice || 0) * (position.quantity || 0));
  const positionsValue = positionValues.reduce((sum, value) => sum + value, 0);
  const equity = (ledger.cash || 0) + positionsValue;
  const closed = orders.filter(order => order.side === 'SELL' && Number.isFinite(order.pnlUsd));
  const wins = closed.filter(order => (order.pnlUsd || 0) > 0).length;
  const feeSlippageTotal = orders.reduce((sum, order) => sum + orderCosts(order), 0);
  const attributionByAsset: Record<UnifiedPaperInstrumentType, number> = { stock: 0, option: 0, crypto: 0, prediction: 0 };
  const marketExposure: Record<UnifiedPaperInstrumentType, number> = { stock: 0, option: 0, crypto: 0, prediction: 0 };
  const strategyAttribution: Record<string, number> = {};
  for (const order of closed) if (order.instrumentType) attributionByAsset[order.instrumentType] += Number(order.pnlUsd) || 0;
  for (const position of positions) {
    if (position.instrumentType) attributionByAsset[position.instrumentType] += ((position.currentPrice || 0) - (position.averageEntryPrice || 0)) * (position.quantity || 0);
    if (position.instrumentType) marketExposure[position.instrumentType] += (position.currentPrice || 0) * (position.quantity || 0);
  }
  for (const order of orders) {
    const strategy = String(order.strategy || 'unattributed');
    strategyAttribution[strategy] = (strategyAttribution[strategy] || 0) + (order.side === 'SELL' ? Number(order.pnlUsd) || 0 : 0) - orderCosts(order);
    if (order.instrumentType) attributionByAsset[order.instrumentType] -= orderCosts(order);
  }
  const largestPositionValue = positionValues.length ? Math.max(...positionValues) : 0;
  const stressTests = [-10, -5, 5].map(shockPct => ({
    shockPct,
    equity: round(equity + positionsValue * (shockPct / 100), 2),
    totalPnl: round(ledger.realizedPnl + unrealizedPnl + positionsValue * (shockPct / 100) - feeSlippageTotal, 2),
  }));
  return {
    cash: round(ledger.cash, 2),
    equity: round(equity, 2),
    realizedPnl: round(ledger.realizedPnl, 2),
    unrealizedPnl: round(unrealizedPnl, 2),
    totalPnl: round(ledger.realizedPnl + unrealizedPnl - feeSlippageTotal, 2),
    totalTrades: ledger.orders.length,
    winRate: closed.length ? round(wins / closed.length, 4) : 0,
    maxDrawdownPct: round(ledger.maxDrawdownPct, 2),
    positions: ledger.positions.length,
    feeSlippageTotal: round(feeSlippageTotal, 2),
    isRecovered: equity >= ledger.peakEquity,
    concentrationPct: equity > 0 ? round((largestPositionValue / equity) * 100, 2) : 0,
    attributionByAsset: {
      stock: round(attributionByAsset.stock, 2),
      option: round(attributionByAsset.option, 2),
      crypto: round(attributionByAsset.crypto, 2),
      prediction: round(attributionByAsset.prediction, 2),
    },
    marketExposure: {
      stock: round(marketExposure.stock, 2),
      option: round(marketExposure.option, 2),
      crypto: round(marketExposure.crypto, 2),
      prediction: round(marketExposure.prediction, 2),
    },
    strategyAttribution: Object.fromEntries(Object.entries(strategyAttribution).map(([key, value]) => [key, round(value, 2)])),
    stressTests,
  };
}

export function replayUnifiedPaperOrders(input: { startingCash?: number; orders: UnifiedPaperOrder[]; prices?: Record<string, unknown> }): UnifiedPaperLedger {
  if (!Array.isArray(input.orders)) throw new Error('复盘订单必须是数组');
  if (input.prices) {
    for (const order of input.orders) if (!(order.instrumentId in input.prices)) throw new Error(`缺少 ${order.instrumentId} 的历史价格，无法复盘`);
  }
  return input.orders.slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).reduce(applyUnifiedPaperOrder, emptyUnifiedPaperLedger(input.startingCash));
}

export class UnifiedPaperLedgerStore {
  constructor(private readonly store: SQLiteStateStore = stateStore) {}
  get(): UnifiedPaperLedger { return this.store.get<UnifiedPaperLedger>('paper-ledger') || emptyUnifiedPaperLedger(); }
  apply(order: UnifiedPaperOrder): UnifiedPaperLedger {
    return this.store.transaction(() => {
      const ledger = this.get();
      const existing = order.id && ledger.orders.find(item => item.id === order.id);
      if (existing) {
        const fields = ['instrumentId', 'instrumentType', 'side', 'outcome', 'price', 'quantity', 'timestamp', 'feeUsd', 'slippageUsd', 'strategy', 'reason'] as const;
        if (fields.some(key => existing[key] !== order[key])) throw new Error('重复订单 ID 的内容不一致');
        return ledger;
      }
      const next = applyUnifiedPaperOrder(ledger, { ...order, id: order.id || randomUUID() });
      this.store.set('paper-ledger', next, 2);
      return next;
    });
  }
  markPrices(prices: Map<string, number>): UnifiedPaperLedger {
    return this.store.transaction(() => {
      const next = markUnifiedPaperPrices(this.get(), prices);
      this.store.set('paper-ledger', next, 2);
      return next;
    });
  }
  reset(startingCash?: number): UnifiedPaperLedger { const ledger = emptyUnifiedPaperLedger(startingCash); this.store.set('paper-ledger', ledger, 2); return ledger; }
  performance() { return calculateUnifiedPerformance(this.get()); }
  migrateLegacyPredictionPortfolio(legacy: LegacyPredictionPortfolio): UnifiedPaperLedger {
    return this.store.transaction(() => {
      const current = this.get();
      const marker = this.store.get<{ startingBalance?: number }>('paper-ledger-legacy-migration-v1');
      if (marker) return current;
      const legacyStarting = Math.max(0, Number(legacy?.startingBalance) || 0);
      let ledger: UnifiedPaperLedger = {
        ...current,
        startingCash: round(current.startingCash + legacyStarting),
        cash: round(current.cash + legacyStarting),
        positions: current.positions.map(item => ({ ...item })),
        orders: [...current.orders],
      };
      for (const position of Array.isArray(legacy?.positions) ? legacy.positions : []) {
        if (!position || !Number.isFinite(position.quantity) || position.quantity <= 0) continue;
        const instrumentId = `prediction:predictfun:${position.marketId}`;
        const outcome = position.outcomeIndex === 0 ? 'YES' : 'NO';
        ledger = applyUnifiedPaperOrder(ledger, {
          id: `legacy:${position.id}:entry`, instrumentId, instrumentType: 'prediction', title: position.marketTitle,
          side: outcome, price: position.entryPrice, quantity: position.quantity, timestamp: position.entryTime,
        });
        if (position.status === 'CLOSED' && Number.isFinite(position.exitPrice)) {
          ledger = applyUnifiedPaperOrder(ledger, {
            id: `legacy:${position.id}:exit`, instrumentId, instrumentType: 'prediction', title: position.marketTitle,
            side: 'SELL', outcome, price: position.exitPrice!, quantity: position.quantity,
            timestamp: position.exitTime || position.entryTime,
          });
        }
      }
      this.store.set('paper-ledger', ledger, 2);
      this.store.set('paper-ledger-legacy-migration-v1', { startingBalance: legacyStarting }, 1);
      return ledger;
    });
  }
}

export const unifiedPaperLedgerStore = new UnifiedPaperLedgerStore();
