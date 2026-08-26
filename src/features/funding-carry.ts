/**
 * Cross-exchange perpetual funding carry radar.
 *
 * The idea borrowed from market-neutral funding-rate tools is deliberately
 * read-only: compare public USDT perpetual funding across venues and expose
 * the funding spread. It does not place orders and does not assume that the
 * spread can always be captured after basis, margin, latency, and fees.
 */

import { execFile } from 'child_process';

export interface FundingVenueQuote {
  exchange: 'Binance' | 'Bybit' | 'OKX' | 'Gate.io' | 'HTX' | 'Deribit';
  symbol: string;
  fundingRate: number;
  fundingRatePct: number;
  annualizedPct: number;
  intervalHours: number;
  markPrice: number;
  nextFundingAt?: string;
}

export interface FundingCarryPair {
  symbol: string;
  baseAsset: string;
  longExchange: string;
  shortExchange: string;
  longFundingPct: number;
  shortFundingPct: number;
  spreadPct: number;
  annualizedSpreadPct: number;
  estimatedRoundtripCostPct: number;
  estimatedNetAnnualPct: number;
  confidence: number;
  signalZh: string;
  venues: FundingVenueQuote[];
}

export interface FundingCarryRadar {
  generatedAt: string;
  summaryZh: string;
  advisorBiasZh: string;
  rows: FundingCarryPair[];
  sources: Array<{ exchange: string; ok: boolean; count: number; error?: string }>;
}

type CacheEntry = { value: FundingCarryRadar; expiresAt: number };
let cache: CacheEntry | null = null;

const SYMBOLS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT',
];

const ROUNDTRIP_COST_PCT = 0.16; // Conservative taker-fee estimate for two venues.

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getJson(url: string, timeoutMs = 8_000): Promise<any> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'MoneyMoney/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

function getCurlJson(url: string): Promise<any> {
  const command = process.platform === 'win32' ? 'curl.exe' : 'curl';
  return new Promise((resolve, reject) => {
    execFile(
      command,
      ['--silent', '--show-error', '--location', '--max-time', '16', '--header', 'accept: application/json', url],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 18_000 },
      (error, stdout) => {
        if (error) { reject(error); return; }
        try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
      },
    );
  });
}

/**
 * Exchange endpoints are public, but some Windows TLS/network combinations
 * fail while the OS curl client succeeds. Keep both read-only paths.
 */
async function getPublicJson(url: string): Promise<any> {
  try {
    return await getJson(url, 6_000);
  } catch {
    return getCurlJson(url);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = 14_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network timeout')), timeoutMs);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function annualize(rate: number, intervalHours: number): number {
  const periods = intervalHours > 0 ? 24 / intervalHours : 3;
  return rate * periods * 365 * 100;
}

function quote(
  exchange: FundingVenueQuote['exchange'],
  symbol: string,
  fundingRate: number,
  intervalHours: number,
  markPrice: number,
  nextFundingAt?: string,
): FundingVenueQuote {
  const safeRate = Number.isFinite(fundingRate) ? fundingRate : 0;
  return {
    exchange,
    symbol,
    fundingRate: safeRate,
    fundingRatePct: safeRate * 100,
    annualizedPct: annualize(safeRate, intervalHours),
    intervalHours,
    markPrice: num(markPrice),
    nextFundingAt,
  };
}

async function getBinance(): Promise<FundingVenueQuote[]> {
  const rows: any[] = await getPublicJson('https://fapi.binance.com/fapi/v1/premiumIndex');
  return (Array.isArray(rows) ? rows : []).flatMap(row => {
    const symbol = String(row.symbol || '');
    const base = symbol.replace(/USDT$/, '');
    if (!SYMBOLS.includes(base) || !symbol.endsWith('USDT')) return [];
    return [quote('Binance', symbol, num(row.lastFundingRate), 8, num(row.markPrice),
      num(row.nextFundingTime) ? new Date(num(row.nextFundingTime)).toISOString() : undefined)];
  });
}

async function getBybit(): Promise<FundingVenueQuote[]> {
  const payload = await getPublicJson('https://api.bybit.com/v5/market/tickers?category=linear');
  const rows: any[] = payload?.result?.list || [];
  return rows.flatMap(row => {
    const symbol = String(row.symbol || '');
    const base = symbol.replace(/USDT$/, '');
    if (!SYMBOLS.includes(base) || !symbol.endsWith('USDT')) return [];
    return [quote('Bybit', symbol, num(row.fundingRate), 8, num(row.markPrice),
      num(row.nextFundingTime) ? new Date(num(row.nextFundingTime)).toISOString() : undefined)];
  });
}

async function getOkxOne(base: string): Promise<FundingVenueQuote | null> {
  const payload = await getPublicJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${base}-USDT-SWAP`);
  const row = payload?.data?.[0];
  if (!row) return null;
  const intervalHours = Math.max(1, Math.round((num(row.nextFundingTime) - num(row.fundingTime)) / 3_600_000));
  return quote('OKX', `${base}USDT`, num(row.fundingRate), intervalHours || 8, 0,
    num(row.fundingTime) ? new Date(num(row.fundingTime)).toISOString() : undefined);
}

async function getGateOne(base: string): Promise<FundingVenueQuote | null> {
  const row = await getPublicJson(`https://api.gateio.ws/api/v4/futures/usdt/contracts/${base}_USDT`);
  if (!row) return null;
  const intervalHours = Math.max(1, Math.round(num(row.funding_interval, 28_800) / 3_600));
  return quote('Gate.io', `${base}USDT`, num(row.funding_rate), intervalHours,
    num(row.mark_price), num(row.funding_next_apply)
      ? new Date(num(row.funding_next_apply) * 1_000).toISOString()
      : undefined);
}

async function getHtxOne(base: string): Promise<FundingVenueQuote | null> {
  const payload = await getPublicJson(`https://api.hbdm.com/linear-swap-api/v1/swap_funding_rate?contract_code=${base}-USDT`);
  const row = payload?.data;
  if (!row || !row.funding_rate) return null;
  return quote('HTX', `${base}USDT`, num(row.funding_rate), 8, 0,
    num(row.funding_time) ? new Date(num(row.funding_time)).toISOString() : undefined);
}

async function getDeribitOne(base: string): Promise<FundingVenueQuote | null> {
  // Deribit uses BTC-PERPETUAL / ETH-PERPETUAL naming and publishes an
  // explicit eight-hour-equivalent rate, so it is comparable without scaling.
  if (!['BTC', 'ETH'].includes(base)) return null;
  const payload = await getPublicJson(`https://www.deribit.com/api/v2/public/ticker?instrument_name=${base}-PERPETUAL`);
  const row = payload?.result;
  if (!row || row.funding_8h == null) return null;
  return quote('Deribit', `${base}USDT`, num(row.funding_8h), 8, num(row.mark_price));
}

function carrySignal(row: Omit<FundingCarryPair, 'signalZh'>): string {
  if (row.estimatedNetAnnualPct >= 18 && row.confidence >= 70) return '价差较宽 · 研究级';
  if (row.estimatedNetAnnualPct >= 8) return '可观察套利';
  if (row.estimatedNetAnnualPct >= 2) return '薄利 · 费用敏感';
  return '价差不足';
}

function buildPairs(bySymbol: Map<string, FundingVenueQuote[]>): FundingCarryPair[] {
  const rows: FundingCarryPair[] = [];
  for (const [symbol, venues] of bySymbol) {
    if (venues.length < 2) continue;
    const sorted = [...venues].sort((left, right) => left.fundingRate - right.fundingRate);
    const long = sorted[0];
    const short = sorted[sorted.length - 1];
    const spreadPct = short.fundingRatePct - long.fundingRatePct;
    const annualizedSpreadPct = short.annualizedPct - long.annualizedPct;
    // Funding is one leg of carry; entry/exit costs are charged once per
    // round trip, not once per funding settlement. This still excludes basis,
    // borrow, margin, and execution risk, so it remains a screening estimate.
    const estimatedNetAnnualPct = annualizedSpreadPct - ROUNDTRIP_COST_PCT;
    const confidence = Math.round(Math.max(35, Math.min(84,
      34 + venues.length * 8 + Math.min(18, annualizedSpreadPct * 0.35))));
    const base: Omit<FundingCarryPair, 'signalZh'> = {
      symbol,
      baseAsset: symbol.replace(/USDT$/, ''),
      longExchange: long.exchange,
      shortExchange: short.exchange,
      longFundingPct: Number(long.fundingRatePct.toFixed(4)),
      shortFundingPct: Number(short.fundingRatePct.toFixed(4)),
      spreadPct: Number(spreadPct.toFixed(4)),
      annualizedSpreadPct: Number(annualizedSpreadPct.toFixed(2)),
      estimatedRoundtripCostPct: ROUNDTRIP_COST_PCT,
      estimatedNetAnnualPct: Number(Math.max(-100, estimatedNetAnnualPct).toFixed(2)),
      confidence,
      venues: sorted,
    };
    rows.push({ ...base, signalZh: carrySignal(base) });
  }
  return rows.sort((left, right) => right.annualizedSpreadPct - left.annualizedSpreadPct);
}

export async function getFundingCarryRadar(): Promise<FundingCarryRadar> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const [binanceResult, bybitResult, okxResults, gateResults, htxResults, deribitResults] = await Promise.allSettled([
    withTimeout(getBinance()),
    withTimeout(getBybit()),
    Promise.allSettled(SYMBOLS.map(item => withTimeout(getOkxOne(item)))),
    Promise.allSettled(SYMBOLS.map(item => withTimeout(getGateOne(item)))),
    Promise.allSettled(SYMBOLS.map(item => withTimeout(getHtxOne(item)))),
    Promise.allSettled(SYMBOLS.map(item => withTimeout(getDeribitOne(item)))),
  ]);

  const binance = binanceResult.status === 'fulfilled' ? binanceResult.value : [];
  const bybit = bybitResult.status === 'fulfilled' ? bybitResult.value : [];
  const okx = okxResults.status === 'fulfilled'
    ? okxResults.value.flatMap(item => item.status === 'fulfilled' && item.value ? [item.value] : [])
    : [];
  const gate = gateResults.status === 'fulfilled'
    ? gateResults.value.flatMap(item => item.status === 'fulfilled' && item.value ? [item.value] : [])
    : [];
  const htx = htxResults.status === 'fulfilled'
    ? htxResults.value.flatMap(item => item.status === 'fulfilled' && item.value ? [item.value] : [])
    : [];
  const deribit = deribitResults.status === 'fulfilled'
    ? deribitResults.value.flatMap(item => item.status === 'fulfilled' && item.value ? [item.value] : [])
    : [];

  const bySymbol = new Map<string, FundingVenueQuote[]>();
  for (const item of [...binance, ...bybit, ...okx, ...gate, ...htx, ...deribit]) {
    const list = bySymbol.get(item.symbol) || [];
    list.push(item);
    bySymbol.set(item.symbol, list);
  }
  const rows = buildPairs(bySymbol);
  const researchable = rows.filter(row => row.estimatedNetAnnualPct >= 8).length;
  const best = rows[0];
  const summaryZh = researchable
    ? `发现 ${researchable} 个扣费前年化价差超过 8% 的组合；最宽是 ${best?.baseAsset} ${best?.annualizedSpreadPct.toFixed(1)}%。`
    : '当前主流币跨所资金费价差偏窄，没有足够覆盖成本的研究级组合。';
  const advisorBiasZh = researchable >= 3
    ? '市场杠杆分化，优先控制方向风险，套利只作研究线索。'
    : '资金费相对平静，不适合强行做费率套利。';

  const sources = [
    { exchange: 'Binance', ok: binanceResult.status === 'fulfilled', count: binance.length,
      error: binanceResult.status === 'rejected' ? String(binanceResult.reason) : undefined },
    { exchange: 'Bybit', ok: bybitResult.status === 'fulfilled', count: bybit.length,
      error: bybitResult.status === 'rejected' ? String(bybitResult.reason) : undefined },
    { exchange: 'OKX', ok: okxResults.status === 'fulfilled' && okx.length > 0, count: okx.length },
    { exchange: 'Gate.io', ok: gateResults.status === 'fulfilled' && gate.length > 0, count: gate.length },
    { exchange: 'HTX', ok: htxResults.status === 'fulfilled' && htx.length > 0, count: htx.length },
    { exchange: 'Deribit', ok: deribitResults.status === 'fulfilled' && deribit.length > 0, count: deribit.length },
  ];

  const radar: FundingCarryRadar = {
    generatedAt: new Date().toISOString(),
    summaryZh,
    advisorBiasZh,
    rows,
    sources,
  };
  if (rows.length) cache = { value: radar, expiresAt: Date.now() + 3 * 60_000 };
  return radar;
}
