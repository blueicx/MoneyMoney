import type { SourceSnapshot, SourceStatus } from '../data/source-adapter';

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
  sourceStatus: Record<string, SourceStatus>;
}
