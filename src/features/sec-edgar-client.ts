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
  reportDate?: string[];
  acceptanceDateTime?: string[];
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
const SEC_MIN_REQUEST_INTERVAL_MS = 125;
const jsonCache = new Map<string, { ts: number; value: unknown }>();
let secRequestQueue: Promise<void> = Promise.resolve();
let nextSecRequestAt = 0;
let tickerAdapter: ResilientDataSourceAdapter<SecTickerRecord[]> | null = null;

async function waitForSecRequestSlot(): Promise<void> {
  let releaseQueue!: () => void;
  const previous = secRequestQueue;
  secRequestQueue = new Promise<void>(resolve => { releaseQueue = resolve; });
  await previous;
  try {
    const delayMs = nextSecRequestAt - Date.now();
    if (delayMs > 0) await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    nextSecRequestAt = Date.now() + SEC_MIN_REQUEST_INTERVAL_MS;
  } finally {
    releaseQueue();
  }
}

export interface Sec13FFiling {
  form: '13F-HR' | '13F-HR/A';
  accessionNumber: string;
  filingDate: string;
  reportPeriod: string;
  primaryDocument: string | null;
  sourceUrl: string;
}

export interface Sec13FSubmissionsPayload extends SecSubmissionsPayload {}

interface SecArchiveIndexPayload {
  directory?: { item?: Array<{ name?: string; type?: string; size?: string | number }> };
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function paddedCik(value: unknown): string {
  try {
    return normalizeSecCik(value);
  } catch {
    return '';
  }
}

export function normalizeSecCik(value: unknown): string {
  const raw = text(value);
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0) throw new Error('Invalid SEC CIK');
  return raw.padStart(10, '0');
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
  const accepted = Array.isArray(recent.acceptanceDateTime) ? recent.acceptanceDateTime : [];
  const documents = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];
  const filings: StockFiling[] = [];
  for (let index = 0; index < forms.length; index += 1) {
    const form = text(forms[index]).toUpperCase();
    const accessionNumber = text(accessions[index]);
    const filingDate = text(dates[index]);
    if (!form || !accessionNumber || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate)) continue;
    const acceptedAt = text(accepted[index]);
    filings.push({ form, accessionNumber, filingDate,
      ...( /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(acceptedAt) && Number.isFinite(Date.parse(acceptedAt)) ? { acceptedAt: new Date(acceptedAt).toISOString() } : {}),
      ...(text(documents[index]) ? { primaryDocument: text(documents[index]) } : {}) });
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
  await waitForSecRequestSlot();
  const response = await fetchImpl(url, { headers: buildSecHeaders(), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchSecText(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  await waitForSecRequestSlot();
  const response = await fetchImpl(url, {
    headers: {
      ...buildSecHeaders(),
      Accept: 'application/xml, text/xml, text/plain;q=0.9, */*;q=0.8',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
  return response.text();
}

function validDate(value: unknown): value is string {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function reportedValueUnitForFilingDate(value: unknown): 'usd' | 'thousand-usd' | 'unknown' {
  const filingDate = text(value);
  if (!validDate(filingDate)) return 'unknown';
  // SEC Form 13F values are rounded to dollars for filings made on/after Jan 3, 2023.
  return filingDate >= '2023-01-03' ? 'usd' : 'thousand-usd';
}

function validAccession(value: unknown): value is string {
  return /^\d{10}-\d{2}-\d{6}$/.test(text(value));
}

function safeXmlBasename(value: unknown): string | null {
  const name = text(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.xml$/i.test(name) || name.includes('..')) return null;
  return name;
}

function safeSec13FPrimaryDocument(value: unknown): string | null {
  const raw = text(value);
  if (raw.includes('\\')) return null;
  const parts = raw.split('/');
  if (parts.some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part) || part.includes('..'))) return null;
  return safeXmlBasename(parts.at(-1));
}

export function buildSec13FArchiveUrl(cikInput: unknown, accessionInput: unknown, documentInput: unknown): string | null {
  let cik: string;
  try {
    cik = normalizeSecCik(cikInput);
  } catch {
    return null;
  }
  const accession = text(accessionInput);
  const documentName = safeXmlBasename(documentInput);
  if (!validAccession(accession) || !documentName) return null;
  const accessionPath = accession.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionPath}/${encodeURIComponent(documentName)}`;
}

export function parseSec13FSubmissions(payload: Sec13FSubmissionsPayload, filerCikInput?: unknown): { companyName: string; filings: Sec13FFiling[] } {
  const filerCik = filerCikInput === undefined ? '' : normalizeSecCik(filerCikInput);
  const recent = payload?.filings?.recent || {};
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const accessions = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
  const filedDates = Array.isArray(recent.filingDate) ? recent.filingDate : [];
  const reportDates = Array.isArray(recent.reportDate) ? recent.reportDate : [];
  const primaryDocuments = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];
  const filings: Sec13FFiling[] = [];
  for (let index = 0; index < forms.length; index += 1) {
    const form = text(forms[index]).toUpperCase();
    const accessionNumber = text(accessions[index]);
    const filingDate = text(filedDates[index]);
    const reportPeriod = text(reportDates[index]);
    if ((form !== '13F-HR' && form !== '13F-HR/A') || !validAccession(accessionNumber)
      || !validDate(filingDate) || !validDate(reportPeriod)) continue;
    const primaryDocument = safeSec13FPrimaryDocument(primaryDocuments[index]);
    const archiveCik = filerCik || accessionNumber.slice(0, 10);
    const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${Number(archiveCik)}/${accessionNumber.replace(/-/g, '')}/`;
    filings.push({ form, accessionNumber, filingDate, reportPeriod, primaryDocument, sourceUrl });
  }
  return { companyName: text(payload?.name), filings };
}

export function findSec13FInformationTable(payload: SecArchiveIndexPayload): string | null {
  const items = Array.isArray(payload?.directory?.item) ? payload.directory.item : [];
  for (const item of items) {
    const name = safeXmlBasename(item?.name);
    if (!name) continue;
    const normalized = name.toLowerCase().replace(/[_-]/g, '');
    if (normalized.includes('infotable') || normalized.includes('informationtable')) return name;
  }
  return null;
}

function sec13FXmlCandidates(payload: SecArchiveIndexPayload, primaryDocument: string | null): string[] {
  const items = Array.isArray(payload?.directory?.item) ? payload.directory.item : [];
  const preferred = findSec13FInformationTable(payload)?.toLowerCase();
  return items.flatMap((item, index) => {
    const name = safeXmlBasename(item?.name);
    if (!name || name.toLowerCase() === primaryDocument?.toLowerCase()) return [];
    const size = Number(item?.size);
    return [{ name, index, size: Number.isFinite(size) && size > 0 ? size : 0 }];
  }).sort((a, b) => Number(b.name.toLowerCase() === preferred) - Number(a.name.toLowerCase() === preferred)
    || b.size - a.size || a.index - b.index)
    .slice(0, 12)
    .map(item => item.name);
}

function isSec13FInformationTableXml(xml: string): boolean {
  return /<(?:[A-Za-z_][\w.-]*:)?informationTable\b[^>]*>/i.test(xml)
    && /<(?:[A-Za-z_][\w.-]*:)?infoTable\b[^>]*>/i.test(xml)
    && /<\/(?:[A-Za-z_][\w.-]*:)?informationTable\s*>/i.test(xml);
}

export async function loadSec13FSubmissions(cikInput: unknown, fetchImpl: typeof fetch = fetch): Promise<{ companyName: string; cik: string; filings: Sec13FFiling[] }> {
  const cik = normalizeSecCik(cikInput);
  const payload = await fetchSecJson<Sec13FSubmissionsPayload>(`https://data.sec.gov/submissions/CIK${cik}.json`, fetchImpl);
  const parsed = parseSec13FSubmissions(payload, cik);
  return { ...parsed, cik };
}

export async function loadSec13FDocuments(
  cikInput: unknown,
  filing: Sec13FFiling,
  fetchImpl: typeof fetch = fetch,
): Promise<{ informationTableXml: string; coverPageXml: string | null; informationTableUrl: string; sourceUrl: string }> {
  const cik = normalizeSecCik(cikInput);
  if (!validAccession(filing.accessionNumber)) throw new Error('SEC 13F accession is invalid');
  const primaryDocument = safeSec13FPrimaryDocument(filing.primaryDocument);
  const archiveBase = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accessionNumber.replace(/-/g, '')}/`;
  const index = await fetchSecJson<SecArchiveIndexPayload>(`${archiveBase}index.json`, fetchImpl);
  let informationTableName: string | null = null;
  let informationTableUrl = '';
  let informationTableXml = '';
  for (const candidate of sec13FXmlCandidates(index, primaryDocument)) {
    const candidateUrl = buildSec13FArchiveUrl(cik, filing.accessionNumber, candidate);
    if (!candidateUrl) continue;
    const candidateXml = await fetchSecText(candidateUrl, fetchImpl);
    if (!isSec13FInformationTableXml(candidateXml)) continue;
    informationTableName = candidate;
    informationTableUrl = candidateUrl;
    informationTableXml = candidateXml;
    break;
  }
  if (!informationTableName) throw new Error('SEC 13F information table XML is unavailable');
  const primaryDocumentUrl = buildSec13FArchiveUrl(cik, filing.accessionNumber, primaryDocument);
  const coverPageXml = primaryDocumentUrl ? await fetchSecText(primaryDocumentUrl, fetchImpl) : null;
  return { informationTableXml, coverPageXml, informationTableUrl, sourceUrl: archiveBase };
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
  const accessionBase = `https://www.sec.gov/Archives/edgar/data/${Number(record.cik)}/`;
  const value = { companyName: parsed.companyName || record.title, cik: record.cik, filings: parsed.filings.map(filing => ({
    ...filing,
    reportUrl: filing.primaryDocument
      ? `${accessionBase}${filing.accessionNumber.replace(/-/g, '')}/${encodeURI(filing.primaryDocument)}`
      : `${accessionBase}${filing.accessionNumber.replace(/-/g, '')}/`,
  })) };
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
