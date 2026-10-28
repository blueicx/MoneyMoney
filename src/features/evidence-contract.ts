import { createHash } from 'node:crypto';

/**
 * Shared evidence shape for features added after the 24 / 12 expansion plan.
 *
 * Older stores keep their own shapes. When they are projected into this
 * contract, any field that cannot be proven is left null and the coverage
 * state says why. Nothing here manufactures a timestamp or hash.
 */

export const EVIDENCE_MARKETS = ['stocks', 'options', 'crypto', 'prediction'] as const;
export type EvidenceMarket = (typeof EVIDENCE_MARKETS)[number];
export const EVIDENCE_COVERAGE_STATES = ['complete', 'partial', 'unknown', 'unavailable'] as const;
export type EvidenceCoverage = (typeof EVIDENCE_COVERAGE_STATES)[number];

export interface EvidenceRef {
  market: EvidenceMarket;
  instrument: string | null;
  kind: string;
  source: string;
  publishedAt: string | null;
  observedAt: string | null;
  fetchedAt: string | null;
  contentHash: string | null;
  coverage: EvidenceCoverage;
  unknownReason: string | null;
}

export interface EvidenceRefInput {
  market: string;
  instrument?: string | null;
  kind: string;
  source: string;
  publishedAt?: string | null;
  observedAt?: string | null;
  fetchedAt?: string | null;
  contentHash?: string | null;
  coverage: string;
  unknownReason?: string | null;
}

const hashPattern = /^[a-f0-9]{64}$/;
const timeOrder = ['publishedAt', 'observedAt', 'fetchedAt'] as const;

function timestamp(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || !/(?:Z|[+-]\d\d:\d\d)$/i.test(value)) {
    throw new Error(`${label}必须包含有效时区`);
  }
  return new Date(Date.parse(value)).toISOString();
}

function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}无效`);
  return value.trim();
}

/** Validates and normalizes a projection into the shared evidence contract. */
export function createEvidenceRef(input: EvidenceRefInput): EvidenceRef {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('证据引用必须是对象');
  const market = String(input.market) as EvidenceMarket;
  if (!EVIDENCE_MARKETS.includes(market)) throw new Error('证据市场无效');
  const coverage = String(input.coverage) as EvidenceCoverage;
  if (!EVIDENCE_COVERAGE_STATES.includes(coverage)) throw new Error('证据覆盖状态无效');
  const instrument = input.instrument == null ? null : text(input.instrument, '证据标的', 200);
  const kind = text(input.kind, '证据类型', 80);
  const source = text(input.source, '证据来源', 200);
  const publishedAt = timestamp(input.publishedAt, '发布时间');
  const observedAt = timestamp(input.observedAt, '观察时间');
  const fetchedAt = timestamp(input.fetchedAt, '抓取时间');
  const ordered = [{ key: 'publishedAt', value: publishedAt }, { key: 'observedAt', value: observedAt }, { key: 'fetchedAt', value: fetchedAt }]
    .filter((row): row is { key: typeof timeOrder[number]; value: string } => row.value !== null);
  if (ordered.some((row, index) => index > 0 && Date.parse(row.value) < Date.parse(ordered[index - 1].value))) throw new Error('证据时间顺序倒置（发布时间→观察→抓取）');
  const contentHash = input.contentHash == null || input.contentHash === '' ? null : String(input.contentHash);
  if (contentHash !== null && !hashPattern.test(contentHash)) throw new Error('证据内容Hash必须是64位小写十六进制');
  const unknownReason = input.unknownReason == null || input.unknownReason === '' ? null : text(input.unknownReason, '未知原因', 500);
  if (coverage === 'complete' && (contentHash === null || fetchedAt === null)) throw new Error('完整证据必须包含抓取时间和内容Hash');
  if (coverage !== 'complete' && unknownReason === null && coverage !== 'partial') throw new Error('未知或不可用证据必须说明原因');
  return { market, instrument, kind, source, publishedAt, observedAt, fetchedAt, contentHash, coverage, unknownReason };
}

/** Re-validates a stored evidence reference so later features cannot trust unverified data. */
export function verifyEvidenceRef(value: unknown): value is EvidenceRef {
  try {
    const ref = createEvidenceRef(value as EvidenceRefInput);
    const raw = value as EvidenceRef;
    return EVIDENCE_COVERAGE_STATES.includes(raw.coverage) && raw.contentHash === ref.contentHash && raw.market === ref.market;
  } catch {
    return false;
  }
}

export function evidenceRefDigest(ref: EvidenceRef): string {
  return createHash('sha256').update(JSON.stringify(ref)).digest('hex');
}

export function evidenceCoverageRank(state: EvidenceCoverage): number {
  return EVIDENCE_COVERAGE_STATES.indexOf(state);
}

export function isEvidenceEvidence(evidenceRefs: readonly EvidenceRef[]): boolean {
  return evidenceRefs.length > 0 && evidenceRefs.every(ref => verifyEvidenceRef(ref));
}
