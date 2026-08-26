export interface PerpetualCrowdingAsset {
  symbol: string;
  contract: string;
  price: number;
  fundingRatePct: number;
  fundingAnnualizedPct: number;
  fundingIntervalHours: number;
  nextFundingAt: string;
  longUsers: number;
  shortUsers: number;
  longShortRatio: number;
  crowdState: 'long-crowded' | 'short-crowded' | 'balanced';
  crowdZh: string;
  openInterestUsd: number;
  volume24hUsd: number;
  change24hPct: number;
  adviceZh: string;
}

export interface PerpetualCrowdingResult {
  generatedAt: string;
  source: string;
  rows: PerpetualCrowdingAsset[];
  summaryZh: string;
  advisorBiasZh: string;
  regimeBoost: number;
}

interface GateContract {
  name?: string;
  status?: string;
  funding_rate?: string | number;
  funding_interval?: string | number;
  funding_next_apply?: string | number;
  long_users?: string | number;
  short_users?: string | number;
  quanto_multiplier?: string | number;
  mark_price?: string | number;
}

interface GateTicker {
  contract?: string;
  total_size?: string | number;
  volume_24h_settle?: string | number;
  mark_price?: string | number;
  change_percentage?: string | number;
}

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'];
const NAMES_ZH: Record<string, string> = {
  BTC: '比特币',
  ETH: '以太坊',
  SOL: 'Solana',
  BNB: 'BNB',
  XRP: 'XRP',
  DOGE: '狗狗币',
};
const CACHE_TTL_MS = 120_000;
let cache: { ts: number; value: PerpetualCrowdingResult } | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getJson<T>(url: string): Promise<T[]> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Gate.io API ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload) ? payload as T[] : [];
}

function crowdAdvice(symbol: string, state: PerpetualCrowdingAsset['crowdState']): string {
  if (state === 'long-crowded') {
    return `${symbol} 多方账号偏拥挤，追多性价比下降；优先等回调或缩小仓位。`;
  }
  if (state === 'short-crowded') {
    return `${symbol} 空方账号偏拥挤，反弹/轧空可能更急；不要在低点盲目追空。`;
  }
  return `${symbol} 多空结构相对平衡，按技术面和风险规则观察即可。`;
}

function buildRow(
  contract: GateContract,
  ticker: GateTicker | undefined,
): PerpetualCrowdingAsset | null {
  const contractName = String(contract.name || ticker?.contract || '');
  const match = contractName.toUpperCase().match(/^([A-Z0-9]+)_USDT$/);
  if (!match || contract.status !== 'trading') return null;
  const symbol = match[1];
  const price = num(contract.mark_price ?? ticker?.mark_price);
  if (!price) return null;

  const fundingRatePct = num(contract.funding_rate) * 100;
  const intervalSeconds = Math.max(num(contract.funding_interval, 28_800), 600);
  const periodsPerYear = (365 * 24 * 3600) / intervalSeconds;
  const longUsers = Math.max(0, Math.round(num(contract.long_users)));
  const shortUsers = Math.max(0, Math.round(num(contract.short_users)));
  const accounts = longUsers + shortUsers;
  const ratio = accounts ? longUsers / accounts : 0.5;
  const crowdState = ratio >= 0.58
    ? 'long-crowded'
    : ratio <= 0.42
      ? 'short-crowded'
      : 'balanced';
  const crowdZh = crowdState === 'long-crowded'
    ? '多头拥挤'
    : crowdState === 'short-crowded'
      ? '空头拥挤'
      : '多空平衡';
  const multiplier = Math.max(num(contract.quanto_multiplier, 1), 1e-12);
  const totalSize = Math.max(0, num(ticker?.total_size));

  return {
    symbol,
    contract: contractName,
    price,
    fundingRatePct: round(fundingRatePct, 4),
    fundingAnnualizedPct: round(fundingRatePct * periodsPerYear, 1),
    fundingIntervalHours: round(intervalSeconds / 3600, 2),
    nextFundingAt: new Date(num(contract.funding_next_apply) * 1000).toISOString(),
    longUsers,
    shortUsers,
    longShortRatio: round(longUsers / Math.max(shortUsers, 1), 2),
    crowdState,
    crowdZh,
    openInterestUsd: Math.round(totalSize * multiplier * price),
    volume24hUsd: Math.round(Math.max(0, num(ticker?.volume_24h_settle))),
    change24hPct: round(num(ticker?.change_percentage), 2),
    adviceZh: crowdAdvice(NAMES_ZH[symbol] || symbol, crowdState),
  };
}

export async function getPerpetualCrowding(): Promise<PerpetualCrowdingResult> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const base = 'https://api.gateio.ws/api/v4/futures/usdt';
  const [contracts, tickers] = await Promise.all([
    getJson<GateContract>(`${base}/contracts`),
    getJson<GateTicker>(`${base}/tickers`),
  ]);
  const tickerMap = new Map(tickers.map(item => [String(item.contract || ''), item]));
  const wanted = new Set(SYMBOLS.map(symbol => `${symbol}_USDT`));
  const rows = contracts
    .filter(contract => wanted.has(String(contract.name || '')))
    .map(contract => buildRow(contract, tickerMap.get(String(contract.name))))
    .filter((item): item is PerpetualCrowdingAsset => item !== null)
    .sort((a, b) => b.openInterestUsd - a.openInterestUsd);

  if (!rows.length) throw new Error('暂无可用的主流永续合约数据');

  const crowdedLong = rows.filter(row => row.crowdState === 'long-crowded').map(row => row.symbol);
  const crowdedShort = rows.filter(row => row.crowdState === 'short-crowded').map(row => row.symbol);
  const avgFunding = rows.reduce((sum, row) => sum + row.fundingRatePct, 0) / rows.length;
  let summaryZh = `主流永续平均资金费率 ${avgFunding > 0 ? '+' : ''}${round(avgFunding, 4)}%，多数合约多空结构平衡。`;
  if (crowdedLong.length && crowdedShort.length) {
    summaryZh = `主流永续分歧明显：${crowdedLong.join('/')} 多头拥挤，${crowdedShort.join('/')} 空头拥挤。`;
  } else if (crowdedLong.length) {
    summaryZh = `${crowdedLong.join('/')} 多头账号偏拥挤，注意追高风险。`;
  } else if (crowdedShort.length) {
    summaryZh = `${crowdedShort.join('/')} 空头账号偏拥挤，留意轧空风险。`;
  }

  // Positive funding and long crowding reduce bullish tilt; negative funding and
  // short crowding only add bounded rebound/squeeze potential—not blind bullishness.
  const boosts = rows.map(row => clamp((0.5 - (row.longUsers / Math.max(row.longUsers + row.shortUsers, 1))) * 16, -5, 3)
    - clamp(row.fundingRatePct, -0.04, 0.06) * 35);
  const regimeBoost = round(clamp(boosts.reduce((sum, value) => sum + value, 0) / boosts.length, -6, 4), 2);
  const advisorBiasZh = regimeBoost < -1
    ? '永续持仓过热偏多，降低追仓优先级'
    : regimeBoost > 1
      ? '空头拥挤提供反弹/轧空背景，但仍需等确认'
      : '永续持仓拥挤度中性';

  const value: PerpetualCrowdingResult = {
    generatedAt: new Date().toISOString(),
    source: 'Gate.io USDT futures public contracts & tickers',
    rows,
    summaryZh,
    advisorBiasZh,
    regimeBoost,
  };
  cache = { ts: Date.now(), value };
  return value;
}
