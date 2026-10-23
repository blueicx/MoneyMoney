import type { AiRunner } from './ai-paper-runner';
import type { UnifiedPaperRunnerAccount } from './unified-paper-trading';
import { matchesPaperOrderHistoryProof } from './paper-split-replay';
import { samePaperStock, type PaperLifecycleEvent } from './paper-account-lifecycle';

const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1e-7, Math.abs(b) * 1e-9);
const paidIncome = (account: UnifiedPaperRunnerAccount) => (account.corporateReceivables || [])
  .filter(row => row.status === 'paid' && row.currency === 'USD').reduce((sum, row) => sum + row.amount, 0);

const appliedSplits = (account: UnifiedPaperRunnerAccount) => (account.lifecycleEvents || []).filter(row => row.kind === 'split' && row.status === 'applied');
const factorFor = (events: PaperLifecycleEvent[], instrument: string, start: string, end?: string) => events
  .filter(row => samePaperStock(row.instrument, instrument) && Date.parse(row.effectiveAt) > Date.parse(start)
    && (!end || Date.parse(row.effectiveAt) < Date.parse(end)))
  .reduce((factor, row) => factor * Number(row.factor), 1);

/** Manual source-backed cash/open-lot adapter. Never infer missing execution links or partial exits. */
export function synchronizeRunnerCorporateActions(runner: AiRunner, before: UnifiedPaperRunnerAccount,
  after: UnifiedPaperRunnerAccount): AiRunner | null {
  if (runner.venue !== 'Stocks' || runner.universe?.market !== 'stocks' || runner.executionState !== 'ready'
    || runner.id !== before.runnerId || (runner.accountId || `ai-runner:${runner.id}`) !== before.accountId
    || !matchesPaperOrderHistoryProof(before.orders, before.orderHistoryProof)
    || !close(runner.cashUsd, before.cash) || !close(runner.corporateIncomeUsd ?? 0, paidIncome(before))
    || !Array.isArray(runner.positions) || !Array.isArray(runner.trades)) return null;
  const frozen = runner.universe?.instruments;
  if (frozen != null && (!Array.isArray(frozen) || !frozen.length || frozen.some(row => row.venue !== 'Stocks'
    || !samePaperStock(row.symbolOrMarketId, row.symbolOrMarketId))
    || before.orders.some(order => !frozen.some(row => samePaperStock(row.symbolOrMarketId, order.instrumentId))))) return null;
  for (const key of ['orders', 'realizedPnl'] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) return null;
  }
  if (JSON.stringify(before.corporateCostAdjustments || []) !== JSON.stringify(after.corporateCostAdjustments || [])) return null;
  const oldSplits = appliedSplits(before), splits = appliedSplits(after);
  const addedSplits = splits.filter(row => !oldSplits.some(prior => prior.actionId === row.actionId));
  if (splits.some(row => !Number.isFinite(row.factor) || !(row.factor! > 0) || !Number.isFinite(Date.parse(row.effectiveAt)))
    || new Set(splits.map(row => row.actionId)).size !== splits.length) return null;
  const oldEvents = new Map((before.lifecycleEvents || []).map(row => [row.id, row]));
  if ((after.lifecycleEvents || []).some(row => JSON.stringify(oldEvents.get(row.id)) !== JSON.stringify(row)
    && row.kind !== 'dividend' && !(row.kind === 'split' && row.status === 'applied'))) return null;
  const orders = new Map(before.orders.map(row => [row.id, row]));
  if (orders.size !== before.orders.length || orders.has(undefined)
    || before.orders.some(row => row.instrumentType !== 'stock' || row.contractMultiplier != null)) return null;
  const linked = new Set<string>();
  for (const lot of runner.positions) {
    if (!['OPEN', 'CLOSED'].includes(lot.status) || !(lot.quantity > 0) || lot.contractMultiplier != null
      || lot.side != null && lot.side !== 'LONG') return null;
    const entry = orders.get(lot.entryOrderId);
    const oldFactor = entry ? factorFor(oldSplits, entry.instrumentId, entry.timestamp, lot.status === 'CLOSED' ? lot.exitTime : undefined) : NaN;
    if (!entry || !entry.id || linked.has(entry.id) || entry.side !== 'BUY' || entry.instrumentId !== lot.instrumentId
      || !close(entry.price / oldFactor, lot.entryPrice) || !close(entry.quantity * oldFactor, lot.quantity)
      || entry.timestamp !== lot.entryTime) return null;
    if (lot.instrument && (lot.instrument.venue !== 'Stocks' || !samePaperStock(lot.instrument.symbolOrMarketId, entry.instrumentId))) return null;
    if (splits.some(row => samePaperStock(row.instrument, entry.instrumentId)
      && [entry.timestamp, lot.exitTime].some(at => at && Date.parse(at) === Date.parse(row.effectiveAt)))) return null;
    linked.add(entry.id);
    if (lot.status === 'CLOSED') {
      const exit = orders.get(lot.exitOrderId);
      if (!exit || !exit.id || linked.has(exit.id) || exit.side !== 'SELL' || exit.instrumentId !== lot.instrumentId
        || !close(exit.price, lot.exitPrice!) || !close(exit.quantity, lot.quantity)
        || exit.timestamp !== lot.exitTime) return null;
      linked.add(exit.id);
      if (addedSplits.some(row => samePaperStock(row.instrument, entry.instrumentId)
        && Date.parse(row.effectiveAt) > Date.parse(entry.timestamp) && Date.parse(row.effectiveAt) < Date.parse(lot.exitTime!))) return null;
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
  const consistent = (lotsInput: AiRunner['positions'], account: UnifiedPaperRunnerAccount) => {
   const open = lotsInput.filter(row => row.status === 'OPEN');
   const identities = new Set([...open.map(row => row.instrumentId), ...account.positions.map(row => row.instrumentId)]);
   for (const identity of identities) {
    const lots = open.filter(row => row.instrumentId === identity), positions = account.positions.filter(row => row.instrumentId === identity);
    const quantity = lots.reduce((sum, row) => sum + row.quantity, 0);
    if (positions.length !== 1 || positions[0].instrumentType !== 'stock' || !close(quantity, positions[0].quantity)
      || !close(lots.reduce((sum, row) => sum + row.quantity * row.entryPrice, 0), quantity * positions[0].averageEntryPrice)) return false;
   }
   return true;
  };
  if (!consistent(runner.positions, before)) return null;
  const positions = runner.positions.map(lot => {
    const affected = lot.status === 'OPEN' ? addedSplits.filter(row => samePaperStock(row.instrument, lot.instrumentId)
      && Date.parse(row.effectiveAt) > Date.parse(lot.entryTime)) : [];
    const factor = lot.status === 'OPEN' ? factorFor(addedSplits, lot.instrumentId!, lot.entryTime) : 1;
    if (!affected.length) return lot;
    const mark = after.positions.find(row => row.instrumentId === lot.instrumentId)!;
    return { ...lot, quantity: lot.quantity * factor, entryPrice: lot.entryPrice / factor,
      currentPrice: mark?.currentPrice, markStatus: mark?.markStatus, markUpdatedAt: mark?.markUpdatedAt, markSource: mark?.markSource,
      corporateActionIds: [...new Set([...(lot.corporateActionIds || []), ...affected.map(row => row.actionId)])] };
  });
  if (positions.some((lot, index) => lot !== runner.positions[index] && (!Number.isFinite(lot.currentPrice) || !(lot.currentPrice! > 0)))) return null;
  if (!consistent(positions, after)) return null;
  const benchmarks = { ...(runner.benchmarks || {}) };
  for (const [key, row] of Object.entries(benchmarks)) {
    if (row.market !== 'stocks' || !samePaperStock(row.instrument, row.instrument)
      || frozen && !frozen.some(item => samePaperStock(item.symbolOrMarketId, row.instrument))) return null;
    const relevant = addedSplits.filter(event => samePaperStock(event.instrument, row.instrument));
    if (!relevant.length) continue;
    if (row.market !== 'stocks' || !Number.isFinite(Date.parse(row.observedAt)) || !Number.isFinite(Date.parse(row.updatedAt))
      || Date.parse(row.updatedAt) < Date.parse(row.observedAt) || !(row.startPrice > 0) || !(row.currentPrice > 0)
      || relevant.some(event => [row.observedAt, row.updatedAt].some(at => Date.parse(at) === Date.parse(event.effectiveAt)))) return null;
    benchmarks[key] = { ...row, startPrice: row.startPrice / factorFor(relevant, row.instrument, row.observedAt),
      currentPrice: row.currentPrice / factorFor(relevant, row.instrument, row.updatedAt),
      corporateAdjustmentAt: new Date(Math.max(Date.parse(row.corporateAdjustmentAt || '') || 0, ...relevant.map(event => Date.parse(event.effectiveAt)))).toISOString(),
      corporateAdjustmentPendingQuote: relevant.some(event => Date.parse(row.updatedAt) < Date.parse(event.effectiveAt)) || row.corporateAdjustmentPendingQuote === true,
      corporateActionIds: [...new Set([...(row.corporateActionIds || []), ...relevant.map(event => event.actionId)])] };
    if (!Number.isFinite(benchmarks[key].startPrice) || !Number.isFinite(benchmarks[key].currentPrice)) return null;
  }
  const income = paidIncome(after);
  if (!close(after.cash - before.cash, income - paidIncome(before)) || income < paidIncome(before)) return null;
  const changedOpen = positions.some((lot, index) => lot !== runner.positions[index] && lot.status === 'OPEN');
  const marks = positions.filter(lot => lot.status === 'OPEN').map(lot => lot.markStatus);
  const valuationStatus = marks.some(status => !status || status === 'stale' || status === 'unavailable') ? 'stale'
    : marks.includes('cached') ? 'cached' : marks.includes('delayed') ? 'delayed' : 'live';
  return { ...runner, cashUsd: after.cash, corporateIncomeUsd: income,
    ...(addedSplits.length ? { positions, ...(runner.benchmarks ? { benchmarks } : {}),
      ...(changedOpen ? {
        lastDataStatus: valuationStatus, lastDataReason: valuationStatus === 'stale' ? '公司行动已核验，持仓暂用拆股调整历史参考价，等待有效报价' : '公司行动核验后保留来源原有估值状态和时间',
      } : {}) } : {}) };
}

/** Compatibility for the original dividend-only integration. */
export const synchronizeRunnerDividend = synchronizeRunnerCorporateActions;
