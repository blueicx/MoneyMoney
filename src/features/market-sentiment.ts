/**
 * Free keyless market sentiment indicators:
 * - Fear & Greed Index from alternative.me
 * - Binance Funding Rates (public endpoint)
 */

export interface FearGreedEntry {
  value: number;
  classification: string;
  classificationZh: string;
  timestamp: string;
}

export interface FearGreedResult {
  source: 'alternative.me API';
  fetchedAt: string;
  current: FearGreedEntry;
  yesterday: FearGreedEntry | null;
  lastWeek: FearGreedEntry | null;
  trend7d: { date: string; value: number }[];
}

export interface FundingRateRow {
  symbol: string;
  fundingRatePct: number;
  nextFundingTime: string;
  fundingIntervalSeconds: number | null;
  annualizedPct: number | null;
}

export interface FundingRatesResult {
  market: 'crypto';
  source: 'Gate.io Public API';
  fetchedAt: string;
  sourceUpdatedAt: null;
  dataStatus: 'partial' | 'empty' | 'unavailable';
  cacheStatus: 'hit' | 'miss';
  reason: string | null;
  coverage: {
    sourceContractCount: number;
    validFundingRateCount: number;
    invalidFundingRateCount: number;
  };
  rows: FundingRateRow[];
  majorContracts: FundingRateRow[];
  avgFundingPct: number | null;
  extremePositive: FundingRateRow | null;
  extremeNegative: FundingRateRow | null;
}

export interface MajorFundingSummary {
  coverage: number;
  averagePct: number | null;
  bias: string;
  warning: string | null;
}

const MAJOR_FUNDING_SYMBOLS = ['BTC_USDT', 'ETH_USDT', 'BNB_USDT', 'SOL_USDT'] as const;

interface FundingRatesSnapshot extends Omit<FundingRatesResult, 'rows' | 'majorContracts' | 'cacheStatus'> {
  allRows: FundingRateRow[];
}

const CACHE_TTL_MS = 120_000;
const cache = new Map<string, { ts: number; value: any }>();

function fromCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.ts > CACHE_TTL_MS) return null;
  return entry.value as T;
}

function toCache(key: string, value: any): void {
  cache.set(key, { ts: Date.now(), value });
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function classifyFearGreedZh(value: number): string {
  if (value <= 24) return '\u6781\u5ea6\u6050\u60e7';
  if (value <= 44) return '\u6050\u60e7';
  if (value <= 55) return '\u4e2d\u6027';
  if (value <= 74) return '\u8d2a\u5a6a';
  return '\u6781\u5ea6\u8d2a\u5a6a';
}

function toFearGreedEntry(item: any): FearGreedEntry {
  const value = Number(item.value) || 0;
  return {
    value,
    classification: item.value_classification || '',
    classificationZh: classifyFearGreedZh(value),
    timestamp: item.timestamp
      ? new Date(Number(item.timestamp) * 1000).toISOString()
      : '',
  };
}

export async function getFearGreed(): Promise<FearGreedResult> {
  const cached = fromCache<FearGreedResult>('fear-greed');
  if (cached) return cached;
  const payload = await fetchJson('https://api.alternative.me/fng/?limit=8');
  const data = Array.isArray(payload?.data) ? payload.data : [];
  if (!data.length) throw new Error('fear-greed empty');

  const entries = data.map(toFearGreedEntry);
  const trend = [...entries].reverse().map(entry => ({
    date: entry.timestamp ? entry.timestamp.slice(0, 10) : '',
    value: entry.value,
  }));

  const result: FearGreedResult = {
    source: 'alternative.me API',
    fetchedAt: new Date().toISOString(),
    current: entries[0],
    yesterday: entries[1] || null,
    lastWeek: entries[6] || entries[entries.length - 1] || null,
    trend7d: trend.filter(t => t.date),
  };
  toCache('fear-greed', result);
  return result;
}

export async function getFundingRates(limit = 20): Promise<FundingRatesResult> {
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(100, Math.trunc(limit) || 20))
    : 20;
  const cached = fromCache<FundingRatesSnapshot>('funding-all-usdt');
  if (cached) return presentFundingRates(cached, normalizedLimit, 'hit');

  const payload = await fetchJson('https://api.gateio.ws/api/v4/futures/usdt/contracts');
  if (!Array.isArray(payload)) throw new Error('funding format error');

  const contracts = payload.filter((item: any) => String(item?.name || '').trim().toUpperCase().endsWith('_USDT'));
  const parsedRows = contracts.flatMap((item: any): FundingRateRow[] => {
    const rawRate = item?.funding_rate;
    const rate = typeof rawRate === 'number'
      ? (Number.isFinite(rawRate) ? rawRate : null)
      : typeof rawRate === 'string' && rawRate.trim() !== ''
        ? Number.isFinite(Number(rawRate)) ? Number(rawRate) : null
        : null;
    if (rate === null) return [];

    const nextApply = typeof item?.funding_next_apply === 'number' || typeof item?.funding_next_apply === 'string'
      ? Number(item.funding_next_apply)
      : NaN;
    const nextApplyDate = Number.isFinite(nextApply) && nextApply > 0
      ? new Date(nextApply * 1000)
      : null;
    const rawInterval = item?.funding_interval;
    const parsedInterval = typeof rawInterval === 'number'
      ? rawInterval
      : typeof rawInterval === 'string' && rawInterval.trim() !== ''
        ? Number(rawInterval)
        : NaN;
    const fundingIntervalSeconds = Number.isFinite(parsedInterval) && parsedInterval > 0
      ? parsedInterval
      : null;
    return [{
      symbol: String(item.name).trim().toUpperCase(),
      fundingRatePct: rate * 100,
      nextFundingTime: nextApplyDate && Number.isFinite(nextApplyDate.getTime())
        ? nextApplyDate.toLocaleTimeString('zh-CN', { hour12: false })
        : '',
      fundingIntervalSeconds,
      annualizedPct: fundingIntervalSeconds === null
        ? null
        : rate * ((365 * 24 * 60 * 60) / fundingIntervalSeconds) * 100,
    }];
  }).sort((a, b) => Math.abs(b.fundingRatePct) - Math.abs(a.fundingRatePct));

  const invalidFundingRateCount = contracts.length - parsedRows.length;
  const reason = contracts.length === 0
    ? 'Gate.io 接口成功响应，但没有符合命名规则的 USDT 永续合约记录'
    : parsedRows.length === 0
      ? `Gate.io 返回 ${contracts.length} 个 USDT 永续合约，但没有有效资金费率`
      : invalidFundingRateCount > 0
        ? `${contracts.length} 个 USDT 永续合约中 ${parsedRows.length} 个费率有效，${invalidFundingRateCount} 个费率字段无效；当前接入字段未提供可验证的本次费率观测时间，获取时间仅代表 MoneyMoney 请求时间`
        : '当前接入字段未提供可验证的本次费率观测时间；获取时间仅代表 MoneyMoney 请求时间，不能据此标记源端实时';
  const snapshot: FundingRatesSnapshot = {
    market: 'crypto',
    source: 'Gate.io Public API',
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: null,
    dataStatus: contracts.length === 0 ? 'empty' : parsedRows.length === 0 ? 'unavailable' : 'partial',
    reason,
    coverage: {
      sourceContractCount: contracts.length,
      validFundingRateCount: parsedRows.length,
      invalidFundingRateCount,
    },
    allRows: parsedRows,
    avgFundingPct: parsedRows.length
      ? Number((parsedRows.reduce((sum, row) => sum + row.fundingRatePct, 0) / parsedRows.length).toFixed(4))
      : null,
    extremePositive: parsedRows.find(row => row.fundingRatePct > 0) || null,
    extremeNegative: parsedRows.find(row => row.fundingRatePct < 0) || null,
  };
  toCache('funding-all-usdt', snapshot);
  return presentFundingRates(snapshot, normalizedLimit, 'miss');
}

function presentFundingRates(
  snapshot: FundingRatesSnapshot,
  limit: number,
  cacheStatus: FundingRatesResult['cacheStatus'],
): FundingRatesResult {
  const bySymbol = new Map(snapshot.allRows.map(row => [row.symbol.toUpperCase(), row]));
  return {
    market: snapshot.market,
    source: snapshot.source,
    fetchedAt: snapshot.fetchedAt,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    dataStatus: snapshot.dataStatus,
    cacheStatus,
    reason: snapshot.reason,
    coverage: snapshot.coverage,
    rows: snapshot.allRows.slice(0, limit),
    majorContracts: MAJOR_FUNDING_SYMBOLS.flatMap(symbol => {
      const row = bySymbol.get(symbol);
      return row ? [row] : [];
    }),
    avgFundingPct: snapshot.avgFundingPct,
    extremePositive: snapshot.extremePositive,
    extremeNegative: snapshot.extremeNegative,
  };
}

export function summarizeMajorFundingRates(rows: readonly FundingRateRow[]): MajorFundingSummary {
  const bySymbol = new Map(rows.map(row => [String(row.symbol).toUpperCase(), row]));
  const validRows = MAJOR_FUNDING_SYMBOLS.flatMap(symbol => {
    const row = bySymbol.get(symbol);
    return row && Number.isFinite(row.fundingRatePct) ? [row] : [];
  });
  if (validRows.length !== MAJOR_FUNDING_SYMBOLS.length) {
    const warning = `主要合约资金费率覆盖不足（${validRows.length}/${MAJOR_FUNDING_SYMBOLS.length}），不据此判断拥挤方向`;
    return { coverage: validRows.length, averagePct: null, bias: warning, warning };
  }

  const intervals = validRows.map(row => row.fundingIntervalSeconds);
  const comparableInterval = intervals[0];
  if (typeof comparableInterval !== 'number'
    || !Number.isFinite(comparableInterval)
    || comparableInterval <= 0
    || intervals.some(interval => interval !== comparableInterval)) {
    const warning = '主要合约资金费率周期口径不一致或缺失，不据此判断拥挤方向';
    return { coverage: validRows.length, averagePct: null, bias: warning, warning };
  }

  const averagePct = validRows.reduce((sum, row) => sum + row.fundingRatePct, 0) / validRows.length;
  const bias = averagePct > 0.03
    ? `主要合约资金费率偏高（均值 ${averagePct.toFixed(3)}%），多头拥挤，谨防回调`
    : averagePct < -0.01
      ? `主要合约资金费率偏低（均值 ${averagePct.toFixed(3)}%），空头压力较重，可能出现反弹`
      : `主要合约资金费率中性（均值 ${averagePct.toFixed(3)}%）`;
  return { coverage: validRows.length, averagePct, bias, warning: null };
}


