import crypto from 'node:crypto';
import type { MarketId } from './research-contracts';
import type { PortfolioRow } from './decision-intelligence';

export interface PortfolioValuationSnapshot {
  id: string;
  market: MarketId;
  accountSource: string;
  accountId: string | null;
  capturedAt: string;
  source: 'manual/CSV portfolio import';
  currencyValues: Record<string, number>;
  positions: Array<{ instrument: string; quantity: number; price: number; currency: string; value: number }>;
  cashFlows: Array<{ at: string; amount: number; currency: string }>;
  contentHash: string;
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function capturePortfolioSnapshots(rows: readonly PortfolioRow[], capturedAt = new Date().toISOString()): PortfolioValuationSnapshot[] {
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error('快照时间无效');
  const groups = new Map<string, PortfolioRow[]>();
  for (const row of rows) {
    const key = [row.market, row.accountSource || 'unlinked-source', row.accountId || 'unlinked-account'].join('\0');
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const first = group[0];
    const positions = group.map(row => ({
      instrument: row.instrument,
      quantity: row.quantity,
      price: row.price,
      currency: row.currency || 'UNKNOWN',
      value: row.quantity * row.price,
    })).sort((left, right) => left.instrument.localeCompare(right.instrument) || left.currency.localeCompare(right.currency));
    const currencyValues = Object.fromEntries([...new Set(positions.map(row => row.currency))].sort().map(currency => [
      currency,
      Number(positions.filter(row => row.currency === currency).reduce((sum, row) => sum + row.value, 0).toPrecision(14)),
    ]));
    const cashFlows = [...new Map(group.flatMap(row => row.cashFlows || []).map(flow => [
      `${flow.at}\0${flow.currency}\0${flow.amount}`,
      { at: flow.at, amount: flow.amount, currency: flow.currency },
    ])).values()].sort((left, right) => left.at.localeCompare(right.at));
    const content = {
      market: first.market, accountSource: first.accountSource || 'unlinked-source', accountId: first.accountId || null,
      positions, currencyValues, cashFlows,
    };
    return {
      id: `pvs_${crypto.randomUUID()}`,
      ...content,
      capturedAt,
      source: 'manual/CSV portfolio import' as const,
      contentHash: sha256(content),
    };
  }).sort((left, right) => left.market.localeCompare(right.market) || left.accountSource.localeCompare(right.accountSource) || String(left.accountId).localeCompare(String(right.accountId)));
}

export function comparePortfolioSnapshots(before: PortfolioValuationSnapshot, after: PortfolioValuationSnapshot) {
  if (before.market !== after.market || before.accountSource !== after.accountSource || before.accountId !== after.accountId) {
    throw new Error('只能比较同一市场、来源和账户的快照');
  }
  if (Date.parse(before.capturedAt) >= Date.parse(after.capturedAt)) throw new Error('快照必须按时间先后比较');
  if (!before.accountId) {
    return {
      market: before.market, metric: 'valuation_change' as const, dataStatus: 'unavailable' as const,
      currencies: {}, holdingsChanged: null, cashFlowsBetweenSnapshots: null, investmentReturnPct: null,
      reason: '账户身份未关联，不能确认两次快照属于同一账户；估值变化不等于投资收益。',
    };
  }
  const beforeCurrencies = Object.keys(before.currencyValues).sort();
  const afterCurrencies = Object.keys(after.currencyValues).sort();
  const commonCurrencies = beforeCurrencies.filter(currency => Object.hasOwn(after.currencyValues, currency));
  const currencies = Object.fromEntries(commonCurrencies.map(currency => {
    const previous = before.currencyValues[currency];
    const current = after.currencyValues[currency];
    return [currency, {
      before: previous,
      after: current,
      delta: Number((current - previous).toPrecision(14)),
      deltaPct: previous > 0 ? Number(((current / previous - 1) * 100).toFixed(4)) : null,
    }];
  }));
  const positionsByIdentity = (snapshot: PortfolioValuationSnapshot) => new Map(snapshot.positions.map(position => [
    `${position.instrument}\0${position.currency}`, position.quantity,
  ]));
  const previousPositions = positionsByIdentity(before);
  const currentPositions = positionsByIdentity(after);
  const holdingsChanged = previousPositions.size !== currentPositions.size || [...previousPositions].some(([key, quantity]) => currentPositions.get(key) !== quantity);
  const beforeAt = Date.parse(before.capturedAt);
  const afterAt = Date.parse(after.capturedAt);
  const cashFlowsBetweenSnapshots = after.cashFlows.filter(flow => Date.parse(flow.at) > beforeAt && Date.parse(flow.at) <= afterAt).length;
  const currenciesChanged = beforeCurrencies.length !== afterCurrencies.length || beforeCurrencies.some(currency => !afterCurrencies.includes(currency));
  const reasons = ['估值变化不等于投资收益；未计算投资回报率。'];
  if (holdingsChanged) reasons.push('两次快照的持仓数量或标的不同');
  if (cashFlowsBetweenSnapshots) reasons.push(`区间内记录到 ${cashFlowsBetweenSnapshots} 项现金流`);
  if (currenciesChanged) reasons.push('币种集合发生变化，仅展示两次快照共有币种');
  if (!commonCurrencies.length) reasons.push('没有可比较的共同币种');
  return {
    market: before.market,
    metric: 'valuation_change' as const,
    dataStatus: commonCurrencies.length ? currenciesChanged ? 'partial' as const : 'historical' as const : 'unavailable' as const,
    beforeId: before.id,
    afterId: after.id,
    beforeAt: before.capturedAt,
    afterAt: after.capturedAt,
    currencies,
    holdingsChanged,
    cashFlowsBetweenSnapshots,
    investmentReturnPct: null,
    reason: reasons.join('；'),
  };
}

export function appendPortfolioSnapshots<T extends { id: string }>(current: readonly T[], incoming: readonly T[], limit = 500): T[] {
  const boundedLimit = Math.max(1, Math.min(5_000, Math.trunc(limit) || 500));
  const byId = new Map<string, T>();
  for (const item of [...current, ...incoming]) byId.set(item.id, item);
  return [...byId.values()].slice(-boundedLimit);
}
