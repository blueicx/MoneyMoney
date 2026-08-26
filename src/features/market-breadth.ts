/**
 * Keyless US market breadth radar.
 * The public Nasdaq screener snapshot gives one cross-section for thousands of
 * listed stocks. Breadth asks whether moves are broadly participated instead of
 * relying on a few index heavyweights.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

export interface MarketBreadthRow {
  symbol: string;
  name: string;
  priceUsd: number;
  changePct: number;
  volume: number;
  marketCapUsd: number | null;
}

export interface MarketBreadthGroup {
  labelZh: string;
  count: number;
  advancersPct: number;
  averageChangePct: number;
  adviceZh: string;
}

export interface MarketSectorBreadth {
  name: string;
  nameZh?: string;
  count: number;
  advancersPct: number;
  averageChangePct: number;
}

export interface MarketBreadthSnapshot {
  totalCount: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  advancersPct: number;
  declinersPct: number;
  advanceDeclineRatio: number;
  averageChangePct: number;
  medianChangePct: number;
  strongAdvancersPct: number;
  strongDeclinersPct: number;
  totalVolume: number;
  sectors: MarketSectorBreadth[];
  leadingSectors: MarketSectorBreadth[];
  laggingSectors: MarketSectorBreadth[];
  capGroups: MarketBreadthGroup[];
  gainers: MarketBreadthRow[];
  losers: MarketBreadthRow[];
  signal: 'risk-on' | 'constructive' | 'mixed' | 'risk-off' | 'stress';
  signalZh: string;
  adviceZh: string;
  confidence: number;
  regimeBoost: number;
  summaryZh: string;
  advisorBiasZh: string;
  generatedAt: string;
  source: string;
}

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 30 * 60_000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MoneyMoney/1.0';
const SECTOR_NAMES_ZH: Record<string, string> = {
  'Basic Materials': '原材料',
  'Consumer Discretionary': '可选消费',
  'Consumer Staples': '必需消费',
  Energy: '能源',
  Finance: '金融',
  'Health Care': '医疗保健',
  Industrials: '工业',
  Miscellaneous: '其他',
  'Real Estate': '房地产',
  Technology: '科技',
  Telecommunications: '通信服务',
  Unclassified: '未分类',
  Utilities: '公用事业',
};

let cache: { ts: number; value: Promise<MarketBreadthSnapshot> } | null = null;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseNumber(raw: any): number {
  const value = Number(String(raw ?? '').replace(/[,$+%]/g, ''));
  return Number.isFinite(value) ? value : NaN;
}

function parseMarketCap(raw: any): number | null {
  const text = String(raw ?? '').trim().toUpperCase();
  const value = Number(text.replace(/[$,]/g, '').replace(/[KMBT]$/, ''));
  if (!Number.isFinite(value)) return null;
  if (text.endsWith('T')) return value * 1_000_000_000_000;
  if (text.endsWith('B')) return value * 1_000_000_000;
  if (text.endsWith('M')) return value * 1_000_000;
  if (text.endsWith('K')) return value * 1_000;
  return value;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function makeGroup(labelZh: string, rows: ParsedRow[]): MarketBreadthGroup {
  const changes = rows.map(row => row.changePct);
  const advancersPct = rows.length ? rows.filter(row => row.changePct > 0).length / rows.length * 100 : 0;
  const avg = average(changes);
  const adviceZh = advancersPct >= 58 && avg > 0.25
    ? '该市值层参与度偏强，适合关注顺势确认。'
    : advancersPct <= 40 || avg < -0.75
      ? '该市值层抛压更明显，防守优先。'
      : '该市值层方向尚不统一，等待更明确确认。';
  return {
    labelZh,
    count: rows.length,
    advancersPct: round(advancersPct, 1),
    averageChangePct: Number.isFinite(avg) ? round(avg) : 0,
    adviceZh,
  };
}

interface ParsedRow {
  symbol: string;
  name: string;
  priceUsd: number;
  changePct: number;
  volume: number;
  marketCapUsd: number | null;
  sector: string;
}

function classify(input: {
  advancersPct: number;
  averageChangePct: number;
  strongAdvancersPct: number;
  strongDeclinersPct: number;
}): Pick<MarketBreadthSnapshot, 'signal' | 'signalZh' | 'adviceZh' | 'confidence' | 'regimeBoost'> {
  const { advancersPct, averageChangePct, strongAdvancersPct, strongDeclinersPct } = input;
  let signal: MarketBreadthSnapshot['signal'] = 'mixed';
  let signalZh = '市场广度分化';
  let adviceZh = '上涨和下跌家数接近，指数可能被少数权重股拉动；降低对单一指数信号的依赖，等待更广泛参与。';

  if ((advancersPct <= 32 && averageChangePct <= -0.8) || strongDeclinersPct >= 32) {
    signal = 'stress';
    signalZh = '广度极端承压';
    adviceZh = '全市场卖压广泛且急迫；先降低总风险、收紧止损，避免急于接下跌的刀。';
  } else if (advancersPct <= 41 || averageChangePct <= -0.9) {
    signal = 'risk-off';
    signalZh = '广泛 Risk-off';
    adviceZh = '下跌家数明显占优，防守信号应优先于抄底冲动；新仓只做小规模试探。';
  } else if (advancersPct >= 62 && averageChangePct >= 0.45) {
    signal = 'risk-on';
    signalZh = '广泛 Risk-on';
    adviceZh = '多数股票参与上涨，环境背景偏友好；仍要按技术触发入场并保留止损纪律。';
  } else if (advancersPct >= 56 && averageChangePct >= 0.15) {
    signal = 'constructive';
    signalZh = '广度温和转强';
    adviceZh = '参与度略偏正面但未过热，可以关注领先板块中结构完整的顺势机会。';
  }

  const rawBoost = (advancersPct - 50) * 0.07
    + clamp(averageChangePct * 1.5, -1.4, 1.4)
    + clamp((strongAdvancersPct - strongDeclinersPct) * 0.03, -0.6, 0.6);
  return {
    signal,
    signalZh,
    adviceZh,
    confidence: Math.round(clamp(86 - Math.abs(advancersPct - 50) * 0.05, 72, 88)),
    regimeBoost: round(clamp(rawBoost, -3, 3)),
  };
}

async function requestSnapshot(): Promise<MarketBreadthSnapshot> {
  // Node fetch is sometimes challenged here, while Windows system curl passes.
  // The full screener is roughly 2MB, so maxBuffer needs ample headroom.
  const { stdout } = await execFileAsync(
    'curl.exe',
    [
      '--fail', '--silent', '--show-error', '--max-time', '20',
      '-A', USER_AGENT,
      '-H', 'Accept: application/json, text/plain, */*',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=100&download=true',
    ],
    { timeout: 25_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
  );

  const payload = JSON.parse(stdout) as any;
  const rawRows = payload?.data?.rows;
  if (!Array.isArray(rawRows) || rawRows.length < 500) throw new Error('Nasdaq 市场宽度数据无效');

  const rows: ParsedRow[] = rawRows.map((raw: any): ParsedRow | null => {
    const symbol = String(raw.symbol || '').trim().toUpperCase();
    const name = String(raw.name || '').replace(/\s+/g, ' ').trim();
    const priceUsd = parseNumber(raw.lastsale);
    const changePct = parseNumber(raw.pctchange);
    const volume = parseNumber(raw.volume);
    if (!symbol || !name || !Number.isFinite(priceUsd) || !Number.isFinite(changePct)) return null;
    return {
      symbol,
      name,
      priceUsd,
      changePct,
      volume: Number.isFinite(volume) ? volume : 0,
      marketCapUsd: parseMarketCap(raw.marketCap),
      sector: String(raw.sector || 'Unclassified').trim() || 'Unclassified',
    };
  }).filter((row): row is ParsedRow => row !== null);

  if (rows.length < 500) throw new Error('Nasdaq 市场宽度记录不足');

  const changes = rows.map(row => row.changePct);
  const advancers = rows.filter(row => row.changePct > 0).length;
  const decliners = rows.filter(row => row.changePct < 0).length;
  const unchanged = rows.length - advancers - decliners;
  const advancersPct = advancers / rows.length * 100;
  const declinersPct = decliners / rows.length * 100;
  const strongAdvancersPct = rows.filter(row => row.changePct >= 2).length / rows.length * 100;
  const strongDeclinersPct = rows.filter(row => row.changePct <= -2).length / rows.length * 100;
  const avgChange = average(changes);

  const sectorMap = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    const list = sectorMap.get(row.sector) || [];
    list.push(row);
    sectorMap.set(row.sector, list);
  }
  const sectors: MarketSectorBreadth[] = [...sectorMap.entries()].map(([name, sectorRows]) => ({
    name,
    nameZh: SECTOR_NAMES_ZH[name] || name,
    count: sectorRows.length,
    advancersPct: round(sectorRows.filter(row => row.changePct > 0).length / sectorRows.length * 100, 1),
    averageChangePct: round(average(sectorRows.map(row => row.changePct))),
  })).sort((a, b) => b.averageChangePct - a.averageChangePct || b.advancersPct - a.advancersPct);

  const capGroups = [
    { labelZh: '超大市值 ≥$200B', rows: rows.filter(row => (row.marketCapUsd ?? -1) >= 200_000_000_000) },
    { labelZh: '大市值 $10B-$200B', rows: rows.filter(row => (row.marketCapUsd ?? -1) >= 10_000_000_000 && (row.marketCapUsd ?? -1) < 200_000_000_000) },
    { labelZh: '中市值 $2B-$10B', rows: rows.filter(row => (row.marketCapUsd ?? -1) >= 2_000_000_000 && (row.marketCapUsd ?? -1) < 10_000_000_000) },
    { labelZh: '小市值 <$2B', rows: rows.filter(row => (row.marketCapUsd ?? -1) >= 0 && (row.marketCapUsd ?? -1) < 2_000_000_000) },
  ].map(group => makeGroup(group.labelZh, group.rows));

  const liquid = rows.filter(row => row.volume >= 250_000 && (row.marketCapUsd ?? 0) >= 500_000_000);
  const toRow = (row: ParsedRow): MarketBreadthRow => ({
    symbol: row.symbol,
    name: row.name,
    priceUsd: row.priceUsd,
    changePct: row.changePct,
    volume: row.volume,
    marketCapUsd: row.marketCapUsd,
  });
  const gainers = [...liquid].sort((a, b) => b.changePct - a.changePct).slice(0, 8).map(toRow);
  const losers = [...liquid].sort((a, b) => a.changePct - b.changePct).slice(0, 8).map(toRow);

  const classification = classify({
    advancersPct,
    averageChangePct: avgChange,
    strongAdvancersPct,
    strongDeclinersPct,
  });
  const summaryZh = `覆盖 ${rows.length} 只美股：上涨 ${advancers} 家、下跌 ${decliners} 家；平均涨跌 ${round(avgChange)}%，强涨 ${round(strongAdvancersPct, 1)}% / 强跌 ${round(strongDeclinersPct, 1)}%。`;
  const advisorBiasZh = classification.regimeBoost > 0.5
    ? '美股上涨参与度较广，风险偏好背景偏支持，但仍不能替代单标的确认。'
    : classification.regimeBoost < -0.5
      ? '美股下跌参与度较广，整体环境偏防守，避免逆势重仓。'
      : '美股广度没有给出明确的整体方向加分。';

  return {
    totalCount: rows.length,
    advancers,
    decliners,
    unchanged,
    advancersPct: round(advancersPct, 1),
    declinersPct: round(declinersPct, 1),
    advanceDeclineRatio: decliners ? round(advancers / decliners) : advancers,
    averageChangePct: round(avgChange),
    medianChangePct: round(median(changes)),
    strongAdvancersPct: round(strongAdvancersPct, 1),
    strongDeclinersPct: round(strongDeclinersPct, 1),
    totalVolume: rows.reduce((sum, row) => sum + row.volume, 0),
    sectors,
    leadingSectors: sectors.slice(0, 5),
    laggingSectors: sectors.slice(-5).reverse(),
    capGroups,
    gainers,
    losers,
    ...classification,
    summaryZh,
    advisorBiasZh,
    generatedAt: new Date().toISOString(),
    source: 'Nasdaq Public Screener',
  };
}

export async function getMarketBreadthSnapshot(): Promise<MarketBreadthSnapshot> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;
  const value = requestSnapshot().catch(error => {
    cache = null;
    throw error;
  });
  cache = { ts: Date.now(), value };
  return value;
}
