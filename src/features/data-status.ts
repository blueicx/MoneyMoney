export const DATA_STATUS_VALUES = [
  'live', 'delayed', 'cached', 'partial', 'empty', 'unavailable', 'unsupported', 'failed', 'historical',
] as const;

export type DataStatus = typeof DATA_STATUS_VALUES[number];

const COMPATIBILITY_STATUS_MAP: Record<string, DataStatus> = {
  stale: 'cached',
  degraded: 'partial',
  error: 'failed',
  unsupported_market: 'unsupported',
};

export function normalizeDataStatus(value: unknown, fallback: DataStatus = 'unavailable'): DataStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  if ((DATA_STATUS_VALUES as readonly string[]).includes(normalized)) return normalized as DataStatus;
  return COMPATIBILITY_STATUS_MAP[normalized] || fallback;
}

export interface DataEnvelopeInput<T> {
  market: string;
  instrument?: string | null;
  data: T;
  dataStatus?: unknown;
  source?: string | null;
  updatedAt?: string | number | Date | null;
  reason?: string | null;
  evidenceRefs?: string[];
  requestId?: string | null;
}

export interface DataEnvelope<T> {
  success: true;
  market: string;
  instrument: string | null;
  dataStatus: DataStatus;
  source: string | null;
  updatedAt: string | null;
  reason: string | null;
  evidenceRefs: string[];
  requestId: string | null;
  data: T;
}

function normalizeDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = new Date(value as string | number | Date);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function createDataEnvelope<T>(input: DataEnvelopeInput<T>): DataEnvelope<T> {
  if (!String(input.market || '').trim()) throw new Error('market is required');
  return {
    success: true,
    market: String(input.market).trim(),
    instrument: input.instrument == null || input.instrument === '' ? null : String(input.instrument).trim(),
    dataStatus: normalizeDataStatus(input.dataStatus, 'unavailable'),
    source: input.source == null || input.source === '' ? null : String(input.source).trim(),
    updatedAt: normalizeDate(input.updatedAt),
    reason: input.reason == null || input.reason === '' ? null : String(input.reason),
    evidenceRefs: Array.isArray(input.evidenceRefs) ? [...new Set(input.evidenceRefs.map(String).filter(Boolean))] : [],
    requestId: input.requestId == null || input.requestId === '' ? null : String(input.requestId),
    data: input.data,
  };
}
