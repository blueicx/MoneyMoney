/**
 * SEC EDGAR fundamental-quality radar.
 *
 * Uses official keyless XBRL company facts from annual 10-K reports. The goal
 * is a conservative research score--not an autonomous stock recommendation.
 */

import { loadTickerRecords } from './insider-transactions';

export interface FundamentalHistoryPoint {
  endDate: string;
  revenueUsd: number | null;
  netMarginPct: number | null;
  operatingCashFlowMarginPct: number | null;
  currentRatio: number | null;
}

export interface FundamentalMetrics {
  revenueGrowthPct: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  operatingCashFlowMarginPct: number | null;
  cashConversionRatio: number | null;
  accrualRatioPct: number | null;
  currentRatio: number | null;
  liabilitiesToAssetsPct: number | null;
  returnOnEquityPct: number | null;
}

export interface FundamentalRadarResult {
  symbol: string;
  cik: string;
  companyName: string;
  updatedAt: string;
  fiscalPeriodEnd: string;
  reportFiledAt: string;
  dataAgeDays: number;
  score: number;
  confidence: number;
  signalZh: string;
  adviceZh: string;
  metrics: FundamentalMetrics;
  history: FundamentalHistoryPoint[];
  missingFields: string[];
  sources: string[];
}

interface XbrlEntry {
  start?: string;
  end: string;
  val: number;
  form?: string;
  fp?: string;
  filed?: string;
}

interface CompanyFacts {
  cik?: number;
  entityName?: string;
  facts?: Record<string, Record<string, {
    units?: Record<string, XbrlEntry[]>;
  }>>;
}

const USER_AGENT = 'MoneyMoney/1.0 (keyless research; contact@moneymoney.app)';
const CACHE_TTL = 12 * 60 * 60_000;
const resultCache = new Map<string, { ts: number; value: FundamentalRadarResult }>();
const inflight = new Map<string, Promise<FundamentalRadarResult>>();

function round(value: number | null, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeRatio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || !denominator) return null;
  return numerator / denominator;
}

async function fetchCompanyFacts(cik: string): Promise<CompanyFacts> {
  const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, '0')}.json`, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
  return response.json() as Promise<CompanyFacts>;
}

function isInstant(entry: XbrlEntry): boolean {
  return !entry.start;
}

function isAnnualDuration(entry: XbrlEntry): boolean {
  if (!entry.start) return false;
  const days = (Date.parse(entry.end) - Date.parse(entry.start)) / 86_400_000;
  return days >= 300 && days <= 400;
}

function annualEntries(
  facts: CompanyFacts,
  tags: string[],
  instant = false
): Array<{ tag: string; entry: XbrlEntry }> {
  const gaap = facts.facts?.['us-gaap'] || {};
  const output: Array<{ tag: string; entry: XbrlEntry }> = [];

  for (const tag of tags) {
    const entries = gaap[tag]?.units?.USD || [];
    const selected = new Map<string, XbrlEntry>();
    for (const entry of entries) {
      if (!Number.isFinite(entry.val)) continue;
      if (isInstant(entry) !== instant) continue;
      if (instant ? false : !isAnnualDuration(entry)) continue;
      if (!['10-K', '10-K/A'].includes(String(entry.form || '').toUpperCase())) continue;
      if (String(entry.fp || '').toUpperCase() !== 'FY') continue;
      const previous = selected.get(entry.end);
      if (!previous || String(entry.filed || '').localeCompare(String(previous.filed || '')) > 0) {
        selected.set(entry.end, entry);
      }
    }
    for (const entry of selected.values()) output.push({ tag, entry });
  }

  const uniqueByPeriod = new Map<string, { tag: string; entry: XbrlEntry }>();
  for (const row of output.sort((a, b) => b.entry.end.localeCompare(a.entry.end))) {
    // Candidate tags are intentionally ordered from newest to legacy taxonomy.
    if (!uniqueByPeriod.has(row.entry.end)) uniqueByPeriod.set(row.entry.end, row);
  }
  return [...uniqueByPeriod.values()];
}

function latestEntry(
  facts: CompanyFacts,
  tags: string[],
  instant = false
): { tag: string; entry: XbrlEntry } | null {
  return annualEntries(facts, tags, instant)[0] || null;
}

function entryForEnd(
  facts: CompanyFacts,
  tags: string[],
  end: string,
  instant = true
): number | null {
  const rows = annualEntries(facts, tags, instant);
  const exact = rows.find(row => row.entry.end === end);
  if (exact) return exact.entry.val;
  const toleranceMs = 130 * 86_400_000;
  const near = rows
    .map(row => ({ row, distance: Math.abs(Date.parse(row.entry.end) - Date.parse(end)) }))
    .filter(item => item.distance <= toleranceMs)
    .sort((a, b) => a.distance - b.distance)[0];
  return near?.row.entry.val ?? null;
}

function growthPct(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || !previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function marginPct(value: number | null, revenue: number | null): number | null {
  const ratio = safeRatio(value, revenue);
  return ratio == null ? null : ratio * 100;
}

function bandScore(value: number | null, bands: Array<[number, number]>, reverse = false): number {
  if (value == null) return 0;
  for (const [threshold, points] of bands) {
    if ((!reverse && value >= threshold) || (reverse && value <= threshold)) return points;
  }
  return 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function buildSignal(score: number, metrics: FundamentalMetrics, ageDays: number) {
  let signalZh = '基本面混合，需更多验证';
  let adviceZh = '盈利与资产负债表信号不一致；把它作为筛选背景，等待价格结构、现金流和下一期财报共同确认。';

  if (score >= 80) {
    signalZh = '高质量成长型基本面';
    adviceZh = '增长、利润率和现金转化都较强；适合列入观察清单，但避免在估值和情绪过热时重仓追高。';
  } else if (score >= 66) {
    signalZh = '基本面偏强';
    adviceZh = '核心盈利质量较好；可关注回调到关键支撑后的机会，并把财报日和市场风险放在前面。';
  } else if (score >= 50) {
    signalZh = '基本面中性';
    adviceZh = '没有明显短板，也没有足够强的优势；优先看行业景气度和技术面是否给出额外确认。';
  } else if (score >= 34) {
    signalZh = '基本面偏弱';
    adviceZh = '增长或盈利质量存在瑕疵；若持仓，降低仓位并设定更严格的止损，避免用故事弥补数据。';
  } else {
    signalZh = '高风险基本面';
    adviceZh = '利润、现金或负债压力明显；只适合小仓位事件观察，不适合当作稳健核心持仓。';
  }

  if (metrics.cashConversionRatio != null && metrics.cashConversionRatio < 0.65 &&
    (metrics.netMarginPct ?? 0) > 0) {
    adviceZh += ' 注意：净利润明显高于经营现金流，应核对应收、库存或会计确认节奏。';
  }
  if (metrics.currentRatio != null && metrics.currentRatio < 1.05) {
    adviceZh += ' 短期偿债缓冲偏紧，留意再融资和营运资金变化。';
  }
  if ((metrics.liabilitiesToAssetsPct ?? 0) > 78) {
    adviceZh += ' 负债占总资产比例偏高，利率上行或收入下滑时会放大风险。';
  }
  if (ageDays > 420) {
    adviceZh += ' 官方年报数据较旧，最新季度变化可能尚未体现。';
  }

  return { signalZh, adviceZh };
}

function buildResult(symbol: string, facts: CompanyFacts): FundamentalRadarResult {
  const revenue = latestEntry(facts, [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
  ]);
  const netIncome = latestEntry(facts, ['NetIncomeLoss', 'ProfitLoss']);
  if (!revenue || !netIncome) throw new Error('SEC 年度营收或净利润数据不足');

  // Prefer a fiscal year where the three core flow statements align.
  const revenueRows = annualEntries(facts, [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
  ]);
  const netRows = annualEntries(facts, ['NetIncomeLoss', 'ProfitLoss']);
  const cashRows = annualEntries(facts, ['NetCashProvidedByUsedInOperatingActivities']);
  const coreEnds = new Set(revenueRows.map(row => row.entry.end));
  const netEnds = new Set(netRows.map(row => row.entry.end));
  const cashEnds = new Set(cashRows.map(row => row.entry.end));
  const alignedEnds = [...coreEnds].filter(end => netEnds.has(end) && cashEnds.has(end)).sort().reverse();
  const fiscalPeriodEnd = alignedEnds[0] || revenue.entry.end;

  const valueAt = (tags: string[], instant = false) =>
    entryForEnd(facts, tags, fiscalPeriodEnd, instant);

  const revenueUsd = valueAt([
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
  ]);
  const netIncomeUsd = valueAt(['NetIncomeLoss', 'ProfitLoss']);
  const operatingCashFlowUsd = valueAt(['NetCashProvidedByUsedInOperatingActivities']);
  const grossProfitUsd = valueAt(['GrossProfit']);
  const operatingIncomeUsd = valueAt(['OperatingIncomeLoss']);
  const totalAssetsUsd = valueAt(['Assets'], true);
  const currentAssetsUsd = valueAt(['AssetsCurrent'], true);
  const currentLiabilitiesUsd = valueAt(['LiabilitiesCurrent'], true);
  const totalLiabilitiesUsd = valueAt(['Liabilities'], true);
  const equityUsd = valueAt(['StockholdersEquity'], true);

  // Find the immediately preceding comparable fiscal year.
  const priorEnd = revenueRows
    .map(row => row.entry.end)
    .filter(end => end < fiscalPeriodEnd)
    .sort()
    .reverse()[0];
  const priorValueAt = (tags: string[], instant = false) =>
    priorEnd ? entryForEnd(facts, tags, priorEnd, instant) : null;
  const priorRevenue = priorValueAt([
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
  ]);
  const priorNetIncome = priorValueAt(['NetIncomeLoss', 'ProfitLoss']);
  const priorOperatingCashFlow = priorValueAt(['NetCashProvidedByUsedInOperatingActivities']);
  const priorCurrentAssets = priorValueAt(['AssetsCurrent'], true);
  const priorCurrentLiabilities = priorValueAt(['LiabilitiesCurrent'], true);

  const metrics: FundamentalMetrics = {
    revenueGrowthPct: round(growthPct(revenueUsd, priorRevenue), 1),
    grossMarginPct: round(marginPct(grossProfitUsd, revenueUsd), 1),
    operatingMarginPct: round(marginPct(operatingIncomeUsd, revenueUsd), 1),
    netMarginPct: round(marginPct(netIncomeUsd, revenueUsd), 1),
    operatingCashFlowMarginPct: round(marginPct(operatingCashFlowUsd, revenueUsd), 1),
    cashConversionRatio: round(safeRatio(operatingCashFlowUsd, netIncomeUsd)),
    accrualRatioPct: round(marginPct(
      netIncomeUsd != null && operatingCashFlowUsd != null && totalAssetsUsd
        ? netIncomeUsd - operatingCashFlowUsd
        : null,
      totalAssetsUsd
    ), 1),
    currentRatio: round(safeRatio(currentAssetsUsd, currentLiabilitiesUsd)),
    liabilitiesToAssetsPct: round(marginPct(totalLiabilitiesUsd, totalAssetsUsd), 1),
    returnOnEquityPct: round(marginPct(netIncomeUsd, equityUsd), 1),
  };

  const priorNetMargin = marginPct(priorNetIncome, priorRevenue);
  const priorOcfMargin = marginPct(priorOperatingCashFlow, priorRevenue);
  const priorCurrentRatio = safeRatio(priorCurrentAssets, priorCurrentLiabilities);

  let score = 0;
  score += bandScore(metrics.revenueGrowthPct, [[15, 18], [8, 15], [3, 11], [0, 7], [-8, 4]]);
  score += bandScore(metrics.netMarginPct, [[20, 13], [12, 10], [6, 7], [1, 4], [0, 1]]);
  score += bandScore(metrics.operatingMarginPct, [[22, 8], [14, 6], [7, 4], [2, 2]]);
  score += bandScore(metrics.grossMarginPct, [[50, 5], [35, 4], [22, 3], [12, 1]]);
  score += bandScore(metrics.cashConversionRatio, [[1.08, 13], [0.92, 11], [0.75, 8], [0.55, 4]]);
  score += bandScore(metrics.accrualRatioPct, [[2, 8], [6, 6], [12, 3]], true);
  score += bandScore(metrics.currentRatio, [[1.8, 9], [1.25, 7], [1.05, 5]]);
  score += bandScore(metrics.liabilitiesToAssetsPct, [[48, 9], [68, 6], [84, 3]], true);
  score += bandScore(metrics.returnOnEquityPct, [[20, 12], [12, 9], [6, 6], [1, 3]]);
  score = clamp(Math.round(score), 0, 100);

  if ((metrics.netMarginPct ?? 0) >= (priorNetMargin ?? -999) + 0.5 &&
    (metrics.revenueGrowthPct ?? -999) > 0) score = clamp(score + 2, 0, 100);
  if ((metrics.operatingCashFlowMarginPct ?? -999) >= (priorOcfMargin ?? -999) + 0.5) score = clamp(score + 1, 0, 100);
  if (priorCurrentRatio != null && (metrics.currentRatio ?? 999) < priorCurrentRatio - 0.18) score = clamp(score - 2, 0, 100);

  const history: FundamentalHistoryPoint[] = [];
  const recentRevenue = revenueRows.filter(row => row.entry.end <= fiscalPeriodEnd).slice(0, 3).reverse();
  for (const row of recentRevenue) {
    const pointNet = netRows.find(item => item.entry.end === row.entry.end)?.entry.val ?? null;
    const pointCash = cashRows.find(item => item.entry.end === row.entry.end)?.entry.val ?? null;
    history.push({
      endDate: row.entry.end,
      revenueUsd: round(row.entry.val, 0),
      netMarginPct: round(marginPct(pointNet, row.entry.val), 1),
      operatingCashFlowMarginPct: round(marginPct(pointCash, row.entry.val), 1),
      currentRatio: round(safeRatio(
        entryForEnd(facts, ['AssetsCurrent'], row.entry.end, true),
        entryForEnd(facts, ['LiabilitiesCurrent'], row.entry.end, true)
      )),
    });
  }

  const reportCandidates = [netIncome?.entry, revenue.entry]
    .map(entry => String(entry?.filed || entry?.end || ''))
    .filter(Boolean)
    .sort()
    .reverse();
  const reportFiledAt = reportCandidates[0] || fiscalPeriodEnd;
  const dataAgeDays = Math.max(0, Math.round((Date.now() - Date.parse(reportFiledAt)) / 86_400_000));
  const missingFields = Object.entries(metrics)
    .filter(([, value]) => value == null)
    .map(([name]) => name);
  const coverage = (missingFields.length ? 10 - missingFields.length : 10) / 10;
  const confidence = Math.round(clamp(38 + coverage * 42 - Math.min(16, dataAgeDays / 40), 30, 88));
  const signal = buildSignal(score, metrics, dataAgeDays);
  const cik = String(facts.cik || '');

  return {
    symbol: symbol.toUpperCase(),
    cik,
    companyName: facts.entityName || symbol.toUpperCase(),
    updatedAt: new Date().toISOString(),
    fiscalPeriodEnd,
    reportFiledAt,
    dataAgeDays,
    score,
    confidence,
    signalZh: signal.signalZh,
    adviceZh: signal.adviceZh,
    metrics,
    history,
    missingFields,
    sources: [
      'SEC EDGAR XBRL companyfacts',
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik.padStart(10, '0')}&type=10-K`,
    ],
  };
}

export async function getFundamentalQuality(rawSymbol: string): Promise<FundamentalRadarResult> {
  const symbol = String(rawSymbol || '').trim().toUpperCase().replace(/^US/, '');
  if (!/^[A-Z]{1,6}$/.test(symbol)) throw new Error('请输入有效的美股代码');

  const cacheKey = symbol;
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const task = (async (): Promise<FundamentalRadarResult> => {
    const records = await loadTickerRecords();
    const record = records.find(item => item.ticker === symbol);
    if (!record) throw new Error(`SEC 未找到 ${symbol}`);
    const facts = await fetchCompanyFacts(record.cik);
    const result = buildResult(symbol, { ...facts, cik: Number(record.cik) });
    resultCache.set(cacheKey, { ts: Date.now(), value: result });
    return result;
  })();

  inflight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inflight.delete(cacheKey);
  }
}
