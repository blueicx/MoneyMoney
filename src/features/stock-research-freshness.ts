import { createDataEnvelope, type DataEnvelope } from './data-status';

export type StockResearchDatasetKind = 'analyst' | 'fundamentals' | 'short-interest';

export interface StockResearchSupplementalSource {
  field: string;
  source: string;
  updatedAt?: string | null;
  reason?: string | null;
}

export interface StockResearchFreshnessInput<T> {
  kind: StockResearchDatasetKind;
  symbol: string;
  sourceUpdatedAt?: string | null;
  retrievedAt?: string | null;
  data: T;
  supplementalSources?: StockResearchSupplementalSource[];
}

export type StockResearchFreshnessEnvelope<T> = DataEnvelope<T> & {
  sourceUpdatedAt: string | null;
  retrievedAt: string | null;
  supplementalSources: Array<{
    field: string;
    source: string;
    updatedAt: string | null;
    reason: string | null;
  }>;
};

const DATASET_POLICY: Record<StockResearchDatasetKind, {
  source: string;
  dataStatus: 'delayed' | 'historical';
  reason: string;
}> = {
  analyst: {
    source: 'StockAnalysis public analyst consensus',
    dataStatus: 'delayed',
    reason: '评级与目标价按公开来源发布时间更新，不是实时数据；现价来源单独列示。',
  },
  fundamentals: {
    source: 'SEC EDGAR XBRL companyfacts',
    dataStatus: 'historical',
    reason: '财务指标对应已提交的 SEC 报告期，不代表当前季度的实时经营情况。',
  },
  'short-interest': {
    source: 'Nasdaq public short interest',
    dataStatus: 'historical',
    reason: '空头利息按结算周期发布，通常约半月更新，不是实时持仓。',
  },
};

function normalizedTimestamp(value: unknown): string | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const usDate = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (usDate) {
    const [, month, day, year] = usDate;
    const isoDate = `${year}-${month}-${day}T00:00:00.000Z`;
    const parsed = new Date(isoDate);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === isoDate.slice(0, 10)
      ? parsed.toISOString()
      : null;
  }
  const timestamp = new Date(value as string | number | Date).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function buildStockResearchFreshnessEnvelope<T>(
  input: StockResearchFreshnessInput<T>,
): StockResearchFreshnessEnvelope<T> {
  const symbol = String(input.symbol || '').trim().toUpperCase().replace(/^US/, '');
  if (!symbol) throw new Error('股票研究数据缺少标的代码');

  const policy = DATASET_POLICY[input.kind];
  const sourceUpdatedAt = normalizedTimestamp(input.sourceUpdatedAt);
  const retrievedAt = normalizedTimestamp(input.retrievedAt);
  const missingTimeReason = '来源未提供或无法核验数据发布时间；抓取时间不会替代来源时点。';
  const reason = sourceUpdatedAt ? policy.reason : `${policy.reason}${missingTimeReason}`;
  const supplementalSources = (input.supplementalSources || []).map(item => ({
    field: String(item.field || '').trim(),
    source: String(item.source || '').trim(),
    updatedAt: normalizedTimestamp(item.updatedAt),
    reason: item.reason == null || item.reason === '' ? null : String(item.reason),
  })).filter(item => item.field && item.source);

  const envelope = createDataEnvelope({
    market: 'stocks',
    instrument: `stock:us:${symbol}`,
    data: input.data,
    dataStatus: sourceUpdatedAt ? policy.dataStatus : 'partial',
    source: policy.source,
    updatedAt: sourceUpdatedAt,
    reason,
  });

  return { ...envelope, sourceUpdatedAt, retrievedAt, supplementalSources };
}
