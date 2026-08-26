/**
 * Keyless global macro spot radar.
 * Tencent exposes spot gold/silver and WTI/Brent quotes; the dollar index is
 * reconstructed from Frankfurter's free ECB fixings using the classic DXY
 * weights. This gives real macro anchors instead of relying only on ETF proxies.
 */

import iconv from 'iconv-lite';

export interface MacroSpotAsset {
  id: 'gold' | 'silver' | 'wti' | 'brent' | 'dollar';
  symbol: string;
  nameZh: string;
  unitZh: string;
  price: number;
  changePct: number;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayRangePositionPct: number | null;
  updatedAtZh: string;
  trend5dPct: number | null;
  trend20dPct: number | null;
}

export interface GlobalMacroSpotSnapshot {
  assets: MacroSpotAsset[];
  goldSilverRatio: number | null;
  signal: 'hard-asset-strong' | 'dollar-strong' | 'energy-shock' | 'balanced';
  signalZh: string;
  adviceZh: string;
  confidence: number;
  regimeBoost: number;
  summaryZh: string;
  advisorBiasZh: string;
  generatedAt: string;
  sources: string[];
  errors: string[];
}

interface CacheEntry {
  ts: number;
  value: Promise<GlobalMacroSpotSnapshot>;
}

interface FrankfurterPayload {
  rates?: Record<string, Record<string, number>>;
}

const CACHE_TTL_MS = 5 * 60_000;
const DXY_CONSTANT = 50.14348112;
let cache: CacheEntry | null = null;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function fetchTencentSpotText(): Promise<string> {
  const response = await fetch('https://qt.gtimg.cn/q=hf_XAU,hf_SI,hf_CL,hf_OIL', {
    headers: { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Tencent spot HTTP ${response.status}`);
  return iconv.decode(Buffer.from(await response.arrayBuffer()), 'gb18030');
}

function rangePosition(price: number, low: number | null, high: number | null): number | null {
  if (low == null || high == null || !Number.isFinite(low)
    || !Number.isFinite(high) || high <= low) {
    return null;
  }
  return round(clamp((price - low) / (high - low) * 100, 0, 100), 1);
}

function parseTencentSpot(raw: string):
Array<Omit<MacroSpotAsset, 'trend5dPct' | 'trend20dPct'>> {
  const definitions = [
    { id: 'gold' as const, token: 'XAU', symbol: 'XAU', nameZh: '现货黄金', unitZh: '美元/盎司', digits: 2 },
    { id: 'silver' as const, token: 'SI', symbol: 'XAG', nameZh: '现货白银', unitZh: '美元/盎司', digits: 2 },
    { id: 'wti' as const, token: 'CL', symbol: 'WTI', nameZh: 'WTI 原油', unitZh: '美元/桶', digits: 2 },
    { id: 'brent' as const, token: 'OIL', symbol: 'BRENT', nameZh: 'Brent 原油', unitZh: '美元/桶', digits: 2 },
  ];
  const rows: Array<Omit<MacroSpotAsset, 'trend5dPct' | 'trend20dPct'>> = [];

  for (const definition of definitions) {
    const match = raw.match(new RegExp(`v_hf_${definition.token}="([^"]+)"`));
    if (!match) continue;
    // Tencent overseas-spot rows are comma separated:
    // price, change%, last/open, open, high, low, time, settlement, prior close...
    const parts = match[1].split(',');
    const price = Number(parts[0]);
    const changePct = Number(parts[1]);
    const open = Number(parts[3]);
    const high = Number(parts[4]);
    const low = Number(parts[5]);
    const previousClose = Number(parts[7]);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(changePct)) continue;
    rows.push({
      id: definition.id,
      symbol: definition.symbol,
      nameZh: definition.nameZh,
      unitZh: definition.unitZh,
      price: round(price, definition.digits),
      changePct: round(changePct, 2),
      previousClose: Number.isFinite(previousClose) && previousClose > 0
        ? round(previousClose, definition.digits)
        : null,
      dayHigh: Number.isFinite(high) && high > 0 ? round(high, definition.digits) : null,
      dayLow: Number.isFinite(low) && low > 0 ? round(low, definition.digits) : null,
      dayRangePositionPct: rangePosition(price, low, high),
      updatedAtZh: [String(parts[12] || ''), String(parts[6] || '')]
        .filter(Boolean)
        .join(' ') || '--',
    });
    void open;
  }
  return rows;
}

function calculateDollarIndex(rates: Record<string, number>): number {
  // Frankfurter returns USD-base rates (currency per USD). Conventional
  // EURUSD/GBPUSD quote dollars per unit, so those two components use the
  // opposite sign when fed directly from this payload.
  const euroPerUsd = Number(rates.EUR);
  const usdJpy = Number(rates.JPY);
  const poundPerUsd = Number(rates.GBP);
  const usdCad = Number(rates.CAD);
  const usdSek = Number(rates.SEK);
  const usdChf = Number(rates.CHF);
  if (![euroPerUsd, usdJpy, poundPerUsd, usdCad, usdSek, usdChf]
    .every(value => Number.isFinite(value) && value > 0)) {
    return NaN;
  }
  return DXY_CONSTANT
    * Math.pow(euroPerUsd, 0.576)
    * Math.pow(usdJpy, 0.136)
    * Math.pow(poundPerUsd, 0.119)
    * Math.pow(usdCad, 0.091)
    * Math.pow(usdSek, 0.042)
    * Math.pow(usdChf, 0.036);
}

async function fetchDollarIndex(): Promise<MacroSpotAsset> {
  const startDate = new Date(Date.now() - 45 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const response = await fetch(
    `https://api.frankfurter.app/${startDate}..?from=USD&to=EUR,JPY,GBP,CAD,SEK,CHF`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error(`Frankfurter HTTP ${response.status}`);
  const payload = await response.json() as FrankfurterPayload;
  const history = Object.entries(payload.rates || {})
    .map(([date, rates]) => ({ date, value: calculateDollarIndex(rates) }))
    .filter(row => Number.isFinite(row.value) && row.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (history.length < 21) throw new Error('Dollar-index history too short');

  const latest = history[history.length - 1];
  const previous = history[history.length - 2];
  const atOffset = (offset: number): number | null => {
    const row = history[history.length - offset - 1];
    return row ? row.value : null;
  };
  const fiveAgo = atOffset(5);
  const twentyAgo = atOffset(20);
  return {
    id: 'dollar',
    symbol: 'DXY',
    nameZh: '美元指数',
    unitZh: '指数点',
    price: round(latest.value, 2),
    changePct: round((latest.value - previous.value) / previous.value * 100, 2),
    previousClose: round(previous.value, 2),
    dayHigh: null,
    dayLow: null,
    dayRangePositionPct: null,
    updatedAtZh: latest.date,
    trend5dPct: fiveAgo ? round((latest.value - fiveAgo) / fiveAgo * 100, 2) : null,
    trend20dPct: twentyAgo ? round((latest.value - twentyAgo) / twentyAgo * 100, 2) : null,
  };
}

async function requestSnapshot(): Promise<GlobalMacroSpotSnapshot> {
  const errors: string[] = [];
  let spotRows: Array<Omit<MacroSpotAsset, 'trend5dPct' | 'trend20dPct'>> = [];
  const [spotResult, dollarResult] = await Promise.allSettled([
    fetchTencentSpotText().then(parseTencentSpot),
    fetchDollarIndex(),
  ]);

  let dollar: MacroSpotAsset | null = null;
  if (spotResult.status === 'fulfilled') {
    spotRows = spotResult.value;
  } else {
    errors.push('现货商品数据暂不可用');
  }
  if (dollarResult.status === 'fulfilled') {
    dollar = dollarResult.value;
  } else {
    errors.push('美元指数暂不可用');
  }

  const assets = [
    ...spotRows.map(row => ({ ...row, trend5dPct: null, trend20dPct: null })),
    ...(dollar ? [dollar] : []),
  ]
    .sort((a, b) => {
      const order: MacroSpotAsset['id'][] = ['gold', 'silver', 'wti', 'brent', 'dollar'];
      return order.indexOf(a.id) - order.indexOf(b.id);
    });
  if (assets.length < 3) throw new Error(errors.join('；') || '宏观现货数据不足');

  const byId = new Map(assets.map(asset => [asset.id, asset]));
  const gold = byId.get('gold');
  const silver = byId.get('silver');
  const wti = byId.get('wti');
  const brent = byId.get('brent');
  const dollarIndex = byId.get('dollar');
  const goldSilverRatio = gold && silver && silver.price > 0
    ? round(gold.price / silver.price, 2)
    : null;

  const preciousValues = [gold?.changePct, silver?.changePct]
    .filter((value): value is number => typeof value === 'number');
  const preciousMove = preciousValues.length
    ? preciousValues.reduce((sum, value) => sum + value, 0) / preciousValues.length
    : 0;
  const energyMoves = [wti?.changePct, brent?.changePct]
    .filter((value): value is number => typeof value === 'number');
  const energyMove = energyMoves.length
    ? energyMoves.reduce((sum, value) => sum + value, 0) / energyMoves.length
    : 0;
  const dollarTrend = dollarIndex?.trend5dPct ?? 0;

  let signal: GlobalMacroSpotSnapshot['signal'] = 'balanced';
  let signalZh = '宏观定价平衡';
  let adviceZh = '黄金、原油和美元没有形成一边倒信号。维持常规仓位管理，等待价格突破或重要宏观数据确认方向。';
  let regimeBoost = 0;

  const preciousStrong = preciousMove >= 0.8 && (dollarTrend <= -0.3 || !dollarIndex);
  const dollarStrong = Boolean(dollarIndex) && dollarTrend >= 0.7 && preciousMove <= -0.8;
  const energyShock = Math.abs(energyMove) >= 2.5;

  if (preciousStrong) {
    signal = 'hard-asset-strong';
    signalZh = '硬资产偏强';
    adviceZh = '金银走强且美元近几日未施压，市场可能在寻找抗通胀或避险锚。风险资产可参与但别追高，保留现金缓冲。';
    regimeBoost = clamp(dollarTrend <= -0.7 ? 2 : 1, -3, 3);
  } else if (dollarStrong) {
    signal = 'dollar-strong';
    signalZh = '美元偏强';
    adviceZh = '美元短线转强而金银回落，对高估值股票、加密资产和无现金流资产是压力测试。降低追涨意愿，关注关键支撑。';
    regimeBoost = -2;
  } else if (energyShock && energyMove > 0) {
    signal = 'energy-shock';
    signalZh = '能源通胀冲击';
    adviceZh = '油价明显上行可能抬升通胀预期。成长股和高久期资产更敏感，控制杠杆并观察能源传导是否持续。';
    regimeBoost = -1;
  } else if (energyShock && energyMove < 0) {
    signal = 'energy-shock';
    signalZh = '能源需求降温';
    adviceZh = '油价快速回落可能反映需求担忧或供给缓解。对消费和运输成本有利，但对周期情绪未必友好，先看是否延续。';
    regimeBoost = energyMove <= -4 ? -1 : 0;
  }

  const movers = assets
    .map(asset => `${asset.nameZh} ${asset.changePct >= 0 ? '+' : ''}${asset.changePct}%`)
    .join('，');
  const summaryZh = `已跟踪 ${assets.length} 个宏观现货锚：${movers}${goldSilverRatio ? `；金银比 ${goldSilverRatio}` : ''}。`;
  const advisorBiasZh = regimeBoost > 0
    ? '略偏风险，但强调不追高'
    : regimeBoost < 0
      ? '略偏防守，优先控制回撤'
      : '中性观察';

  return {
    assets,
    goldSilverRatio,
    signal,
    signalZh,
    adviceZh,
    confidence: clamp(Math.round(72 - errors.length * 12 + assets.length * 2), 45, 88),
    regimeBoost,
    summaryZh,
    advisorBiasZh,
    generatedAt: new Date().toISOString(),
    sources: [
      ...new Set([
        ...(spotRows.length ? ['Tencent Finance public overseas spot quotes'] : []),
        ...(dollar ? ['Frankfurter / European Central Bank USD fixings'] : []),
      ]),
    ],
    errors,
  };
}

export async function getGlobalMacroSpotSnapshot(): Promise<GlobalMacroSpotSnapshot> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;
  const request = requestSnapshot();
  cache = { ts: Date.now(), value: request };
  try {
    return await request;
  } catch (error) {
    if (cache?.value === request) cache = null;
    throw error;
  }
}
