/**
 * Keyless Nasdaq short-interest radar.
 * The public quote endpoint exposes the exchange's semi-monthly short interest,
 * average daily volume, and days-to-cover. It is contextual positioning data:
 * useful for crowding/squeeze risk, but never a standalone trade trigger.
 */

export interface ShortInterestPoint {
  settlementDate: string;
  interestShares: number;
  avgDailyShareVolume: number;
  daysToCover: number;
}

export interface ShortInterestSnapshot {
  symbol: string;
  companyName?: string;
  latest: ShortInterestPoint;
  previous?: ShortInterestPoint;
  history: ShortInterestPoint[];
  interestChangePct: number | null;
  daysToCoverChangePct: number | null;
  medianDaysToCover: number;
  daysToCoverPercentile: number;
  dataAgeDays: number;
  signal: 'squeeze-risk' | 'crowded' | 'covering' | 'light' | 'neutral';
  signalZh: string;
  adviceZh: string;
  confidence: number;
  source: string;
}

export interface ShortInterestRadar {
  rows: ShortInterestSnapshot[];
  failedSymbols: string[];
  crowdedCount: number;
  squeezeRiskCount: number;
  coveringCount: number;
  averageDaysToCover: number;
  summaryZh: string;
  advisorBiasZh: string;
  regimeBoost: number;
  generatedAt: string;
  source: string;
}

import { execFile } from 'child_process';
import { promisify } from 'util';

const ADVISOR_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'QQQ'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MoneyMoney/1.0';
const CACHE_TTL_MS = 15 * 60_000;

type CacheEntry = { ts: number; value: Promise<ShortInterestSnapshot> };
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
  if (!symbol || /[^A-Z0-9.-]/.test(symbol)) throw new Error('请输入有效的美股/ETF 代码');
  return symbol;
}

function parseNumber(raw: any): number {
  const value = Number(String(raw ?? '').replace(/[,+%]/g, ''));
  return Number.isFinite(value) ? value : NaN;
}

function parseSettlementDate(raw: any): Date | null {
  const match = String(raw ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function percentile(values: number[], value: number): number {
  if (!values.length || !Number.isFinite(value)) return 50;
  return clamp((values.filter(item => item <= value).length / values.length) * 100, 0, 100);
}

function classify(snapshot: Omit<ShortInterestSnapshot, 'signal' | 'signalZh' | 'adviceZh' | 'confidence' | 'source'>): Pick<
  ShortInterestSnapshot,
  'signal' | 'signalZh' | 'adviceZh' | 'confidence'
> {
  const { latest, interestChangePct, daysToCoverPercentile } = snapshot;
  const highDays = latest.daysToCover >= 4 || (latest.daysToCover >= 3 && daysToCoverPercentile >= 80);
  const risingInterest = (snapshot.interestChangePct ?? 0) > 5;
  const fallingInterest = (snapshot.interestChangePct ?? 0) < -5;
  let signal: ShortInterestSnapshot['signal'] = 'neutral';
  let signalZh = '空头中性';
  let adviceZh = '空头仓位和回补压力没有给出额外优势；仍以价格结构、基本面和市场风险为主。';

  if (highDays && risingInterest && latest.daysToCover >= 3) {
    signal = 'squeeze-risk';
    signalZh = '逼空风险升高';
    adviceZh = '空头利息上升且回补天数偏长：放量突破时可能被逼空放大涨幅，但下跌同样容易加速。若顺势参与，只用小仓并先定止损。';
  } else if (highDays) {
    signal = 'crowded';
    signalZh = '空头拥挤';
    adviceZh = '回补天数偏高，空头押注集中：不要盲目逆势做空；反弹可能更急，但拥挤本身不是买入理由，需等价格确认。';
  } else if (fallingInterest && latest.daysToCover <= 2.5) {
    signal = 'covering';
    signalZh = '空头回补';
    adviceZh = '空头利息下降且回补压力减轻，抛压背景略偏友好；趋势仍需成交量和价格共同确认。';
  } else if (latest.daysToCover <= 2) {
    signal = 'light';
    signalZh = '空头压力低';
    adviceZh = '空头规模相对成交量较低，逼空不是主要驱动；关注多空双方更常规的资金与技术证据。';
  }

  const agePenalty = clamp((snapshot.dataAgeDays - 20) * 0.8, 0, 25);
  const historyPenalty = snapshot.history.length < 8 ? 15 : 0;
  return {
    signal,
    signalZh,
    adviceZh,
    confidence: Math.round(clamp(88 - agePenalty - historyPenalty, 45, 92)),
  };
}

async function requestSnapshot(symbol: string): Promise<ShortInterestSnapshot> {
  const normalized = normalizeSymbol(symbol);
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(normalized)}/short-interest?limit=24&assetclass=stocks`;
  // Nasdaq challenges Node's TLS fingerprint, while the system curl client is
  // allowed through. Windows 10+ ships curl.exe.
  const { stdout } = await execFileAsync(
    'curl.exe',
    [
      '--fail', '--silent', '--show-error', '--max-time', '16',
      '-A', USER_AGENT,
      '-H', 'Accept: application/json, text/plain, */*',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      url,
    ],
    { timeout: 20_000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' },
  );
  const payload: any = JSON.parse(stdout);
  const rawRows = payload?.data?.shortInterestTable?.rows;
  if (!Array.isArray(rawRows) || !rawRows.length) throw new Error('暂无 Nasdaq 空头利息数据');

  type Point = ShortInterestPoint;
  const history = rawRows.map((row: any): Point | null => {
    const settlementDate = parseSettlementDate(row.settlementDate);
    const point = {
      settlementDate: String(row.settlementDate || ''),
      interestShares: parseNumber(row.interest),
      avgDailyShareVolume: parseNumber(row.avgDailyShareVolume),
      daysToCover: parseNumber(row.daysToCover),
    };
    return settlementDate
      && point.interestShares > 0
      && point.avgDailyShareVolume > 0
      && Number.isFinite(point.daysToCover)
      ? point
      : null;
  }).filter((row): row is Point => row !== null)
    .sort((a, b) => new Date(b.settlementDate).getTime() - new Date(a.settlementDate).getTime());

  const latest = history[0];
  const previous = history[1];
  if (!latest) throw new Error('空头利息记录无效');

  const daysValues = [...history].reverse().map(row => row.daysToCover);
  const sortedDays = [...daysValues].sort((a, b) => a - b);
  const medianDaysToCover = sortedDays.length % 2
    ? sortedDays[(sortedDays.length - 1) / 2]
    : ((sortedDays[sortedDays.length / 2 - 1] + sortedDays[sortedDays.length / 2]) / 2);
  const settlementTime = new Date(latest.settlementDate).getTime();
  const dataAgeDays = Number.isFinite(settlementTime)
    ? Math.max(0, Math.round((Date.now() - settlementTime) / 86_400_000))
    : 999;
  const partial = {
    symbol: normalized,
    companyName: String(payload?.data?.companyName || payload?.data?.symbol || normalized),
    latest,
    previous,
    history,
    interestChangePct: previous?.interestShares ? round(((latest.interestShares - previous.interestShares) / previous.interestShares) * 100) : null,
    daysToCoverChangePct: previous?.daysToCover ? round(((latest.daysToCover - previous.daysToCover) / previous.daysToCover) * 100) : null,
    medianDaysToCover: round(medianDaysToCover),
    daysToCoverPercentile: round(percentile(daysValues, latest.daysToCover), 1),
    dataAgeDays,
  };

  return {
    ...partial,
    ...classify(partial),
    source: 'Nasdaq public short interest',
  };
}

export async function getShortInterestSnapshot(symbolInput: string): Promise<ShortInterestSnapshot> {
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

export async function getShortInterestRadar(): Promise<ShortInterestRadar> {
  // Nasdaq throttles bursts, so the advisor walk is deliberately sequential;
  // each symbol is independently cached and failures do not block the rest.
  const settled: PromiseSettledResult<ShortInterestSnapshot>[] = [];
  for (const symbol of ADVISOR_SYMBOLS) {
    try {
      settled.push({ status: 'fulfilled', value: await getShortInterestSnapshot(symbol) });
    } catch (error) {
      settled.push({ status: 'rejected', reason: error });
    }
  }
  const rows = settled.filter((item): item is PromiseFulfilledResult<ShortInterestSnapshot> => item.status === 'fulfilled')
    .map(item => item.value);
  if (!rows.length) throw new Error('美股空头利息数据暂时不可用');
  const failedSymbols = ADVISOR_SYMBOLS.filter(symbol => !rows.some(row => row.symbol === symbol));
  const crowdedCount = rows.filter(row => row.signal === 'crowded').length;
  const squeezeRiskCount = rows.filter(row => row.signal === 'squeeze-risk').length;
  const coveringCount = rows.filter(row => row.signal === 'covering').length;
  const averageDaysToCover = round(rows.reduce((sum, row) => sum + row.latest.daysToCover, 0) / rows.length);

  const score = rows.reduce((sum, row) => sum + (
    row.signal === 'covering' ? 0.8
      : row.signal === 'light' ? 0.2
        : row.signal === 'crowded' ? -0.6
          : row.signal === 'squeeze-risk' ? 0.2
            : 0
  ), 0);
  const regimeBoost = round(clamp(score, -2, 2));
  const focus = rows.filter(row => ['crowded', 'squeeze-risk', 'covering'].includes(row.signal))
    .map(row => `${row.symbol} ${row.signalZh}`)
    .join('、');
  const summaryZh = `已跟踪 ${rows.length} 只 Nasdaq 美股/ETF，平均回补天数 ${averageDaysToCover} 天；${focus || '整体空头结构中性'}。`;
  const advisorBiasZh = regimeBoost > 0.5
    ? '空头回补背景略偏友好，但仍要等价格与成交确认。'
    : regimeBoost < -0.5
      ? '空头拥挤偏重，避免把“有人看空”直接当成卖出信号；警惕反向逼空。'
      : '美股空头结构没有提供明显的方向加分。';

  return {
    rows,
    failedSymbols,
    crowdedCount,
    squeezeRiskCount,
    coveringCount,
    averageDaysToCover,
    summaryZh,
    advisorBiasZh,
    regimeBoost,
    generatedAt: new Date().toISOString(),
    source: 'Nasdaq public short interest',
  };
}
