/** Cost-basis replay only. Original executions, fees and cash are never rewritten. */
import { createHash } from 'node:crypto';

export interface PaperOrderHistoryProof { version: 1; origin: 'empty-ledger'; count: number; hash: string }
export function createPaperOrderHistoryProof(orders: unknown[]): PaperOrderHistoryProof {
  const canonical = JSON.stringify(orders, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return { version: 1, origin: 'empty-ledger', count: orders.length, hash: createHash('sha256').update(canonical).digest('hex') };
}
export function matchesPaperOrderHistoryProof(orders: unknown[], proof?: PaperOrderHistoryProof): boolean {
  return proof?.version === 1 && proof.origin === 'empty-ledger' && proof.count === orders.length && proof.hash === createPaperOrderHistoryProof(orders).hash;
}

export interface PaperCorporateCostAdjustment {
  orderId: string;
  instrumentId: string;
  originalPnlUsd: number;
  adjustedPnlUsd: number;
  actionIds: string[];
}

type Row = Record<string, any>;
type Split = { actionId: string; effectiveAt: string; factor?: number };
const round = (value: number) => Math.round(value * 1e8) / 1e8;
const equal = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1e-7, Math.abs(b) * 1e-9);

function replay(orders: Row[], splits: Split[]) {
  let quantity = 0, averageEntryPrice = 0, realizedPnl = 0, cyclePnl = 0, splitIndex = 0;
  let openedAt = '', invalid = false;
  const sales = new Map<string, number>();
  const sequence = [...splits].sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt));
  const applySplitsUntil = (at: number) => {
    while (splitIndex < sequence.length && Date.parse(sequence[splitIndex].effectiveAt) < at) {
      const factor = sequence[splitIndex++].factor!;
      const held = quantity > 0;
      quantity = round(quantity * factor);
      averageEntryPrice = quantity > 0 ? round(averageEntryPrice / factor) : 0;
      if (held && (!(quantity > 0) || !Number.isFinite(quantity) || !(averageEntryPrice > 0) || !Number.isFinite(averageEntryPrice))) invalid = true;
    }
  };
  for (const order of orders) {
    applySplitsUntil(Date.parse(order.timestamp));
    if (invalid) return null;
    if (order.side === 'BUY') {
      if (!quantity) { openedAt = order.timestamp; cyclePnl = 0; }
      averageEntryPrice = round((quantity * averageEntryPrice + order.quantity * order.price) / (quantity + order.quantity));
      quantity = round(quantity + order.quantity);
    } else {
      if (order.quantity > quantity + 1e-8) return null;
      const pnl = round((order.price - averageEntryPrice) * order.quantity);
      sales.set(order.id, pnl); realizedPnl = round(realizedPnl + pnl); cyclePnl = round(cyclePnl + pnl);
      quantity = round(quantity - order.quantity);
      if (quantity <= 1e-8) { quantity = 0; averageEntryPrice = 0; }
    }
  }
  applySplitsUntil(Infinity);
  if (invalid) return null;
  return { quantity, averageEntryPrice, realizedPnl, cyclePnl, openedAt, sales };
}

export function replayLatePaperSplit(input: {
  orders: Row[]; positions: Row[]; priorSplits: Split[]; split: Split;
  corrections: PaperCorporateCostAdjustment[];
  now: number;
}) {
  const { orders: raw, positions, priorSplits, split, corrections } = input;
  if (!raw.length || positions.length > 1) return null;
  const orders = [...raw].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const splits = [...priorSplits, split];
  if (splits.some(item => !Number.isFinite(item.factor) || item.factor! <= 0 || !Number.isFinite(Date.parse(item.effectiveAt)))) return null;
  if (new Set(splits.map(item => item.actionId)).size !== splits.length) return null;
  if (new Set(orders.map(order => order.id)).size !== orders.length) return null;
  const times = orders.map(order => Date.parse(order.timestamp));
  // Unknown ordering at a boundary (or within a timestamp) cannot be guessed.
  if (new Set(times).size !== times.length) return null;
  if (orders.some(order => typeof order.id !== 'string' || !order.id.trim() || !Number.isFinite(Date.parse(order.timestamp))
    || !['BUY', 'SELL'].includes(order.side) || !Number.isFinite(order.price) || order.price <= 0
    || !Number.isFinite(order.quantity) || order.quantity <= 0 || order.contractMultiplier != null
    || splits.some(item => Date.parse(item.effectiveAt) === Date.parse(order.timestamp)))) return null;
  if (!orders.some(order => Date.parse(order.timestamp) < Date.parse(split.effectiveAt))) return null;
  const before = replay(orders, priorSplits), after = replay(orders, splits);
  if (!before || !after || !Number.isFinite(after.realizedPnl) || !Number.isFinite(after.quantity) || !Number.isFinite(after.averageEntryPrice)) return null;
  const position = positions[0];
  if (before.quantity > 0 ? !position || !equal(position.quantity, before.quantity) || !equal(position.averageEntryPrice, before.averageEntryPrice)
    || !equal(position.realizedPnl, before.cyclePnl) : Boolean(position)) return null;
  const matchingCorrections = corrections.filter(row => orders.some(order => order.id === row.orderId));
  if (new Set(matchingCorrections.map(row => row.orderId)).size !== matchingCorrections.length) return null;
  for (const order of orders.filter(row => row.side === 'SELL')) {
    const correction = matchingCorrections.find(row => row.orderId === order.id);
    if (correction && (correction.instrumentId !== order.instrumentId || correction.originalPnlUsd !== order.pnlUsd)) return null;
    if (!equal(correction?.adjustedPnlUsd ?? order.pnlUsd, before.sales.get(order.id)!)) return null;
  }
  // A fully closed position becoming open would require inventing position metadata.
  if (!position && after.quantity > 0) return null;
  const nextPosition: Row | null = position && after.quantity > 0 ? { ...position, quantity: after.quantity, averageEntryPrice: after.averageEntryPrice,
    realizedPnl: after.cyclePnl, openedAt: after.openedAt } : null;
  const latestSplitAt = Math.max(...splits.map(item => Date.parse(item.effectiveAt)));
  const markAt = Date.parse(position?.markUpdatedAt);
  if (nextPosition && !(markAt >= latestSplitAt && markAt <= input.now && Number.isFinite(position.currentPrice) && position.currentPrice > 0)) {
    const last = orders[orders.length - 1];
    nextPosition.currentPrice = splits.filter(item => Date.parse(item.effectiveAt) > Date.parse(last.timestamp)).reduce((price, item) => price / item.factor!, last.price);
    nextPosition.markUpdatedAt = last.timestamp;
    nextPosition.markStatus = 'stale';
    nextPosition.markSource = '历史模拟成交 execution；非当前市场报价';
  }
  const adjustments: PaperCorporateCostAdjustment[] = orders.filter(order => order.side === 'SELL' && !equal(order.pnlUsd, after.sales.get(order.id)!))
    .map(order => ({ orderId: order.id, instrumentId: order.instrumentId, originalPnlUsd: order.pnlUsd,
      adjustedPnlUsd: after.sales.get(order.id)!, actionIds: splits.map(item => item.actionId) }));
  return { position: nextPosition, realizedPnlDelta: round(after.realizedPnl - before.realizedPnl), adjustments };
}

export function effectivePaperOrderPnl(order: { id?: string; instrumentId: string; pnlUsd?: number }, corrections?: PaperCorporateCostAdjustment[]): number | undefined {
  const match = corrections?.find(row => row.orderId === order.id && row.instrumentId === order.instrumentId && row.originalPnlUsd === order.pnlUsd);
  return match && Number.isFinite(match.adjustedPnlUsd) ? match.adjustedPnlUsd : order.pnlUsd;
}
