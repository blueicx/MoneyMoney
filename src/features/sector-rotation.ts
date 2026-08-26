/**
 * Keyless US sector rotation radar.
 * Uses Nasdaq public daily history for the 11 SPDR sector ETFs and compares
 * each sector's 20-day momentum with SPY as the market benchmark.
 */

export interface SectorRotationRow {
  id: string;
  symbol: string;
  name: string;
  current: number;
  changePct: number;
  roc20d: number;
  roc10d: number;
  benchmarkRoc20d: number;
  excessMomentum: number;
  trendScore: number;
  rank: number;
  aboveMa20: boolean;
  aboveMa50: boolean;
}

export interface SectorRotationSnapshot {
  rows: SectorRotationRow[];
  leaders: SectorRotationRow[];
  laggards: SectorRotationRow[];
  benchmarkSymbol: string;
  benchmarkRoc20d: number;
  breadthPct: number;
  averageExcessMomentum: number;
  rotationRegimeZh: string;
  summaryZh: string;
  sources: string[];
  errors: string[];
  fetchedAt: string;
}

interface CacheEntry {
  ts: number;
  value: SectorRotationSnapshot;
}

interface NasdaqHistoricalPayload {
  data?: {
    tradesTable?: {
      rows?: Array<{
        date?: string;
        open?: string;
        high?: string;
        low?: string;
        close?: string;
      }>;
    };
  };
}

interface SectorBar {
  time: number;
  high: number;
  low: number;
  close: number;
}

const CACHE_TTL_MS = 10 * 60_000;
let cache: CacheEntry | null = null;

const SECTORS = [
  { symbol: 'XLK', name: '科技' },
  { symbol: 'XLF', name: '金融' },
  { symbol: 'XLE', name: '能源' },
  { symbol: 'XLV', name: '医疗保健' },
  { symbol: 'XLI', name: '工业' },
  { symbol: 'XLY', name: '可选消费' },
  { symbol: 'XLP', name: '必需消费' },
  { symbol: 'XLU', name: '公用事业' },
  { symbol: 'XLB', name: '原材料' },
  { symbol: 'XLRE', name: '房地产' },
  { symbol: 'XLC', name: '通信服务' },
] as const;

const BENCHMARK = { symbol: 'SPY', name: '标普500' } as const;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roc(closes: number[], period: number): number {
  if (closes.length < period + 1) return 0;
  const previous = closes[closes.length - period - 1];
  return previous > 0 ? (closes[closes.length - 1] - previous) / previous * 100 : 0;
}

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

function atr(bars: SectorBar[], period = 14): number {
  if (bars.length < 2) return 0;
  const ranges: number[] = [];
  for (let i = Math.max(1, bars.length - period); i < bars.length; i++) {
    const previousClose = bars[i - 1].close;
    ranges.push(Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - previousClose),
      Math.abs(bars[i].low - previousClose),
    ));
  }
  return ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : 0;
}

async function fetchNasdaqEtfHistory(symbol: string): Promise<SectorBar[]> {
  const now = new Date();
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - 240 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const query = new URLSearchParams({
    assetclass: 'etf',
    fromdate: fromDate,
    todate: toDate,
    limit: '120',
  });
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?${query}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Referer: 'https://www.nasdaq.com/',
      'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${symbol} history HTTP ${response.status}`);
  const payload = await response.json() as NasdaqHistoricalPayload;

  const bars = (payload.data?.tradesTable?.rows || [])
    .map(row => ({
      // Nasdaq returns MM/DD/YYYY; the native Date parser is unreliable here.
      time: (() => {
        const parts = (row.date || '').split('/').map(Number);
        return parts.length === 3 ? Date.UTC(parts[2], parts[0] - 1, parts[1]) : NaN;
      })(),
      high: Number((row.high || '').replace(/,/g, '')),
      low: Number((row.low || '').replace(/,/g, '')),
      close: Number((row.close || '').replace(/,/g, '')),
    }))
    .filter(bar => [bar.time, bar.high, bar.low, bar.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);

  if (bars.length < 60) throw new Error(`${symbol} daily history too short`);
  return bars;
}

function buildRow(
  sector: typeof SECTORS[number],
  bars: SectorBar[],
  benchmarkRoc20d: number,
): SectorRotationRow {
  const closes = bars.map(bar => bar.close);
  const current = closes[closes.length - 1];
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const roc20d = roc(closes, 20);
  const roc10d = roc(closes, 10);
  const excessMomentum = roc20d - benchmarkRoc20d;
  const aboveMa20 = ma20 != null && current > ma20;
  const aboveMa50 = ma50 != null && current > ma50;

  // Relative momentum is the primary rotation signal; trend filters reduce
  // the chance of buying a statistically strong but technically broken sector.
  const trendScore = round(
    excessMomentum * 8
    + (aboveMa20 ? 12 : -12)
    + (aboveMa50 ? 6 : -6)
    + clampValue(roc10d * 2, -8, 8),
    1,
  );

  return {
    id: `sector-${sector.symbol.toLowerCase()}`,
    symbol: sector.symbol,
    name: sector.name,
    current: round(current),
    changePct: roc(closes, 1),
    roc20d: round(roc20d),
    roc10d: round(roc10d),
    benchmarkRoc20d: round(benchmarkRoc20d),
    excessMomentum: round(excessMomentum),
    trendScore,
    rank: 0,
    aboveMa20,
    aboveMa50,
  };
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function getSectorRotationSnapshot(): Promise<SectorRotationSnapshot> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const targets = [...SECTORS, BENCHMARK];
  const results = await Promise.allSettled(targets.map(async target => ({
    target,
    bars: await fetchNasdaqEtfHistory(target.symbol),
  })));
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => `${result.reason instanceof Error ? result.reason.message : 'request failed'}`);

  const fulfilled = results
    .filter((result): result is PromiseFulfilledResult<{
      target: typeof targets[number];
      bars: SectorBar[];
    }> => result.status === 'fulfilled')
    .map(result => result.value);
  const benchmarkData = fulfilled.find(item => item.target.symbol === BENCHMARK.symbol);
  if (!benchmarkData) throw new Error(`Sector benchmark unavailable: ${errors.join('; ') || 'unknown error'}`);

  const benchmarkRoc20d = roc(benchmarkData.bars.map(bar => bar.close), 20);
  const sectorData = fulfilled.filter(item => item.target.symbol !== BENCHMARK.symbol);
  if (sectorData.length < 6) throw new Error('Not enough sector histories available');

  const rows = sectorData
    .map(item => buildRow(
      item.target as typeof SECTORS[number],
      item.bars,
      benchmarkRoc20d,
    ))
    .sort((a, b) => b.excessMomentum - a.excessMomentum)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const leaders = rows.slice(0, 3);
  const laggards = rows.slice(-3).reverse();
  const breadthPct = round(rows.filter(row => row.aboveMa20).length / rows.length * 100, 0);
  const averageExcessMomentum = rows.reduce((sum, row) => sum + row.excessMomentum, 0) / rows.length;
  const rotationRegimeZh = breadthPct >= 65 && averageExcessMomentum > -0.5
    ? '广泛风险偏好'
    : breadthPct <= 35 && averageExcessMomentum < 0.5
      ? '防守情绪主导'
      : '结构性轮动';
  const summaryZh = `${leaders[0]?.name || '领先行业'} 相对 SPY 领先 ${
    round(Math.max(0, leaders[0]?.excessMomentum || 0), 2)
  } 个百分点，${laggards[0]?.name || '落后行业'} 落后 ${
    round(Math.max(0, -(laggards[0]?.excessMomentum || 0)), 2)
  } 个百分点；${breadthPct}% 行业站上 20 日线。`;

  const snapshot: SectorRotationSnapshot = {
    rows,
    leaders,
    laggards,
    benchmarkSymbol: BENCHMARK.symbol,
    benchmarkRoc20d: round(benchmarkRoc20d),
    breadthPct,
    averageExcessMomentum: round(averageExcessMomentum, 2),
    rotationRegimeZh,
    summaryZh,
    sources: ['Nasdaq public US sector and SPY ETF history'],
    errors,
    fetchedAt: new Date().toISOString(),
  };

  cache = { ts: Date.now(), value: snapshot };
  return snapshot;
}

export async function getSectorCurrentPrices(
  symbols: string[],
): Promise<Map<string, number>> {
  const wanted = new Set(symbols.map(symbol => symbol.toUpperCase()));
  const snapshot = await getSectorRotationSnapshot();
  return new Map(snapshot.rows
    .filter(row => wanted.has(row.symbol.toUpperCase()))
    .map(row => [row.symbol.toUpperCase(), row.current]));
}
