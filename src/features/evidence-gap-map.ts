import { createHash } from 'node:crypto';
import { EVIDENCE_COVERAGE_STATES, EVIDENCE_MARKETS, type EvidenceCoverage, type EvidenceMarket } from './evidence-contract';

/**
 * Read-only aggregation of every "unknown / partial / uncomparable / stale"
 * marker MoneyMoney already produces. It never re-labels an existing state:
 * complete evidence is excluded here so this view stays a gap map.
 */

export interface EvidenceGapRow {
  id: string;
  market: EvidenceMarket;
  instrument: string | null;
  source: string;
  kind: string;
  coverage: EvidenceCoverage;
  reason: string;
  observedAt: string | null;
  detail?: string;
}

export interface EvidenceGapMap {
  generatedAt: string;
  dataStatus: 'partial' | 'empty' | 'unavailable';
  total: number;
  byCoverage: Record<EvidenceCoverage, number>;
  groups: Array<{ market: EvidenceMarket; source: string; coverage: EvidenceCoverage; count: number }>;
  rows: EvidenceGapRow[];
  rejected: Array<{ index: number; reason: string }>;
  contentHash: string;
}

const isoWithZone = /(?:Z|[+-]\d\d:\d\d)$/i;

function normalizeRow(value: unknown, index: number): EvidenceGapRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('缺口行必须是对象');
  const row = value as Record<string, unknown>;
  const allowed = ['id', 'market', 'instrument', 'source', 'kind', 'coverage', 'reason', 'observedAt', 'detail'];
  if (Object.keys(row).some(key => !allowed.includes(key))) throw new Error('缺口行包含未支持字段');
  const market = String(row.market) as EvidenceMarket;
  if (!EVIDENCE_MARKETS.includes(market)) throw new Error('缺口行市场无效');
  const coverage = String(row.coverage) as EvidenceCoverage;
  if (!EVIDENCE_COVERAGE_STATES.includes(coverage) || coverage === 'complete') throw new Error('缺口图只接受非完整覆盖状态');
  const text = (input: unknown, label: string, max = 300) => {
    if (typeof input !== 'string' || !input.trim() || input.length > max) throw new Error(`${label}无效`);
    return input.trim();
  };
  const id = text(row.id, '缺口身份', 240);
  const source = text(row.source, '缺口来源', 200);
  const kind = text(row.kind, '缺口类型', 80);
  const reason = text(row.reason, '缺口原因', 500);
  const instrument = row.instrument == null ? null : text(row.instrument, '缺口标的', 200);
  const observedAt = row.observedAt == null ? null : (() => {
    if (typeof row.observedAt !== 'string' || !Number.isFinite(Date.parse(row.observedAt)) || !isoWithZone.test(row.observedAt)) throw new Error('缺口观察时间必须包含有效时区');
    return new Date(Date.parse(row.observedAt)).toISOString();
  })();
  const detail = row.detail == null ? undefined : text(row.detail, '缺口说明', 1000);
  void index;
  return { id, market, instrument, source, kind, coverage, reason, observedAt, ...(detail ? { detail } : {}) };
}

export function buildEvidenceGapMap(input: readonly unknown[], now = Date.now()): EvidenceGapMap {
  if (!Array.isArray(input)) throw new Error('缺口数据必须是数组');
  const rows: EvidenceGapRow[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  const seen = new Set<string>();
  input.forEach((value, index) => {
    try {
      const row = normalizeRow(value, index);
      const key = `${row.market}|${row.source}|${row.kind}|${row.instrument ?? ''}|${row.id}`;
      if (seen.has(key)) throw new Error('重复的缺口记录');
      if (row.observedAt && Date.parse(row.observedAt) > now + 1000) throw new Error('缺口观察时间晚于当前时间');
      seen.add(key);
      rows.push(row);
    } catch (error) {
      rejected.push({ index, reason: error instanceof Error ? error.message : '缺口行不可解析' });
    }
  });
  const byCoverage = Object.fromEntries(EVIDENCE_COVERAGE_STATES.map(state => [state, 0])) as Record<EvidenceCoverage, number>;
  const groups = new Map<string, { market: EvidenceMarket; source: string; coverage: EvidenceCoverage; count: number }>();
  rows
    .slice()
    .sort((left, right) => (right.observedAt ?? '').localeCompare(left.observedAt ?? '') || left.id.localeCompare(right.id))
    .forEach(row => {
      byCoverage[row.coverage] += 1;
      const key = `${row.market}|${row.source}|${row.coverage}`;
      const group = groups.get(key) ?? { market: row.market, source: row.source, coverage: row.coverage, count: 0 };
      group.count += 1;
      groups.set(key, group);
    });
  const payload = {
    generatedAt: new Date(now).toISOString(),
    dataStatus: rows.length ? ('partial' as const) : rejected.length ? ('unavailable' as const) : ('empty' as const),
    total: rows.length,
    byCoverage,
    groups: [...groups.values()].sort((left, right) => right.count - left.count || left.source.localeCompare(right.source)),
    rows,
    rejected,
  };
  return { ...payload, contentHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

export function renderEvidenceGapCsv(map: EvidenceGapMap): string {
  const header = ['id', 'market', 'instrument', 'source', 'kind', 'coverage', 'reason', 'observedAt', 'detail'];
  const escape = (value: string | null | undefined) => {
    const text = value == null ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [header.join(','), ...map.rows.map(row => header.map(key => escape((row as unknown as Record<string, string | null | undefined>)[key])).join(','))].join('\n');
}
