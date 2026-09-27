/**
 * SEC EDGAR fundamental-quality radar.
 *
 * Uses official keyless XBRL company facts from annual 10-K reports. The goal
 * is a conservative research score--not an autonomous stock recommendation.
 */

import { loadTickerRecords } from './insider-transactions';
import { buildSecHeaders } from './sec-edgar-client';

export interface FundamentalHistoryPoint {
  endDate: string;
  periodKey?: string;
  filedAt?: string;
  revenueUsd: number | null;
  netIncomeUsd?: number | null;
  operatingCashFlowUsd?: number | null;
  grossProfitUsd?: number | null;
  operatingIncomeUsd?: number | null;
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

export interface FundamentalFactor {
  label: string;
  value: string;
  reason: string;
}

export interface FundamentalFactors {
  supportingFactors: FundamentalFactor[];
  riskFactors: FundamentalFactor[];
}

export interface FundamentalRadarResult {
  symbol: string;
  cik: string;
  companyName: string;
  updatedAt: string;
  fiscalPeriodEnd: string;
  periodBasis: 'TTM' | 'Annual';
  reportFiledAt: string;
  dataAgeDays: number;
  score: number;
  confidence: number;
  signalZh: string;
  adviceZh: string;
  metrics: FundamentalMetrics;
  history: FundamentalHistoryPoint[];
  missingFields: string[];
  supportingFactors: FundamentalFactor[];
  riskFactors: FundamentalFactor[];
  sources: string[];
}

interface XbrlEntry {
  start?: string;
  end: string;
  val: number;
  form?: string;
  fp?: string;
  filed?: string;
  fy?: number;
}

interface CompanyFacts {
  cik?: number;
  entityName?: string;
  facts?: Record<string, Record<string, {
    units?: Record<string, XbrlEntry[]>;
  }>>;
}

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
      ...buildSecHeaders(),
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

function latestInstantValue(facts: CompanyFacts, tags: string[], input: { filedBy?: string; endBefore?: string }): number | null {
  const gaap = facts.facts?.['us-gaap'] || {};
  const filedBy = input.filedBy ? Date.parse(input.filedBy) : Infinity;
  let best: { entry: XbrlEntry; rank: number } | null = null;
  for (const [rank, tag] of tags.entries()) {
    const entries = gaap[tag]?.units?.USD || [];
    for (const entry of entries) {
      if (entry.start || !Number.isFinite(entry.val)) continue;
      if (!['10-K', '10-K/A', '10-Q', '10-Q/A'].includes(String(entry.form || '').toUpperCase())) continue;
      const filed = Date.parse(String(entry.filed || entry.end));
      if (filed > filedBy || (input.endBefore && entry.end > input.endBefore)) continue;
      if (!best || entry.end > best.entry.end || (entry.end === best.entry.end && rank < best.rank) ||
        (entry.end === best.entry.end && rank === best.rank && filed > Date.parse(String(best.entry.filed || best.entry.end)))) {
        best = { entry, rank };
      }
    }
  }
  return best?.entry.val ?? null;
}

interface FlowQuarterValue { endDate: string; value: number; filedAt: string }
const REVENUE_TAGS = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'Revenues', 'SalesRevenueNet'];

function entryDurationDays(entry: XbrlEntry): number | null {
  if (!entry.start) return null;
  const days = (Date.parse(entry.end) - Date.parse(entry.start)) / 86_400_000;
  return Number.isFinite(days) ? days : null;
}

function latestFiled(current: XbrlEntry | undefined, next: XbrlEntry): XbrlEntry {
  return !current || String(next.filed || '').localeCompare(String(current.filed || '')) > 0 ? next : current;
}

function quarterlyFlowValues(facts: CompanyFacts, tags: string[]): Map<string, FlowQuarterValue> {
  const output = new Map<string, FlowQuarterValue>();
  const gaap = facts.facts?.['us-gaap'] || {};
  for (const tag of tags) {
    const entries = gaap[tag]?.units?.USD || [];
    const direct = new Map<string, XbrlEntry>();
    const ytd = new Map<string, XbrlEntry>();
    const annual = new Map<number, XbrlEntry>();
    for (const entry of entries) {
      if (!Number.isFinite(entry.val) || !entry.start) continue;
      const form = String(entry.form || '').toUpperCase();
      if (!['10-Q', '10-Q/A', '10-K', '10-K/A'].includes(form)) continue;
      const fp = String(entry.fp || '').toUpperCase();
      const fy = Number(entry.fy) || Number(entry.end.slice(0, 4));
      const days = entryDurationDays(entry);
      if (!Number.isFinite(fy) || days == null) continue;
      const directMatch = /^Q([1-4])$/.exec(fp);
      if (directMatch && days >= 70 && days <= 110) {
        const key = `${fy}:Q${directMatch[1]}`;
        direct.set(key, latestFiled(direct.get(key), entry));
      }
      const ytdQuarter = /^Q([1-3])$/.exec(fp);
      if (ytdQuarter) {
        const quarter = Number(ytdQuarter[1]);
        const bounds: Record<number, [number, number]> = { 1: [45, 130], 2: [150, 230], 3: [240, 330] };
        const [minimum, maximum] = bounds[quarter];
        if (days >= minimum && days <= maximum) {
          const key = `${fy}:Q${quarter}`;
          ytd.set(key, latestFiled(ytd.get(key), entry));
        }
      }
      if (fp === 'FY' && ['10-K', '10-K/A'].includes(form) && days >= 300 && days <= 400) {
        annual.set(fy, latestFiled(annual.get(fy), entry));
      }
    }

    const fiscalYears = new Set<number>();
    for (const key of [...direct.keys(), ...ytd.keys()]) fiscalYears.add(Number(key.split(':')[0]));
    for (const fy of [...fiscalYears].sort((a, b) => a - b)) {
      const qValues: Array<{ value: number; endDate: string; filedAt: string } | null> = [null];
      for (let quarter = 1; quarter <= 3; quarter += 1) {
        const key = `${fy}:Q${quarter}`;
        const directEntry = direct.get(key);
        if (directEntry) {
          qValues[quarter] = { value: directEntry.val, endDate: directEntry.end, filedAt: directEntry.filed || directEntry.end };
          continue;
        }
        const cumulative = ytd.get(key);
        if (!cumulative) { qValues[quarter] = null; continue; }
        const previousCumulative = quarter === 1 ? null : ytd.get(`${fy}:Q${quarter - 1}`);
        if (quarter > 1 && !previousCumulative) { qValues[quarter] = null; continue; }
        qValues[quarter] = {
          value: cumulative.val - (previousCumulative?.val || 0),
          endDate: cumulative.end,
          filedAt: cumulative.filed || cumulative.end,
        };
      }
      const q4Direct = direct.get(`${fy}:Q4`);
      const annualEntry = annual.get(fy);
      const q1ToQ3Available = qValues[1] && qValues[2] && qValues[3];
      if (q4Direct) qValues[4] = { value: q4Direct.val, endDate: q4Direct.end, filedAt: q4Direct.filed || q4Direct.end };
      else if (annualEntry && q1ToQ3Available) {
        qValues[4] = {
          value: annualEntry.val - qValues[1]!.value - qValues[2]!.value - qValues[3]!.value,
          endDate: annualEntry.end,
          filedAt: annualEntry.filed || annualEntry.end,
        };
      }
      for (let quarter = 1; quarter <= 4; quarter += 1) {
        const value = qValues[quarter];
        const key = `${fy}:Q${quarter}`;
        if (value && !output.has(key)) output.set(key, value);
      }
    }
  }
  return output;
}

export function buildQuarterlyFundamentalHistory(facts: CompanyFacts): FundamentalHistoryPoint[] {
  const series = {
    revenueUsd: quarterlyFlowValues(facts, REVENUE_TAGS),
    netIncomeUsd: quarterlyFlowValues(facts, ['NetIncomeLoss', 'ProfitLoss']),
    operatingCashFlowUsd: quarterlyFlowValues(facts, ['NetCashProvidedByUsedInOperatingActivities']),
    grossProfitUsd: quarterlyFlowValues(facts, ['GrossProfit']),
    operatingIncomeUsd: quarterlyFlowValues(facts, ['OperatingIncomeLoss']),
  };
  return [...series.revenueUsd.entries()].map(([periodKey, revenue]) => {
    const valueAt = (items: Map<string, FlowQuarterValue>) => items.get(periodKey)?.value ?? null;
    const netIncomeUsd = valueAt(series.netIncomeUsd);
    const operatingCashFlowUsd = valueAt(series.operatingCashFlowUsd);
    return {
      endDate: revenue.endDate,
      periodKey,
      filedAt: [revenue.filedAt, series.netIncomeUsd.get(periodKey)?.filedAt, series.operatingCashFlowUsd.get(periodKey)?.filedAt]
        .filter(Boolean).sort().at(-1),
      revenueUsd: round(revenue.value, 0),
      netIncomeUsd: round(netIncomeUsd, 0),
      operatingCashFlowUsd: round(operatingCashFlowUsd, 0),
      grossProfitUsd: round(valueAt(series.grossProfitUsd), 0),
      operatingIncomeUsd: round(valueAt(series.operatingIncomeUsd), 0),
      netMarginPct: round(marginPct(netIncomeUsd, revenue.value), 1),
      operatingCashFlowMarginPct: round(marginPct(operatingCashFlowUsd, revenue.value), 1),
      currentRatio: null,
    };
  }).sort((a, b) => a.endDate.localeCompare(b.endDate));
}

export function summarizeFundamentalTtm(history: FundamentalHistoryPoint[]) {
  const sorted = [...history].sort((a, b) => a.endDate.localeCompare(b.endDate));
  const current = sorted.slice(-4);
  if (current.length !== 4 || current.some((row, index) => {
    if (row.revenueUsd == null || row.netIncomeUsd == null || row.operatingCashFlowUsd == null) return true;
    if (!index) return false;
    const gap = (Date.parse(row.endDate) - Date.parse(current[index - 1].endDate)) / 86_400_000;
    return gap < 60 || gap > 130;
  })) return null;
  const previous = sorted.slice(-8, -4);
  const previousValid = previous.length === 4 && previous.every((row, index) => {
    if (row.revenueUsd == null || row.netIncomeUsd == null || row.operatingCashFlowUsd == null) return false;
    if (!index) return true;
    const gap = (Date.parse(row.endDate) - Date.parse(previous[index - 1].endDate)) / 86_400_000;
    return gap >= 60 && gap <= 130;
  });
  const sum = (rows: FundamentalHistoryPoint[], key: 'revenueUsd' | 'netIncomeUsd' | 'operatingCashFlowUsd' | 'grossProfitUsd' | 'operatingIncomeUsd') => {
    if (rows.some(row => row[key] == null)) return null;
    return rows.reduce((total, row) => total + Number(row[key]), 0);
  };
  const revenueUsd = sum(current, 'revenueUsd')!;
  const netIncomeUsd = sum(current, 'netIncomeUsd')!;
  const operatingCashFlowUsd = sum(current, 'operatingCashFlowUsd')!;
  const priorRevenueUsd = previousValid ? sum(previous, 'revenueUsd') : null;
  const priorNetIncomeUsd = previousValid ? sum(previous, 'netIncomeUsd') : null;
  const priorOperatingCashFlowUsd = previousValid ? sum(previous, 'operatingCashFlowUsd') : null;
  return {
    periodEnd: current[3].endDate,
    filedAt: current.map(row => row.filedAt || row.endDate).sort().at(-1) || current[3].endDate,
    revenueUsd, netIncomeUsd, operatingCashFlowUsd,
    grossProfitUsd: sum(current, 'grossProfitUsd'),
    operatingIncomeUsd: sum(current, 'operatingIncomeUsd'),
    priorRevenueUsd, priorNetIncomeUsd, priorOperatingCashFlowUsd,
    revenueGrowthPct: priorRevenueUsd == null ? null : round(growthPct(revenueUsd, priorRevenueUsd), 1),
  };
}

export function buildFundamentalFactors(metrics: FundamentalMetrics, score: number, ageDays: number): FundamentalFactors {
  const supportingFactors: FundamentalFactor[] = [];
  const riskFactors: FundamentalFactor[] = [];
  if ((metrics.revenueGrowthPct ?? -Infinity) >= 10) {
    supportingFactors.push({ label: '增长', value: `${metrics.revenueGrowthPct}%`, reason: '营收同比增长达到双位数。' });
  }
  if ((metrics.grossMarginPct ?? -Infinity) >= 40) {
    supportingFactors.push({ label: '毛利率', value: `${metrics.grossMarginPct}%`, reason: '毛利率显示产品或服务仍有较好的定价缓冲。' });
  }
  if ((metrics.cashConversionRatio ?? -Infinity) >= 0.95 && (metrics.operatingCashFlowMarginPct ?? -Infinity) > 0) {
    supportingFactors.push({ label: '现金流', value: `${metrics.cashConversionRatio}`, reason: '经营现金流与净利润匹配度较好。' });
  }
  if ((metrics.returnOnEquityPct ?? -Infinity) >= 15) {
    supportingFactors.push({ label: 'ROE', value: `${metrics.returnOnEquityPct}%`, reason: '股东资本回报率达到可观察水平。' });
  }
  if ((score >= 66) && supportingFactors.length === 0) {
    supportingFactors.push({ label: '综合评分', value: `${score}/100`, reason: '综合评分偏强，但仍需结合具体指标核对。' });
  }
  if ((metrics.cashConversionRatio ?? Infinity) < 0.65 && (metrics.netMarginPct ?? 0) > 0) {
    riskFactors.push({ label: '现金流', value: `${metrics.cashConversionRatio}`, reason: '净利润明显高于经营现金流，需核对应收、库存或会计确认节奏。' });
  }
  if ((metrics.currentRatio ?? Infinity) < 1.05) {
    riskFactors.push({ label: '偿债', value: `${metrics.currentRatio}`, reason: '流动比率偏低，短期营运资金缓冲较紧。' });
  }
  if ((metrics.liabilitiesToAssetsPct ?? -Infinity) > 78) {
    riskFactors.push({ label: '负债', value: `${metrics.liabilitiesToAssetsPct}%`, reason: '负债占总资产比例偏高，利率或收入变化会放大压力。' });
  }
  if ((metrics.revenueGrowthPct ?? 0) < 0) {
    riskFactors.push({ label: '增长', value: `${metrics.revenueGrowthPct}%`, reason: '营收同比收缩，需确认是周期性还是结构性问题。' });
  }
  if (ageDays > 420) {
    riskFactors.push({ label: '数据新鲜度', value: `${ageDays} 天`, reason: '最新年度报告较旧，季度变化可能尚未体现。' });
  }
  return { supportingFactors, riskFactors };
}

export function buildFundamentalSignal(score: number, metrics: FundamentalMetrics, ageDays: number, periodBasis: 'TTM' | 'Annual' = 'Annual') {
  const sampleLabel = periodBasis === 'TTM' ? '最近四个已披露季度的 TTM 样本' : '最近可用的年度申报样本';
  let signalZh = '基本面混合，需更多验证';
  let adviceZh = `${sampleLabel}中的盈利与资产负债表指标方向不一致；请结合下方指标、缺失字段和披露日期理解结果。`;

  if (score >= 80) {
    signalZh = '高质量成长型基本面';
    adviceZh = `${sampleLabel}中的营收增长、利润率和现金转换指标较强；该结果反映历史财务披露，不代表未来表现。`;
  } else if (score >= 66) {
    signalZh = '基本面偏强';
    adviceZh = `${sampleLabel}中的核心盈利指标偏强；评分未涵盖估值、行业周期和披露后的经营变化。`;
  } else if (score >= 50) {
    signalZh = '基本面中性';
    adviceZh = `${sampleLabel}未显示突出的强项或短板；部分指标可能受行业差异和会计口径影响。`;
  } else if (score >= 34) {
    signalZh = '基本面偏弱';
    adviceZh = `${sampleLabel}中的增长或盈利指标偏弱；相关风险项列于下方，不能据此推断短期价格方向。`;
  } else {
    signalZh = '高风险基本面';
    adviceZh = `${sampleLabel}中的利润、现金流或负债指标存在明显压力；需结合原始 SEC 申报和后续披露核对。`;
  }

  if (metrics.cashConversionRatio != null && metrics.cashConversionRatio < 0.65 &&
    (metrics.netMarginPct ?? 0) > 0) {
    adviceZh += ' 现金转换比率偏低：净利润与经营现金流的差异较大。';
  }
  if (metrics.currentRatio != null && metrics.currentRatio < 1.05) {
    adviceZh += ' 流动比率偏低，短期资产对流动负债的覆盖较弱。';
  }
  if ((metrics.liabilitiesToAssetsPct ?? 0) > 78) {
    adviceZh += ' 负债占总资产比例偏高，可能增加利率和收入变化带来的敏感性。';
  }
  if (ageDays > 420) {
    adviceZh += ` 最近纳入的官方申报距今 ${ageDays} 天；此后发布的数据尚未计入。`;
  }

  return { signalZh, adviceZh };
}

function buildResult(symbol: string, facts: CompanyFacts): FundamentalRadarResult {
  const quarterlyHistory = buildQuarterlyFundamentalHistory(facts);
  const ttm = summarizeFundamentalTtm(quarterlyHistory);
  const revenue = latestEntry(facts, [
    ...REVENUE_TAGS,
  ]);
  const netIncome = latestEntry(facts, ['NetIncomeLoss', 'ProfitLoss']);
  if ((!revenue || !netIncome) && !ttm) throw new Error('SEC 年度或季度营收、净利润数据不足');

  // Keep annual values as an explicit fallback; use TTM only when four contiguous reported quarters align.
  const revenueRows = annualEntries(facts, REVENUE_TAGS);
  const netRows = annualEntries(facts, ['NetIncomeLoss', 'ProfitLoss']);
  const cashRows = annualEntries(facts, ['NetCashProvidedByUsedInOperatingActivities']);
  const coreEnds = new Set(revenueRows.map(row => row.entry.end));
  const netEnds = new Set(netRows.map(row => row.entry.end));
  const cashEnds = new Set(cashRows.map(row => row.entry.end));
  const alignedEnds = [...coreEnds].filter(end => netEnds.has(end) && cashEnds.has(end)).sort().reverse();
  const annualFiscalPeriodEnd = alignedEnds[0] || revenue?.entry.end || '';
  const fiscalPeriodEnd = ttm?.periodEnd || annualFiscalPeriodEnd;
  if (!fiscalPeriodEnd) throw new Error('SEC 没有可用的基本面报告期');

  const valueAt = (tags: string[], instant = false) =>
    entryForEnd(facts, tags, annualFiscalPeriodEnd, instant);

  const annualRevenueUsd = annualFiscalPeriodEnd ? valueAt(REVENUE_TAGS) : revenue?.entry.val ?? null;
  const annualNetIncomeUsd = annualFiscalPeriodEnd ? valueAt(['NetIncomeLoss', 'ProfitLoss']) : netIncome?.entry.val ?? null;
  const annualOperatingCashFlowUsd = annualFiscalPeriodEnd ? valueAt(['NetCashProvidedByUsedInOperatingActivities']) : null;
  const annualGrossProfitUsd = annualFiscalPeriodEnd ? valueAt(['GrossProfit']) : null;
  const annualOperatingIncomeUsd = annualFiscalPeriodEnd ? valueAt(['OperatingIncomeLoss']) : null;
  const balanceAsOf = ttm?.filedAt || netIncome?.entry.filed || revenue?.entry.filed || annualFiscalPeriodEnd;
  const totalAssetsUsd = latestInstantValue(facts, ['Assets'], { filedBy: balanceAsOf });
  const currentAssetsUsd = latestInstantValue(facts, ['AssetsCurrent'], { filedBy: balanceAsOf });
  const currentLiabilitiesUsd = latestInstantValue(facts, ['LiabilitiesCurrent'], { filedBy: balanceAsOf });
  const totalLiabilitiesUsd = latestInstantValue(facts, ['Liabilities'], { filedBy: balanceAsOf });
  const equityUsd = latestInstantValue(facts, ['StockholdersEquity'], { filedBy: balanceAsOf });
  const revenueUsd = ttm?.revenueUsd ?? annualRevenueUsd;
  const netIncomeUsd = ttm?.netIncomeUsd ?? annualNetIncomeUsd;
  const operatingCashFlowUsd = ttm?.operatingCashFlowUsd ?? annualOperatingCashFlowUsd;
  const grossProfitUsd = ttm ? ttm.grossProfitUsd : annualGrossProfitUsd;
  const operatingIncomeUsd = ttm ? ttm.operatingIncomeUsd : annualOperatingIncomeUsd;

  // Find the immediately preceding comparable fiscal year.
  const priorEnd = revenueRows
    .map(row => row.entry.end)
    .filter(end => end < annualFiscalPeriodEnd)
    .sort()
    .reverse()[0];
  const priorValueAt = (tags: string[], instant = false) =>
    priorEnd ? entryForEnd(facts, tags, priorEnd, instant) : null;
  const priorRevenue = ttm ? ttm.priorRevenueUsd : priorValueAt(REVENUE_TAGS);
  const priorNetIncome = ttm ? ttm.priorNetIncomeUsd : priorValueAt(['NetIncomeLoss', 'ProfitLoss']);
  const priorOperatingCashFlow = ttm ? ttm.priorOperatingCashFlowUsd : priorValueAt(['NetCashProvidedByUsedInOperatingActivities']);
  const priorAsOf = priorEnd || annualFiscalPeriodEnd;
  const priorCurrentAssets = latestInstantValue(facts, ['AssetsCurrent'], { filedBy: balanceAsOf, endBefore: priorAsOf });
  const priorCurrentLiabilities = latestInstantValue(facts, ['LiabilitiesCurrent'], { filedBy: balanceAsOf, endBefore: priorAsOf });

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

  const history: FundamentalHistoryPoint[] = ttm
    ? quarterlyHistory.slice(-8)
    : revenueRows.filter(row => row.entry.end <= annualFiscalPeriodEnd).slice(0, 3).reverse().map(row => {
      const pointNet = netRows.find(item => item.entry.end === row.entry.end)?.entry.val ?? null;
      const pointCash = cashRows.find(item => item.entry.end === row.entry.end)?.entry.val ?? null;
      return {
        endDate: row.entry.end, revenueUsd: round(row.entry.val, 0),
        netIncomeUsd: round(pointNet, 0), operatingCashFlowUsd: round(pointCash, 0),
        netMarginPct: round(marginPct(pointNet, row.entry.val), 1),
        operatingCashFlowMarginPct: round(marginPct(pointCash, row.entry.val), 1),
        currentRatio: round(safeRatio(
          entryForEnd(facts, ['AssetsCurrent'], row.entry.end, true),
          entryForEnd(facts, ['LiabilitiesCurrent'], row.entry.end, true)
        )),
      };
    });

  const reportCandidates = [netIncome?.entry, revenue?.entry]
    .map(entry => String(entry?.filed || entry?.end || ''))
    .filter(Boolean)
    .sort()
    .reverse();
  const reportFiledAt = ttm?.filedAt || reportCandidates[0] || fiscalPeriodEnd;
  const dataAgeDays = Math.max(0, Math.round((Date.now() - Date.parse(reportFiledAt)) / 86_400_000));
  const missingFields = Object.entries(metrics)
    .filter(([, value]) => value == null)
    .map(([name]) => name);
  const coverage = (missingFields.length ? 10 - missingFields.length : 10) / 10;
  const confidence = Math.round(clamp(38 + coverage * 42 - Math.min(16, dataAgeDays / 40), 30, 88));
  const periodBasis: 'TTM' | 'Annual' = ttm ? 'TTM' : 'Annual';
  const signal = buildFundamentalSignal(score, metrics, dataAgeDays, periodBasis);
  const factors = buildFundamentalFactors(metrics, score, dataAgeDays);
  const cik = String(facts.cik || '');

  return {
    symbol: symbol.toUpperCase(),
    cik,
    companyName: facts.entityName || symbol.toUpperCase(),
    updatedAt: new Date().toISOString(),
    fiscalPeriodEnd,
    periodBasis: ttm ? 'TTM' : 'Annual',
    reportFiledAt,
    dataAgeDays,
    score,
    confidence,
    signalZh: signal.signalZh,
    adviceZh: signal.adviceZh,
    metrics,
    history,
    missingFields,
    ...factors,
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
