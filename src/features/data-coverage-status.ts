import type { MarketId } from './research-contracts';
import type { DataCoverage } from '../storage/data-lake';
import type { DashboardProviderResult } from './market-workspace-dashboard';

/** The options dashboard must not label catalogued but unreadable files as usable history. */
export function buildOptionsCoverageCard(input: readonly DataCoverage[]): DashboardProviderResult {
  const rows = input.filter(row=>row.market==='options' && row.dataset==='options-chain-snapshots');
  const available = rows.reduce((sum,row)=>sum+(row.availablePartitionCount ?? 0),0);
  const unavailable = rows.reduce((sum,row)=>sum+(row.unavailablePartitionCount ?? 0),0);
  const times = rows.flatMap(row=>row.availableLatestPublishedAt ? [row.availableLatestPublishedAt] : []).sort();
  return {
    market:'options', source:'MoneyMoney 本地数据湖',
    status:unavailable ? (available ? 'partial':'unavailable') : available ? 'historical' : rows.length ? 'unavailable':'empty',
    updatedAt:times.at(-1) ?? null,
    metrics:rows.length ? [
      {label:'可用合约行',value:rows.reduce((sum,row)=>sum+(row.availableRowCount ?? 0),0)},
      {label:'可用覆盖标的',value:rows.filter(row=>(row.availablePartitionCount ?? 0)>0).length},
      {label:'可用分区',value:available},{label:'隔离分区',value:unavailable},
    ] : [],
    reason:unavailable ? `${unavailable} 份历史快照损坏或未通过校验，保留原始证据；仅 ${available} 份快照可用于研究。`
      : available ? '只展示通过身份与内容Hash校验的真实期权链快照；历史不足时不推算 IV/Greeks。'
        : rows.length ? '目录已有登记，但尚无可核验的可用快照。' : '本地尚无真实期权链快照，不回填推测历史。',
    data:rows,
  };
}

export type CoverageSourceStatus = 'live' | 'delayed' | 'cached' | 'partial' | 'empty' | 'unavailable' | 'unsupported' | 'failed' | 'historical';

export interface CoverageSourceObservation {
  market: MarketId;
  instrument: string;
  checkedAt: string;
  status: CoverageSourceStatus;
  reason?: string | null;
  capabilities?: Record<string, { status: CoverageSourceStatus; reason?: string | null }>;
}

export interface PublishedCoverageStatus {
  partitionStatus: 'historical' | 'empty' | 'partial' | 'unavailable';
  sourceStatus: CoverageSourceStatus;
  dataStatus: CoverageSourceStatus;
  sourceCheckedAt: string | null;
  reason: string | null;
}

const USABLE = new Set<CoverageSourceStatus>(['live', 'delayed', 'cached']);
const FAILURES = new Set<CoverageSourceStatus>(['failed', 'unavailable', 'unsupported']);

function aggregateSourceStatus(statuses: CoverageSourceStatus[]): CoverageSourceStatus {
  if (!statuses.length) return 'unavailable';
  const usable = statuses.filter(status => USABLE.has(status));
  if (usable.length) {
    if (usable.length !== statuses.length) return 'partial';
    return statuses.includes('cached') ? 'cached' : statuses.includes('delayed') ? 'delayed' : 'live';
  }
  if (statuses.every(status => status === 'empty')) return 'empty';
  if (statuses.every(status => status === 'failed')) return 'failed';
  if (statuses.every(status => status === 'unsupported')) return 'unsupported';
  if (statuses.every(status => status === 'unavailable')) return 'unavailable';
  return 'partial';
}

/**
 * Combines local published-history evidence with current source observations without
 * allowing old partitions to imply that a provider is currently healthy.
 */
export function summarizePublishedCoverage(input: {
  market?: MarketId;
  instrument?: string;
  partitions: readonly { status?: string; rowCount?: number; partitionCount?: number; availablePartitionCount?: number; availableRowCount?: number; unavailablePartitionCount?: number; reason?: string | null }[];
  discrepancyCount?: number;
  observations?: readonly CoverageSourceObservation[];
  now?: string | Date;
  maxCanaryAgeMs?: number;
}): PublishedCoverageStatus {
  const nowMs = input.now instanceof Date ? input.now.getTime() : Date.parse(input.now || new Date().toISOString());
  if (!Number.isFinite(nowMs)) throw new Error('Coverage evaluation time is invalid');
  const hasHistory = input.partitions.some(row => row.availablePartitionCount !== undefined
    ? row.availablePartitionCount > 0 && Number(row.availableRowCount || 0) > 0
    : row.status === 'published' || Number(row.rowCount || 0) > 0 || Number(row.partitionCount || 0) > 0);
  const damagedHistory = input.partitions.some(row => Number(row.unavailablePartitionCount || 0) > 0);
  const partitionStatus = damagedHistory ? (hasHistory ? 'partial' : 'unavailable') : hasHistory ? 'historical' : 'empty';
  const observations = [...(input.observations || [])]
    .filter(item => (!input.market || item.market === input.market) && (!input.instrument || item.instrument === input.instrument))
    .filter(item => Number.isFinite(Date.parse(item.checkedAt)) && Date.parse(item.checkedAt) <= nowMs)
    .sort((left, right) => left.checkedAt.localeCompare(right.checkedAt));
  const latestPerTarget = new Map<string, CoverageSourceObservation>();
  for (const item of observations) latestPerTarget.set(`${item.market}\0${item.instrument}`, item);
  const latest = [...latestPerTarget.values()].sort((left, right) => left.checkedAt.localeCompare(right.checkedAt));
  const latestCheckedAt = latest.length ? latest.reduce((value, row) => row.checkedAt > value ? row.checkedAt : value, latest[0].checkedAt) : null;
  const maxAge = input.maxCanaryAgeMs ?? 36 * 60 * 60 * 1000;
  const fresh = latest.filter(item => nowMs - Date.parse(item.checkedAt) <= maxAge);
  const sourceStatus: CoverageSourceStatus = fresh.length
    ? aggregateSourceStatus(fresh.map(item => item.status))
    : latest.length ? 'historical' : 'unavailable';
  const sourceReasons = fresh.flatMap(item => [item.reason, ...Object.values(item.capabilities || {}).map(capability => capability.reason)])
    .filter((value): value is string => Boolean(value?.trim()));
  const sourceReason = input.discrepancyCount
    ? `${input.discrepancyCount} 条数据源差异待核对`
    : sourceStatus === 'historical' && latestCheckedAt
      ? `最近一次来源巡检已过期（${latestCheckedAt}）；仅能确认本地历史分区`
      : sourceStatus === 'empty'
        ? sourceReasons[0] || '来源已成功响应，但当前没有记录'
        : sourceStatus === 'failed' || sourceStatus === 'unavailable' || sourceStatus === 'unsupported' || sourceStatus === 'partial'
          ? sourceReasons[0] || `最新来源状态：${sourceStatus}`
          : !hasHistory && !fresh.length ? '当前筛选范围暂无已发布数据分区或近期来源巡检' : null;
  const historyReasons = input.partitions.filter(row=>Number(row.unavailablePartitionCount || 0)>0).map(row=>row.reason || '历史快照未通过内容校验');
  const reason = [...new Set([...historyReasons, sourceReason].filter((value): value is string=>Boolean(value)))].join('；') || null;
  const dataStatus: CoverageSourceStatus = damagedHistory
    ? hasHistory || USABLE.has(sourceStatus) || sourceStatus === 'partial' || Boolean(input.discrepancyCount) ? 'partial' : 'unavailable'
    : input.discrepancyCount
    ? 'partial'
    : sourceStatus === 'historical'
      ? hasHistory ? 'historical' : 'unavailable'
      : sourceStatus === 'empty'
        ? hasHistory ? 'historical' : 'empty'
        : FAILURES.has(sourceStatus) || sourceStatus === 'partial'
          ? hasHistory ? 'partial' : sourceStatus
          : sourceStatus;
  return { partitionStatus, sourceStatus, dataStatus, sourceCheckedAt: latestCheckedAt, reason };
}
