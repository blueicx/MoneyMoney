import { assertMarketContext, type MarketId } from './research-contracts';

interface OptionSnapshot { id: string; market: 'options'; instrument: string; source: string; fetchedAt: string; snapshot: { expiries: Array<{ expiryMs: number; rows: Array<Record<string, any>> }> } }
export function compareOptionSnapshots(input: OptionSnapshot[]) {
  for (const row of input) assertMarketContext({ market: row.market, instrument: row.instrument, workspace: 'options-history' });
  if (new Set(input.map(row => `${row.instrument}|${row.source}`)).size > 1) throw new Error('仅可比较同一标的和来源的快照');
  const ordered = input.slice().sort((a,b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt));
  const fields = ['bidPrice', 'askPrice', 'markPrice', 'premiumUsd', 'impliedVolPct', 'volume', 'openInterest'];
  const contracts = (snapshot: OptionSnapshot) => {
    const entries: Array<[string, Record<string, any>]> = [];
    for (const expiry of snapshot.snapshot.expiries) for (const row of expiry.rows) {
      if (!row.instrumentName || !Number.isFinite(expiry.expiryMs) || !Number.isFinite(row.strike) || !['call', 'put'].includes(row.optionType)) continue;
      entries.push([`${row.instrumentName}|${expiry.expiryMs}|${row.strike}|${row.optionType}`, row]);
    }
    return new Map(entries);
  };
  return { coverage: ordered.map(row => ({ id: row.id, at: row.fetchedAt, source: row.source })), changes: ordered.slice(1).map((after, index) => {
    const before = ordered[index], old = contracts(before), current = contracts(after);
    return { from: before.id, to: after.id, fromAt: before.fetchedAt, toAt: after.fetchedAt,
      contracts: [...current.entries()].flatMap(([identity, row]) => {
        const previous = old.get(identity); if (!previous) return [];
        return [{ identity, contract: row.instrumentName, fields: Object.fromEntries(fields.map(field => {
          const valid = typeof previous[field] === 'number' && Number.isFinite(previous[field]) && typeof row[field] === 'number' && Number.isFinite(row[field]);
          return [field, { before: previous[field] ?? null, after: row[field] ?? null, delta: valid ? Number((row[field] - previous[field]).toPrecision(12)) : null, reason: valid ? null : '字段缺失' }];
        })) }];
      }), newContracts: [...current.keys()].filter(id => !old.has(id)), missingContracts: [...old.keys()].filter(id => !current.has(id)),
    };
  }), reason: ordered.length < 2 ? '不足两个真实快照，尚不能比较历史变化' : null };
}
interface HistoryEvidence { id: string; market: MarketId; instrument?: string; source: { id: string; name: string; url?: string | null }; observedAt: string; fields: Record<string, unknown>; dataStatus?: string }
export function summarizeMarketHistory(input: HistoryEvidence[], market: MarketId, instrument: string) {
  assertMarketContext({ market, instrument, workspace: 'market-history' });
  const series = input.filter(row => row.market === market && row.instrument === instrument && !['failed','empty','unavailable'].includes(row.dataStatus || '') && Number.isFinite(Date.parse(row.observedAt)))
    .map(row => {
      const fields = { ...row.fields };
      if (market === 'prediction' && (fields.settlementEvidenceOfficial !== true || !/^https:\/\//.test(String(fields.settlementEvidenceUrl || '')))) fields.settlementStatus = 'unknown';
      return { ...row, fields };
    }).sort((a,b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const changes: Array<{ from: string; to: string; source: string; at: string; deltas: Record<string, number>; revisions: string[] }> = [];
  const previous = new Map<string, typeof series[number]>();
  for (const row of series) {
    const before = previous.get(row.source.id);
    if (before) {
      const deltas: Record<string, number> = {};
      for (const key of ['fundingRatePct','openInterestUsd','spreadPct','bidDepthUsd','askDepthUsd','probability','liquidity']) {
        if (typeof row.fields[key] === 'number' && typeof before.fields[key] === 'number' && Number.isFinite(row.fields[key]) && Number.isFinite(before.fields[key])) deltas[key] = Number(((row.fields[key] as number) - (before.fields[key] as number)).toPrecision(12));
      }
      const revisions = ['deadline','rules','settlementStatus'].filter(key => row.fields[key] !== undefined && before.fields[key] !== undefined && row.fields[key] !== before.fields[key]);
      changes.push({ from: before.id, to: row.id, source: row.source.name, at: row.observedAt, deltas, revisions });
    }
    previous.set(row.source.id, row);
  }
  return { market, instrument, series, changes, dataStatus: series.length ? 'historical' : 'empty', reason: series.length ? null : '当前标的尚无真实来源快照；仅从打开或监控后开始积累，不生成历史数据' };
}
