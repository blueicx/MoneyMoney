import type { SourceSnapshot, SourceStatus } from '../data/source-adapter';

export type DataState = 'live' | 'delayed' | 'cached' | 'degraded' | 'unavailable';

export interface DataStatus {
  state: DataState;
  source: string;
  observedAt: string | null;
  expiresAt: string | null;
  latencyMs: number | null;
  reason: string | null;
}

export function normalizeDataStatus(input: Partial<DataStatus>): DataStatus {
  const states: DataState[] = ['live', 'delayed', 'cached', 'degraded', 'unavailable'];
  return {
    state: states.includes(input.state as DataState) ? input.state as DataState : 'unavailable',
    source: String(input.source || 'unknown'),
    observedAt: input.observedAt || null,
    expiresAt: input.expiresAt || null,
    latencyMs: Number.isFinite(input.latencyMs) ? Number(input.latencyMs) : null,
    reason: input.reason || null,
  };
}

export interface StockQuote {
  symbol: string;
  price: number;
  changePct: number | null;
  currency: string;
  asOf: string | null;
}

export interface StockBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface StockFiling {
  form: string;
  accessionNumber: string;
  filingDate: string;
  primaryDocument?: string;
  reportUrl?: string;
}

export interface StockCompanyFactPoint {
  end: string;
  value: number;
  filed: string | null;
}

export interface StockCompanyFacts {
  symbol: string;
  cik: string;
  companyName: string;
  annualFacts: Record<string, StockCompanyFactPoint[]>;
}

export interface StockDataBundle {
  symbol: string;
  quote: StockQuote | null;
  bars: StockBar[];
  filings: StockFiling[];
  fundamentals: StockCompanyFacts | null;
  snapshots: SourceSnapshot<unknown>[];
  sources: SourceSnapshot<unknown>[];
  sourceStatus: Record<string, SourceStatus>;
}
