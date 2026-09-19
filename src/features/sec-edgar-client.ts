import { ResilientDataSourceAdapter } from '../data/source-adapter';
import type { StockCompanyFacts, StockCompanyFactPoint, StockFiling } from './stock-data-contracts';

export interface SecTickerRecord {
  cik: string;
  ticker: string;
  title: string;
  exchange: string;
}

interface SecSubmissionRecent {
  form?: string[];
  accessionNumber?: string[];
  filingDate?: string[];
  primaryDocument?: string[];
}

export interface SecSubmissionsPayload {
  name?: string;
  filings?: { recent?: SecSubmissionRecent };
}

interface SecXbrlEntry {
  start?: string;
  end?: string;
  val?: number;
  form?: string;
  fp?: string;
  filed?: string;
}

export interface SecCompanyFactsPayload {
  entityName?: string;
  facts?: Record<string, Record<string, { units?: Record<string, SecXbrlEntry[]> }>>;
}

const DEFAULT_USER_AGENT = 'MoneyMoney/1.0 (stock research; contact@moneymoney.app)';
const TICKER_TTL_MS = 24 * 60 * 60_000;
const SEC_TTL_MS = 12 * 60 * 60_000;
const jsonCache = new Map<string, { ts: number; value: unknown }>();
let tickerAdapter: ResilientDataSourceAdapter<SecTickerRecord[]> | null = null;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function paddedCik(value: unknown): string {
  return text(value).replace(/\D/g, '').padStart(10, '0');
}

export function buildSecHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  return {
    Accept: 'application/json',
    'User-Agent': text(env.MONEYMONEY_SEC_USER_AGENT) || DEFAULT_USER_AGENT,
  };
}

export function parseSecTickerDirectory(payload: Record<string, { cik_str?: number | string; ticker?: string; title?: string; exchange?: string }>): SecTickerRecord[] {
  return Object.values(payload || {})
    .map(item => ({
      cik: paddedCik(item?.cik_str),
      ticker: text(item?.ticker).toUpperCase(),
      title: text(item?.title),
      exchange: text(item?.exchange),
    }))
    .filter(item => /^\d{10}$/.test(item.cik) && /^[A-Z0-9.-]+$/.test(item.ticker) && item.title)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export function parseSecSubmissions(payload: SecSubmissionsPayload): { companyName: string; filings: StockFiling[] } {
  const recent = payload?.filings?.recent || {};
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const accessions = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
  const dates = Array.isArray(recent.filingDate) ? recent.filingDate : [];
  const documents = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];
  const filings: StockFiling[] = [];
  for (let index = 0; index < forms.length; index += 1) {
    const form = text(forms[index]).toUpperCase();
    const accessionNumber = text(accessions[index]);
    const filingDate = text(dates[index]);
    if (!form || !accessionNumber || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate)) continue;
    filings.push({ form, accessionNumber, filingDate, ...(text(documents[index]) ? { primaryDocument: text(documents[index]) } : {}) });
  }
  return { companyName: text(payload?.name), filings };
}

function isAnnual(entry: SecXbrlEntry): boolean {
  if (!entry.start || !entry.end || !Number.isFinite(Number(entry.val))) return false;
  const durationDays = (Date.parse(entry.end) - Date.parse(entry.start)) / 86_400_000;
  return durationDays >= 300 && durationDays <= 400 && ['10-K', '10-K/A'].includes(text(entry.form).toUpperCase()) && text(entry.fp).toUpperCase() === 'FY';
}

export function parseSecCompanyFacts(payload: SecCompanyFactsPayload): Omit<StockCompanyFacts, 'symbol' | 'cik'> & { entityName: string } {
  const annualFacts: Record<string, StockCompanyFactPoint[]> = {};
  const gaap = payload?.facts?.['us-gaap'] || {};
  for (const [tag, definition] of Object.entries(gaap)) {
    const entries = definition?.units?.USD || [];
    const byEnd = new Map<string, StockCompanyFactPoint>();
    for (const entry of entries) {
      if (!isAnnual(entry)) continue;
      const end = text(entry.end);
      const point = { end, value: Number(entry.val), filed: text(entry.filed) || null };
      const previous = byEnd.get(end);
      if (!previous || String(point.filed || '').localeCompare(String(previous.filed || '')) > 0) byEnd.set(end, point);
    }
    const points = [...byEnd.values()].sort((a, b) => b.end.localeCompare(a.end));
    if (points.length) annualFacts[tag] = points;
  }
  const entityName = text(payload?.entityName);
  return { entityName, companyName: entityName, annualFacts };
}

export async function fetchSecJson<T>(url: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const response = await fetchImpl(url, { headers: buildSecHeaders(), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function cached<T>(key: string, ttlMs: number): T | null {
  const entry = jsonCache.get(key);
  if (!entry || Date.now() - entry.ts > ttlMs) return null;
  return entry.value as T;
}

async function loadTickerAdapter(): Promise<SecTickerRecord[]> {
  if (!tickerAdapter) {
    tickerAdapter = new ResilientDataSourceAdapter<SecTickerRecord[]>({
      id: 'sec-edgar-ticker-directory',
      group: 'SEC 公司目录',
      ttlMs: TICKER_TTL_MS,
      timeoutMs: 15_000,
      retries: 2,
      fetcher: async (_input, signal) => {
        const response = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: buildSecHeaders(), signal });
        if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
        return parseSecTickerDirectory(await response.json() as Record<string, { cik_str?: number | string; ticker?: string; title?: string; exchange?: string }>);
      },
    });
  }
  const snapshot = await tickerAdapter.fetch();
  if (!snapshot.data) throw new Error(snapshot.error || 'SEC ticker directory unavailable');
  return snapshot.data;
}

export async function loadSecTickerDirectory(): Promise<SecTickerRecord[]> {
  return loadTickerAdapter();
}

export async function findSecTicker(symbol: string): Promise<SecTickerRecord> {
  const normalized = text(symbol).toUpperCase().replace(/^US/, '');
  const record = (await loadSecTickerDirectory()).find(item => item.ticker === normalized);
  if (!record) throw new Error(`Unknown SEC ticker: ${normalized}`);
  return record;
}

export async function loadSecSubmissions(symbol: string): Promise<{ companyName: string; cik: string; filings: StockFiling[] }> {
  const record = await findSecTicker(symbol);
  const key = `sec-submissions:${record.ticker}`;
  const hit = cached<{ companyName: string; cik: string; filings: StockFiling[] }>(key, SEC_TTL_MS);
  if (hit) return hit;
  const payload = await fetchSecJson<SecSubmissionsPayload>(`https://data.sec.gov/submissions/CIK${record.cik}.json`);
  const parsed = parseSecSubmissions(payload);
  const value = { companyName: parsed.companyName || record.title, cik: record.cik, filings: parsed.filings };
  jsonCache.set(key, { ts: Date.now(), value });
  return value;
}

export async function loadSecCompanyFacts(symbol: string): Promise<StockCompanyFacts> {
  const record = await findSecTicker(symbol);
  const key = `sec-companyfacts:${record.ticker}`;
  const hit = cached<StockCompanyFacts>(key, SEC_TTL_MS);
  if (hit) return hit;
  const payload = await fetchSecJson<SecCompanyFactsPayload>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${record.cik}.json`);
  const parsed = parseSecCompanyFacts(payload);
  const value: StockCompanyFacts = { symbol: record.ticker, cik: record.cik, companyName: parsed.companyName || record.title, annualFacts: parsed.annualFacts };
  jsonCache.set(key, { ts: Date.now(), value });
  return value;
}
