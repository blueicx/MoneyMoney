/**
 * Keyless Nasdaq institutional-ownership radar.
 *
 * The public company endpoint summarizes 13F-style institutional positioning:
 * ownership percentage, active position breadth, new/sold-out counts, and the
 * largest holders. It is slow money, so it confirms or questions a setup rather
 * than acting as a standalone trade trigger.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

export interface InstitutionalPositionGroup {
  label: string;
  labelZh: string;
  holders: number;
  shares: number;
}

export interface InstitutionalHolder {
  name: string;
  reportDate: string;
  shares: number;
  shareChange: number;
  shareChangePct: number | null;
  marketValueUsd: number;
}

export interface InstitutionalOwnershipSnapshot {
  symbol: string;
  ownershipPct: number;
  totalHolders: number;
  institutionalShares: number;
  sharesOutstanding: number;
  holdingsValueUsd: number;
  increasedPositions: InstitutionalPositionGroup;
  decreasedPositions: InstitutionalPositionGroup;
  heldPositions: InstitutionalPositionGroup;
  newPositions: InstitutionalPositionGroup;
  soldOutPositions: InstitutionalPositionGroup;
  netShares: number;
  netSharePctOfHoldings: number;
  netHolderBreadth: number;
  topHolderNetShares: number;
  latestReportDate: string;
  dataAgeDays: number;
  topHolders: InstitutionalHolder[];
  signal: 'accumulation' | 'distribution' | 'mixed' | 'neutral';
  signalZh: string;
  adviceZh: string;
  confidence: number;
  source: string;
}

export interface InstitutionalOwnershipRadar {
  rows: InstitutionalOwnershipSnapshot[];
  failedSymbols: string[];
  accumulationCount: number;
  distributionCount: number;
  mixedCount: number;
  averageOwnershipPct: number;
  summaryZh: string;
  advisorBiasZh: string;
  regimeBoost: number;
  generatedAt: string;
  source: string;
}

const ADVISOR_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MoneyMoney/1.0';
const CACHE_TTL_MS = 6 * 60 * 60_000;

type CacheEntry = { ts: number; value: Promise<InstitutionalOwnershipSnapshot> };
const snapshotCache = new Map<string, CacheEntry>();
const execFileAsync = promisify(execFile);

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSymbol(input: string): string {
  const symbol = String(input || '').trim().toUpperCase().replace(/^US/, '');
  if (!symbol || /[^A-Z0-9.-]/.test(symbol)) throw new Error('请输入有效的美股代码');
  return symbol;
}

function parseNumber(raw: any): number {
  const value = Number(String(raw ?? '').replace(/[,$+%]/g, ''));
  return Number.isFinite(value) ? value : NaN;
}

function parseMillions(raw: any): number {
  // Nasdaq labels these fields "millions" but often emits plain thousands in
  // the API payload. Comparisons only need a stable scale, while UI values use
  // compact formatting, so preserve the numeric value without inventing units.
  return parseNumber(raw);
}

function parseUsDate(raw: string): Date | null {
  const match = String(raw || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function groupFromRows(rows: any[], wanted: string, labelZh: string): InstitutionalPositionGroup {
  const row = rows.find(item => String(item?.positions || '').toLowerCase() === wanted.toLowerCase());
  return {
    label: String(row?.positions || wanted),
    labelZh,
    holders: parseNumber(row?.holders) || 0,
    shares: parseNumber(row?.shares) || 0,
  };
}

function classify(input: Pick<
  InstitutionalOwnershipSnapshot,
  'ownershipPct' | 'netSharePctOfHoldings' | 'netHolderBreadth' | 'topHolderNetShares' | 'dataAgeDays'
>): Pick<InstitutionalOwnershipSnapshot, 'signal' | 'signalZh' | 'adviceZh' | 'confidence'> {
  const { netSharePctOfHoldings, netHolderBreadth, topHolderNetShares, dataAgeDays } = input;
  let signal: InstitutionalOwnershipSnapshot['signal'] = 'neutral';
  let signalZh = '机构持仓中性';
  let adviceZh = '机构增减仓没有给出明显方向；这类慢钱更适合作为背景证据，交易仍以价格结构为主。';

  const bullish = netSharePctOfHoldings >= 1
    || (netSharePctOfHoldings > 0 && netHolderBreadth >= 2 && topHolderNetShares >= 0);
  const bearish = netSharePctOfHoldings <= -1
    || (netSharePctOfHoldings < 0 && netHolderBreadth <= -2 && topHolderNetShares <= 0);

  if (bullish && !bearish) {
    signal = 'accumulation';
    signalZh = '机构净增持';
    adviceZh = '机构增持家数或股数占优，中期筹码背景偏正面；若技术面同步走强，顺势信号更可信。';
  } else if (bearish && !bullish) {
    signal = 'distribution';
    signalZh = '机构净减持';
    adviceZh = '机构减持压力较明显，反弹时更关注放量衰竭和止损纪律，避免把下跌简单当成洗盘。';
  } else if (Math.abs(netSharePctOfHoldings) >= 0.5) {
    signal = 'mixed';
    signalZh = '机构分歧加大';
    adviceZh = '大资金同时增减仓，方向分歧明显：减少重仓押注单一信号，等待突破或跌破后的确认。';
  }

  const agePenalty = clamp((dataAgeDays - 45) * 0.15, 0, 20);
  const lowCoveragePenalty = input.ownershipPct <= 0 ? 25 : 0;
  return {
    signal,
    signalZh,
    adviceZh,
    confidence: Math.round(clamp(84 - agePenalty - lowCoveragePenalty, 45, 90)),
  };
}

async function requestSnapshot(symbolInput: string): Promise<InstitutionalOwnershipSnapshot> {
  const symbol = normalizeSymbol(symbolInput);
  const url = `https://api.nasdaq.com/api/company/${encodeURIComponent(symbol)}/institutional-holdings?limit=12`;
  // System curl passes where Node's fetch is sometimes challenged by Nasdaq.
  const { stdout } = await execFileAsync(
    'curl.exe',
    [
      '--fail', '--silent', '--show-error', '--max-time', '18',
      '-A', USER_AGENT,
      '-H', 'Accept: application/json, text/plain, */*',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      '-H', `Referer: https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(symbol.toLowerCase())}`,
      url,
    ],
    { timeout: 22_000, maxBuffer: 3 * 1024 * 1024, encoding: 'utf8' },
  );

  const payload: any = JSON.parse(stdout);
  const data = payload?.data;
  const activeRows = Array.isArray(data?.activePositions?.rows) ? data.activePositions.rows : [];
  const lifecycleRows = Array.isArray(data?.newSoldOutPositions?.rows) ? data.newSoldOutPositions.rows : [];
  const rawHolders = Array.isArray(data?.holdingsTransactions?.table?.rows)
    ? data.holdingsTransactions.table.rows
    : [];
  if (!activeRows.length && !rawHolders.length) throw new Error('暂无机构持仓数据');

  const ownershipPct = parseNumber(data?.ownershipSummary?.SharesOutstandingPCT?.value);
  const totalRow = activeRows.find((row: any) => String(row?.positions || '').includes('Total Institutional Shares'));
  const institutionalShares = parseNumber(totalRow?.shares) || activeRows
    .filter((row: any) => !String(row?.positions || '').includes('Total'))
    .reduce((sum: number, row: any) => sum + (parseNumber(row?.shares) || 0), 0);
  const totalHolders = parseNumber(totalRow?.holders) || parseNumber(data?.holdingsTransactions?.totalRecords) || 0;
  const sharesOutstanding = parseNumber(data?.ownershipSummary?.ShareoutstandingTotal?.value);
  const holdingsValueUsd = parseMillions(data?.ownershipSummary?.TotalHoldingsValue?.value);

  const increasedPositions = groupFromRows(activeRows, 'Increased Positions', '增持');
  const decreasedPositions = groupFromRows(activeRows, 'Decreased Positions', '减持');
  const heldPositions = groupFromRows(activeRows, 'Held Positions', '持有不动');
  const newPositions = groupFromRows(lifecycleRows, 'New Positions', '新建仓');
  const soldOutPositions = groupFromRows(lifecycleRows, 'Sold Out Positions', '清仓');

  const topHolders = rawHolders.map((row: any): InstitutionalHolder => ({
    name: String(row?.ownerName || '').trim(),
    reportDate: String(row?.date || '').trim(),
    shares: parseNumber(row?.sharesHeld),
    shareChange: parseNumber(row?.sharesChange) || 0,
    shareChangePct: Number.isFinite(parseNumber(row?.sharesChangePCT))
      ? round(parseNumber(row?.sharesChangePCT))
      : null,
    marketValueUsd: parseNumber(row?.marketValue),
  })).filter((row: InstitutionalHolder) => row.name && Number.isFinite(row.shares));

  const netShares = (increasedPositions.shares + newPositions.shares)
    - (decreasedPositions.shares + soldOutPositions.shares);
  const netSharePctOfHoldings = institutionalShares > 0 ? netShares / institutionalShares * 100 : 0;
  const activeHolders = increasedPositions.holders + decreasedPositions.holders
    + newPositions.holders + soldOutPositions.holders;
  const netHolderBreadth = activeHolders > 0
    ? ((increasedPositions.holders + newPositions.holders)
      - (decreasedPositions.holders + soldOutPositions.holders)) / activeHolders * 100
    : 0;
  const topHolderNetShares = topHolders.reduce((sum: number, row: InstitutionalHolder) => sum + row.shareChange, 0);

  const latestDate = topHolders
    .map((row: InstitutionalHolder) => parseUsDate(row.reportDate))
    .filter((date: Date | null): date is Date => date !== null)
    .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0];
  const dataAgeDays = latestDate
    ? clamp(Math.round((Date.now() - latestDate.getTime()) / 86_400_000), 0, 3650)
    : 9999;
  const latestReportDate = latestDate
    ? latestDate.toISOString().slice(0, 10)
    : '';

  const partial = {
    symbol,
    ownershipPct: round(ownershipPct, 2),
    totalHolders,
    institutionalShares,
    sharesOutstanding,
    holdingsValueUsd,
    increasedPositions,
    decreasedPositions,
    heldPositions,
    newPositions,
    soldOutPositions,
    netShares,
    netSharePctOfHoldings: round(netSharePctOfHoldings, 2),
    netHolderBreadth: round(netHolderBreadth, 1),
    topHolderNetShares,
    latestReportDate,
    dataAgeDays,
    topHolders: topHolders.slice(0, 12),
  };

  return {
    ...partial,
    ...classify(partial),
    source: 'Nasdaq public institutional holdings',
  };
}

export async function getInstitutionalOwnershipSnapshot(symbolInput: string): Promise<InstitutionalOwnershipSnapshot> {
  const symbol = normalizeSymbol(symbolInput);
  const cached = snapshotCache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;
  const value = requestSnapshot(symbol).catch(error => {
    snapshotCache.delete(symbol);
    throw error;
  });
  snapshotCache.set(symbol, { ts: Date.now(), value });
  return value;
}

export async function getInstitutionalOwnershipRadar(): Promise<InstitutionalOwnershipRadar> {
  // Keep this walk sequential: Nasdaq throttles bursts, and each result stays
  // independently cached for the dashboard's next assistant refresh.
  const settled: PromiseSettledResult<InstitutionalOwnershipSnapshot>[] = [];
  for (const symbol of ADVISOR_SYMBOLS) {
    try {
      settled.push({ status: 'fulfilled', value: await getInstitutionalOwnershipSnapshot(symbol) });
    } catch (error) {
      settled.push({ status: 'rejected', reason: error });
    }
  }

  const rows = settled.filter((item): item is PromiseFulfilledResult<InstitutionalOwnershipSnapshot> =>
    item.status === 'fulfilled').map(item => item.value);
  if (!rows.length) throw new Error('美股机构持仓数据暂时不可用');

  const failedSymbols = ADVISOR_SYMBOLS.filter(symbol => !rows.some(row => row.symbol === symbol));
  const accumulationCount = rows.filter(row => row.signal === 'accumulation').length;
  const distributionCount = rows.filter(row => row.signal === 'distribution').length;
  const mixedCount = rows.filter(row => row.signal === 'mixed').length;
  const averageOwnershipPct = round(rows.reduce((sum, row) => sum + row.ownershipPct, 0) / rows.length);
  const score = rows.reduce((sum, row) => sum + (
    row.signal === 'accumulation' ? 0.8
      : row.signal === 'mixed' ? 0
        : row.signal === 'distribution' ? -0.8
          : 0
  ), 0);
  const regimeBoost = round(clamp(score, -2, 2));
  const focus = rows.filter(row => row.signal !== 'neutral')
    .sort((a, b) => b.netSharePctOfHoldings - a.netSharePctOfHoldings)
    .slice(0, 4)
    .map(row => `${row.symbol} ${row.signalZh} (${row.netSharePctOfHoldings > 0 ? '+' : ''}${row.netSharePctOfHoldings}%)`)
    .join('、');
  const summaryZh = `已跟踪 ${rows.length} 只美股，平均机构持股 ${averageOwnershipPct}%；${focus || '整体机构仓位变化中性'}。`;
  const advisorBiasZh = regimeBoost > 0.4
    ? '机构筹码呈净增持背景，对顺势多头略偏支持，但仍需价格与成交确认。'
    : regimeBoost < -0.4
      ? '机构筹码呈减持背景，反弹质量要求更高，避免逆势重仓。'
      : '机构增减仓相互抵消，没有给出明显的环境加分。';

  return {
    rows,
    failedSymbols,
    accumulationCount,
    distributionCount,
    mixedCount,
    averageOwnershipPct,
    summaryZh,
    advisorBiasZh,
    regimeBoost,
    generatedAt: new Date().toISOString(),
    source: 'Nasdaq public institutional holdings',
  };
}
