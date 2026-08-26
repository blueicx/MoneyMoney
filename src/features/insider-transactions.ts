/**
 * SEC EDGAR insider-transaction radar.
 *
 * Uses official keyless Form 4 filings to summarize recent buying and selling
 * by directors, officers, and 10% owners. This is contextual research data,
 * not a standalone trading trigger.
 */

export interface InsiderTrade {
  filedAt: string;
  transactionDate: string;
  ownerName: string;
  ownerTitleZh: string;
  action: 'BUY' | 'SELL' | 'OTHER';
  code: string;
  shares: number;
  priceUsd: number;
  valueUsd: number;
  plan10b5: boolean;
}

export interface InsiderRadarResult {
  symbol: string;
  cik: string;
  companyName: string;
  updatedAt: string;
  windowDays: number;
  scannedFilings: number;
  transactions: InsiderTrade[];
  ownerCount: number;
  buyCount: number;
  sellCount: number;
  buyValueUsd: number;
  sellValueUsd: number;
  netValueUsd: number;
  planSellRatio: number;
  confidence: number;
  signalZh: string;
  adviceZh: string;
  sources: string[];
}

export interface TickerRecord {
  cik: string;
  ticker: string;
  title: string;
  exchange: string;
}

const USER_AGENT = 'MoneyMoney/1.0 (keyless research; contact@moneymoney.app)';
const WINDOW_DAYS = 90;
let tickerCache: { ts: number; records: TickerRecord[] } | null = null;
let tickerFetch: Promise<TickerRecord[]> | null = null;
const resultCache = new Map<string, { ts: number; value: InsiderRadarResult }>();

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function xmlText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function number(value: string): number {
  const parsed = Number(String(value || '').replace(/[$,%\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
  return response.text();
}

export async function loadTickerRecords(): Promise<TickerRecord[]> {
  if (tickerCache && Date.now() - tickerCache.ts < 24 * 60 * 60_000) return tickerCache.records;
  if (tickerFetch) return tickerFetch;

  tickerFetch = (async () => {
    const payload = await fetchJson<Record<string, { cik_str?: number; ticker?: string; title?: string; exchange?: string }>>(
      'https://www.sec.gov/files/company_tickers.json'
    );
    const records: TickerRecord[] = Object.values(payload || {}).map(item => ({
      cik: String(item?.cik_str ?? ''),
      ticker: String(item?.ticker ?? '').toUpperCase(),
      title: String(item?.title ?? ''),
      exchange: String(item?.exchange ?? ''),
    }));
    tickerCache = { ts: Date.now(), records };
    return records;
  })();

  try {
    return await tickerFetch;
  } finally {
    tickerFetch = null;
  }
}

interface SubmissionEntry {
  form: string;
  accessionNumber: string;
  filingDate: string;
}

interface SubmissionsPayload {
  cik?: string;
  name?: string;
  filings?: {
    recent?: {
      form?: string[];
      accessionNumber?: string[];
      filingDate?: string[];
      primaryDocument?: string[];
    };
  };
}

function parseTransactions(xml: string, filedAt: string): InsiderTrade[] {
  const tableMatch = xml.match(/<nonDerivativeTable>([\s\S]*?)<\/nonDerivativeTable>/i);
  if (!tableMatch) return [];

  const ownerName = xmlText(xml, 'rptOwnerName');
  const officerTitle = xmlText(xml, 'officerTitle');
  const relationships = [
    /<isDirector>\s*true\s*<\/isDirector>/i.test(xml) ? '董事' : '',
    /<isOfficer>\s*true\s*<\/isOfficer>/i.test(xml) && officerTitle ? `高管·${officerTitle}` : '',
    /<is10percentOwner>\s*true\s*<\/is10percentOwner>/i.test(xml) ? '10%股东' : '',
  ].filter(Boolean);
  const role = relationships.length ? relationships.join(' · ') : '申报人';
  const plan = /<aff10b5One>\s*true\s*<\/aff10b5One>/i.test(xml) ||
    /rule 10b5-1/i.test(xml);

  const segments = tableMatch[1].split(/<nonDerivativeTransaction>/i).slice(1);
  const trades: InsiderTrade[] = [];
  for (const rawSegment of segments) {
    const segment = rawSegment.split(/<\/nonDerivativeTransaction>/i)[0];
    const dateBlock = segment.match(/<transactionDate>([\s\S]*?)<\/transactionDate>/i)?.[1] || '';
    const codingBlock = segment.match(/<transactionCoding>([\s\S]*?)<\/transactionCoding>/i)?.[1] || '';
    const sharesBlock = segment.match(/<transactionShares>([\s\S]*?)<\/transactionShares>/i)?.[1] || '';
    const priceBlock = segment.match(/<transactionPricePerShare>([\s\S]*?)<\/transactionPricePerShare>/i)?.[1] || '';
    const adBlock = segment.match(/<transactionAcquiredDisposedCode>([\s\S]*?)<\/transactionAcquiredDisposedCode>/i)?.[1] || '';

    const shares = number(xmlText(sharesBlock, 'value'));
    const price = number(xmlText(priceBlock, 'value'));
    const ad = xmlText(adBlock, 'value').toUpperCase();
    const action = ad === 'A' ? 'BUY' : ad === 'D' ? 'SELL' : 'OTHER';

    if (!shares || !['BUY', 'SELL'].includes(action)) continue;

    trades.push({
      filedAt,
      transactionDate: xmlText(dateBlock, 'value') || filedAt,
      ownerName: ownerName || 'Unknown',
      ownerTitleZh: role,
      action: action as InsiderTrade['action'],
      code: xmlText(codingBlock, 'transactionCode').toUpperCase(),
      shares: round(shares, 0),
      priceUsd: round(price, 4),
      valueUsd: round(shares * price, 0),
      plan10b5: plan,
    });
  }
  return trades;
}

function buildSummary(
  symbol: string,
  transactions: InsiderTrade[],
  scannedFilings: number
): Pick<
  InsiderRadarResult,
  'ownerCount' | 'buyCount' | 'sellCount' | 'buyValueUsd' | 'sellValueUsd' |
  'netValueUsd' | 'planSellRatio' | 'confidence' | 'signalZh' | 'adviceZh'
> {
  const owners = new Set(transactions.map(trade => trade.ownerName));
  const buys = transactions.filter(trade => trade.action === 'BUY');
  const sells = transactions.filter(trade => trade.action === 'SELL');
  const buyValue = buys.reduce((sum, trade) => sum + trade.valueUsd, 0);
  const sellValue = sells.reduce((sum, trade) => sum + trade.valueUsd, 0);
  const netValue = buyValue - sellValue;
  const plannedSells = sells.filter(trade => trade.plan10b5).length;
  const planSellRatio = sells.length ? plannedSells / sells.length : 0;

  let signalZh = '内部人买卖相对平衡';
  let adviceZh = '没有明显一边倒的官方申报信号；仍应把技术面、基本面和财报时间放在一起判断。';
  if (sellValue >= 2_000_000 && sells.length >= 3 && netValue < 0) {
    signalZh = '内部人卖出偏多';
    adviceZh = planSellRatio >= 0.6
      ? '近期卖压申报较多，但多数来自 10b5-1 预设计划，通常不宜机械看空；可收紧止损并观察是否出现额外非计划卖出。'
      : '近期卖压申报较多，且预设计划占比不高；持仓者避免重仓追高，关注是否连续出现大额非计划出售。';
  } else if (buyValue >= 250_000 && buys.length >= 2 && netValue > 0) {
    signalZh = '内部人买入偏积极';
    adviceZh = '真实自有资金买入是有价值的背景信号，但不保证股价上涨；优先等待价格结构确认，不用单一申报重仓。';
  } else if (netValue > 0) {
    signalZh = '买入略占上风';
    adviceZh = '样本偏小，只作为加分观察；重点核对买入是否为期权行权、薪酬安排或一次性事件。';
  } else if (netValue < 0) {
    signalZh = '卖出略多，但未到强警号';
    adviceZh = '高管常因税务、薪酬和分散化卖出；只有连续大额非计划卖出才更值得警惕。';
  }

  const confidence = Math.min(88, Math.round(
    32 +
    Math.min(22, owners.size * 6) +
    Math.min(20, Math.log10(Math.max(1, buyValue + sellValue)) * 5) +
    (scannedFilings >= 8 ? 8 : scannedFilings * 1)
  ));

  return {
    ownerCount: owners.size,
    buyCount: buys.length,
    sellCount: sells.length,
    buyValueUsd: round(buyValue, 0),
    sellValueUsd: round(sellValue, 0),
    netValueUsd: round(netValue, 0),
    planSellRatio: round(planSellRatio, 4),
    confidence,
    signalZh,
    adviceZh,
  };
}

export async function getInsiderRadar(symbolInput: string): Promise<InsiderRadarResult> {
  const symbol = symbolInput.trim().toUpperCase().replace(/^US/, '');
  if (!symbol || /[^A-Z.-]/.test(symbol)) throw new Error('Invalid US symbol');

  const cacheKey = symbol;
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 30 * 60_000) return cached.value;

  const records = await loadTickerRecords();
  const record = records.find(item => item.ticker === symbol);
  if (!record) throw new Error(`Unknown SEC ticker: ${symbol}`);

  const paddedCik = record.cik.padStart(10, '0');
  const payload = await fetchJson<SubmissionsPayload>(
    `https://data.sec.gov/submissions/CIK${paddedCik}.json`
  );
  const recent = payload.filings?.recent;
  const forms = recent?.form || [];
  const accessions = recent?.accessionNumber || [];
  const filingDates = recent?.filingDate || [];
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60_000;

  const entries: SubmissionEntry[] = [];
  for (let i = 0; i < forms.length; i++) {
    const filedAt = filingDates[i] || '';
    const filedTime = new Date(filedAt).getTime();
    if (forms[i] !== '4' || !Number.isFinite(filedTime) || filedTime < cutoff) continue;
    entries.push({ form: forms[i], accessionNumber: accessions[i], filingDate: filedAt });
  }

  // Stay well below public-rate limits while keeping the radar responsive.
  const chunks: SubmissionEntry[][] = [];
  for (let i = 0; i < Math.min(entries.length, 16); i += 3) chunks.push(entries.slice(i, i + 3));

  const transactions: InsiderTrade[] = [];
  for (const chunk of chunks) {
    const results = await Promise.allSettled(chunk.map(async entry => {
      const noDash = entry.accessionNumber.replace(/-/g, '');
      const xml = await fetchText(`https://www.sec.gov/Archives/edgar/data/${paddedCik}/${noDash}/form4.xml`);
      if (!/<ownershipDocument/i.test(xml)) throw new Error('Unexpected Form 4 payload');
      return parseTransactions(xml, entry.filingDate);
    }));
    for (const result of results) {
      if (result.status === 'fulfilled') transactions.push(...result.value);
    }
  }

  transactions.sort((a, b) =>
    b.transactionDate.localeCompare(a.transactionDate) || a.ownerName.localeCompare(b.ownerName)
  );
  const summary = buildSummary(symbol, transactions, entries.length);
  const value: InsiderRadarResult = {
    symbol,
    cik: paddedCik,
    companyName: record.title || text(payload.name),
    updatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    scannedFilings: entries.length,
    transactions: transactions.slice(0, 12),
    ...summary,
    sources: ['SEC EDGAR Form 4', 'SEC Company Tickers'],
  };

  resultCache.set(cacheKey, { ts: Date.now(), value });
  if (resultCache.size > 100) {
    const oldest = [...resultCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) resultCache.delete(oldest[0]);
  }
  return value;
}
