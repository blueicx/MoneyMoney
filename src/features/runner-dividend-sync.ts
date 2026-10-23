import type { AiRunner } from './ai-paper-runner';
import type { UnifiedPaperRunnerAccount } from './unified-paper-trading';
import { matchesPaperOrderHistoryProof } from './paper-split-replay';

const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-7;
const paidIncome = (account: UnifiedPaperRunnerAccount) => (account.corporateReceivables || [])
  .filter(row => row.status === 'paid' && row.currency === 'USD').reduce((sum, row) => sum + row.amount, 0);

/** Manual dividend-only adapter. Never normalize runner configuration or infer missing order links. */
export function synchronizeRunnerDividend(runner: AiRunner, before: UnifiedPaperRunnerAccount,
  after: UnifiedPaperRunnerAccount): AiRunner | null {
  if (runner.venue !== 'Stocks' || runner.universe?.market !== 'stocks' || runner.executionState !== 'ready'
    || runner.id !== before.runnerId || (runner.accountId || `ai-runner:${runner.id}`) !== before.accountId
    || !matchesPaperOrderHistoryProof(before.orders, before.orderHistoryProof)
    || !close(runner.cashUsd, before.cash) || !close(runner.corporateIncomeUsd ?? 0, paidIncome(before))
    || !Array.isArray(runner.positions) || !Array.isArray(runner.trades)) return null;
  // Splits and other position/cost changes require a separate lot-level adapter.
  for (const key of ['positions', 'orders', 'realizedPnl', 'corporateCostAdjustments'] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) return null;
  }
  const oldEvents = new Set((before.lifecycleEvents || []).map(row => row.id));
  if ((after.lifecycleEvents || []).some(row => !oldEvents.has(row.id) && row.kind !== 'dividend')) return null;
  const orders = new Map(before.orders.map(row => [row.id, row]));
  if (orders.size !== before.orders.length || orders.has(undefined)
    || before.orders.some(row => row.instrumentType !== 'stock')) return null;
  const linked = new Set<string>();
  for (const lot of runner.positions) {
    if (!['OPEN', 'CLOSED'].includes(lot.status) || !(lot.quantity > 0)) return null;
    const entry = orders.get(lot.entryOrderId);
    if (!entry || !entry.id || linked.has(entry.id) || entry.side !== 'BUY' || entry.instrumentId !== lot.instrumentId
      || !close(entry.price, lot.entryPrice) || !close(entry.quantity, lot.quantity)
      || entry.timestamp !== lot.entryTime) return null;
    linked.add(entry.id);
    if (lot.status === 'CLOSED') {
      const exit = orders.get(lot.exitOrderId);
      if (!exit || !exit.id || linked.has(exit.id) || exit.side !== 'SELL' || exit.instrumentId !== lot.instrumentId
        || !close(exit.price, lot.exitPrice!) || !close(exit.quantity, lot.quantity)
        || exit.timestamp !== lot.exitTime) return null;
      linked.add(exit.id);
    }
  }
  if (linked.size !== orders.size || runner.trades.length !== orders.size) return null;
  const tradeIds = new Set<string>();
  for (const trade of runner.trades) {
    const order = orders.get(trade.orderId);
    if (!order?.id || tradeIds.has(order.id) || trade.action !== order.side || !close(trade.price, order.price)
      || !close(trade.quantity, order.quantity) || trade.timestamp !== order.timestamp) return null;
    tradeIds.add(order.id);
  }
  const open = runner.positions.filter(row => row.status === 'OPEN');
  const identities = new Set([...open.map(row => row.instrumentId), ...before.positions.map(row => row.instrumentId)]);
  for (const identity of identities) {
    const lots = open.filter(row => row.instrumentId === identity), positions = before.positions.filter(row => row.instrumentId === identity);
    const quantity = lots.reduce((sum, row) => sum + row.quantity, 0);
    if (positions.length !== 1 || positions[0].instrumentType !== 'stock' || !close(quantity, positions[0].quantity)
      || !close(lots.reduce((sum, row) => sum + row.quantity * row.entryPrice, 0), quantity * positions[0].averageEntryPrice)) return null;
  }
  const income = paidIncome(after);
  if (!close(after.cash - before.cash, income - paidIncome(before)) || income < paidIncome(before)) return null;
  return { ...runner, cashUsd: after.cash, corporateIncomeUsd: income };
}
