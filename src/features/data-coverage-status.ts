import type { MarketId } from './research-contracts';

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
  partitionStatus: 'historical' | 'empty';
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
  partitions: readonly { status?: string; rowCount?: number; partitionCount?: number }[];
  discrepancyCount?: number;
  observations?: readonly CoverageSourceObservation[];
  now?: string | Date;
  maxCanaryAgeMs?: number;
}): PublishedCoverageStatus {
  const nowMs = input.now instanceof Date ? input.now.getTime() : Date.parse(input.now || new Date().toISOString());
  if (!Number.isFinite(nowMs)) throw new Error('Coverage evaluation time is invalid');
  const hasHistory = input.partitions.some(row =>
    row.status === 'published' || Number(row.rowCount || 0) > 0 || Number(row.partitionCount || 0) > 0,
  );
  const partitionStatus = hasHistory ? 'historical' : 'empty';
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
  const reason = input.discrepancyCount
    ? `${input.discrepancyCount} 条数据源差异待核对`
    : sourceStatus === 'historical' && latestCheckedAt
      ? `最近一次来源巡检已过期（${latestCheckedAt}）；仅能确认本地历史分区`
      : sourceStatus === 'empty'
        ? sourceReasons[0] || '来源已成功响应，但当前没有记录'
        : sourceStatus === 'failed' || sourceStatus === 'unavailable' || sourceStatus === 'unsupported' || sourceStatus === 'partial'
          ? sourceReasons[0] || `最新来源状态：${sourceStatus}`
          : !hasHistory && !fresh.length ? '当前筛选范围暂无已发布数据分区或近期来源巡检' : null;
  const dataStatus: CoverageSourceStatus = input.discrepancyCount
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
