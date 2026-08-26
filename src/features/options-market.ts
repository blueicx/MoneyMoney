/**
 * Free options market data from Deribit's public API.
 * No API key and no trading permission is required.
 */

export interface OptionRow {
  instrumentName: string;
  strike: number;
  optionType: 'call' | 'put';
  markPrice: number;
  premiumUsd: number;
  impliedVolPct: number;
  bidPrice: number;
  askPrice: number;
  spreadPct: number | null;
  volume: number;
  volumeUsd: number;
  openInterest: number;
  delta?: number;
  gammaExposureUsd?: number;
}

export interface OptionExpiry {
  expiryMs: number;
  label: string;
  daysToExpiry: number;
  rows: OptionRow[];
  callOpenInterest: number;
  putOpenInterest: number;
  callVolume: number;
  putVolume: number;
  putCallOIRatio: number | null;
  putCallVolumeRatio: number | null;
  maxPainStrike: number | null;
  netGammaExposureUsd?: number;
  callWallStrike?: number | null;
  putWallStrike?: number | null;
  strategyIdeas: OptionStrategyIdea[];
}

export interface OptionStrategyIdea {
  id: string;
  nameZh: string;
  outlookZh: string;
  riskZh: string;
  score: number;
  strikes?: {
    shortPut?: number;
    longPut?: number;
    shortCall?: number;
    longCall?: number;
  };
  legsZh: string[];
  reasonsZh: string[];
  riskNotesZh: string[];
}

export interface OptionsSnapshot {
  source: string;
  market: 'crypto' | 'us_equity';
  asset: string;
  fetchedAt: string;
  spot: number;
  totalCallOpenInterest: number;
  totalPutOpenInterest: number;
  totalPutCallOIRatio: number | null;
  quote?: {
    change: number;
    changePercent: number;
    volume: number;
    iv30Pct?: number;
    bid?: number;
    ask?: number;
  };
  expiries: OptionExpiry[];
}

interface CacheEntry {
  ts: number;
  value: OptionsSnapshot;
}

const snapshotCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const equityCache = new Map<string, CacheEntry>();
const EQUITY_CACHE_TTL_MS = 5 * 60_000;
const CONTRACT_MULTIPLIER = 100;

function num(value: any, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchResult(url: string): Promise<any> {
  const response = await fetch(url, {
     headers: { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Deribit HTTP ${response.status}`);
  const payload: any = await response.json();
  if (payload?.error_code) throw new Error(payload.message || `Deribit error ${payload.error_code}`);
  return payload.result;
}

function expiryLabel(expiryMs: number): string {
  return new Date(expiryMs).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  });
}

function calculateMaxPain(rows: OptionRow[]): number | null {
  const strikes = [...new Set(rows.map(row => row.strike))].sort((a, b) => a - b);
  if (!strikes.length) return null;

  let bestStrike = strikes[0];
  let bestPain = Number.MAX_SAFE_INTEGER;
  for (const settlement of strikes) {
    let pain = 0;
    for (const row of rows) {
      const intrinsic = row.optionType === 'call'
        ? Math.max(0, settlement - row.strike)
        : Math.max(0, row.strike - settlement);
      pain += intrinsic * row.openInterest;
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = settlement;
    }
  }
  return bestStrike;
}

function gammaAt(rows: OptionRow[], strike: number | null): number {
  return strike == null ? 0 : Math.abs(rows.find(row => row.strike === strike)?.gammaExposureUsd || 0);
}

function nearestStrike(rows: OptionRow[], optionType: 'call' | 'put', spot: number): number | null {
  const candidates = rows.filter(row => row.optionType === optionType);
  if (!candidates.length) return null;
  return candidates.reduce((best, row) =>
    Math.abs(row.strike - spot) < Math.abs(best - spot) ? row.strike : best, candidates[0].strike);
}

function strikeNear(
  rows: OptionRow[],
  optionType: 'call' | 'put',
  spot: number,
  distancePct: number,
): number | null {
  const target = optionType === 'call' ? spot * (1 + distancePct) : spot * (1 - distancePct);
  const candidates = rows.filter(row => row.optionType === optionType);
  if (!candidates.length) return null;
  return candidates.reduce((best, row) =>
    Math.abs(row.strike - target) < Math.abs(best - target) ? row.strike : best, candidates[0].strike);
}

function strikeBeyond(
  rows: OptionRow[],
  optionType: 'call' | 'put',
  anchor: number,
): number | null {
  const candidates = rows.filter(row => optionType === 'put' ? row.strike < anchor : row.strike > anchor);
  if (!candidates.length) return null;
  const target = optionType === 'put' ? anchor * 0.96 : anchor * 1.04;
  return candidates.reduce((best, row) =>
    Math.abs(row.strike - target) < Math.abs(best - target) ? row.strike : best, candidates[0].strike);
}

function pct(value: number, digits = 2): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function buildStrategyIdeas(
  rows: OptionRow[],
  spot: number,
  expiryMs: number,
  callWallStrike: number | null | undefined,
  putWallStrike: number | null | undefined,
  netGammaExposureUsd: number | undefined,
): OptionStrategyIdea[] {
  const calls = rows.filter(row => row.optionType === 'call');
  const puts = rows.filter(row => row.optionType === 'put');
  if (!calls.length || !puts.length) return [];

  const callOI = calls.reduce((sum, row) => sum + row.openInterest, 0);
  const putOI = puts.reduce((sum, row) => sum + row.openInterest, 0);
  const callVolume = calls.reduce((sum, row) => sum + row.volume, 0);
  const putVolume = puts.reduce((sum, row) => sum + row.volume, 0);
  const pcr = callOI > 0 ? putOI / callOI : null;
  const volumePcr = callVolume > 0 ? putVolume / callVolume : null;
  const maxPain = calculateMaxPain(rows);
  const maxPainDistancePct = maxPain ? ((maxPain - spot) / spot) * 100 : 0;
  const atmCallStrike = nearestStrike(calls, 'call', spot);
  const atmPutStrike = nearestStrike(puts, 'put', spot);
  const atmCall = calls.find(row => row.strike === atmCallStrike);
  const atmPut = puts.find(row => row.strike === atmPutStrike);
  const atmIv = atmCall && atmPut && atmCall.impliedVolPct > 0 && atmPut.impliedVolPct > 0
    ? (atmCall.impliedVolPct + atmPut.impliedVolPct) / 2
    : Math.max(atmCall?.impliedVolPct || 0, atmPut?.impliedVolPct || 0);
  const positiveGex = (netGammaExposureUsd || 0) > 0;
  const negativeGex = (netGammaExposureUsd || 0) < 0;
  const daysToExpiry = Math.max(0, Math.round((expiryMs - Date.now()) / 86_400_000));
  const score = (value: number) => Math.round(Math.max(8, Math.min(94, value)));

  const shortPut = putWallStrike ?? strikeNear(puts, 'put', spot, 0.04) ?? nearestStrike(puts, 'put', spot);
  const longPut = shortPut == null ? null : strikeBeyond(puts, 'put', shortPut) ?? shortPut;
  const shortCall = callWallStrike ?? strikeNear(calls, 'call', spot, 0.04) ?? nearestStrike(calls, 'call', spot);
  const longCall = shortCall == null ? null : strikeBeyond(calls, 'call', shortCall) ?? shortCall;
  const fmt = (value: number | null | undefined) => value == null ? '--' : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const pcrText = pcr == null ? '无' : pcr.toFixed(2);
  const volumePcrText = volumePcr == null ? '无' : volumePcr.toFixed(2);
  const commonRisk = [
    `ATM 隐含波动率约 ${atmIv.toFixed(1)}%；期权买方要先跨过时间价值损耗。`,
    `距离到期 ${daysToExpiry} 天，临近到期 Gamma 和流动性变化会更快。`,
  ];

  const condorScore = score(
    44
    + (pcr != null && pcr >= 0.72 && pcr <= 1.38 ? 18 : 0)
    + (Math.abs(maxPainDistancePct) <= 1.6 ? 14 : 0)
    + (positiveGex ? 12 : negativeGex ? -10 : 0)
    + (daysToExpiry >= 7 && daysToExpiry <= 45 ? 5 : 0)
    - (atmIv > 85 ? 7 : 0),
  );

  const bullPutScore = score(
    38
    + (pcr != null && pcr < 1.05 ? 13 : 0)
    + (maxPain != null && maxPain > spot ? 10 : 0)
    + (positiveGex ? 10 : negativeGex ? -12 : 0)
    + (atmIv > 0 && atmIv < 70 ? 6 : 0),
  );

  const bearCallScore = score(
    38
    + (pcr != null && pcr > 1.18 ? 14 : 0)
    + (maxPain != null && maxPain < spot ? 9 : 0)
    + (negativeGex ? 13 : positiveGex ? -8 : 0)
    + (atmIv > 45 ? 5 : 0),
  );

  const protectivePutScore = score(
    33
    + (negativeGex ? 18 : 0)
    + (pcr != null && pcr > 1.15 ? 11 : 0)
    + (maxPain != null && maxPain < spot ? 7 : 0)
    + (atmIv > 0 && atmIv < 65 ? 6 : -4),
  );

  return [
    {
      id: 'iron-condor',
      nameZh: '铁鹰 / 铁兀鹰',
      outlookZh: '区间震荡',
      riskZh: '四腿 · 风险有限',
      score: condorScore,
      strikes: shortPut == null || longPut == null || shortCall == null || longCall == null
        ? undefined
        : { shortPut, longPut, shortCall, longCall },
      legsZh: [
        `卖出约 ${fmt(shortPut)} Put，买入约 ${fmt(longPut)} Put`,
        `卖出约 ${fmt(shortCall)} Call，买入约 ${fmt(longCall)} Call`,
      ],
      reasonsZh: [
        `本到期 PCR ${pcrText}，成交量 PCR ${volumePcrText}。`,
        `最大痛点 ${fmt(maxPain)}，距离现价 ${pct(maxPainDistancePct)}。`,
        netGammaExposureUsd == null
          ? '该来源未提供可靠 GEX，区间判断主要来自 PCR 与最大痛点。'
          : positiveGex
            ? '正 GEX 常伴随 dealer 稳定波动的环境，适合观察区间策略。'
            : '负 GEX 环境波动可能放大，区间策略要降低仓位。',
      ],
      riskNotesZh: commonRisk,
    },
    {
      id: 'bull-put-spread',
      nameZh: '牛市 Put 价差',
      outlookZh: '温和看涨 / 守住支撑',
      riskZh: '两腿 · 风险有限',
      score: bullPutScore,
      strikes: shortPut == null || longPut == null ? undefined : { shortPut, longPut },
      legsZh: [
        `卖出约 ${fmt(shortPut)} Put`,
        `买入更低行权价约 ${fmt(longPut)} Put`,
      ],
      reasonsZh: [
        `Put 持仓比例 ${pcrText}，若低于 1 通常没有明显避险拥挤。`,
        putWallStrike ? `Put Wall 约 ${fmt(putWallStrike)}，可作为支撑观察位。` : '以现价下方 4% 附近作为支撑观察位。',
      ],
      riskNotesZh: [
        '跌破短期支撑或标的快速放量下行时应重新评估。',
        ...commonRisk,
      ],
    },
    {
      id: 'bear-call-spread',
      nameZh: '熊市 Call 价差',
      outlookZh: '温和看空 / 阻力承压',
      riskZh: '两腿 · 风险有限',
      score: bearCallScore,
      strikes: shortCall == null || longCall == null ? undefined : { shortCall, longCall },
      legsZh: [
        `卖出约 ${fmt(shortCall)} Call`,
        `买入更高行权价约 ${fmt(longCall)} Call`,
      ],
      reasonsZh: [
        `Put 持仓比例 ${pcrText}，若偏高说明避险需求增强。`,
        callWallStrike ? `Call Wall 约 ${fmt(callWallStrike)}，可作为阻力观察位。` : '以现价上方 4% 附近作为阻力观察位。',
      ],
      riskNotesZh: [
        '强势突破 Call Wall 时不要逆势加仓。',
        ...commonRisk,
      ],
    },
    {
      id: 'protective-put',
      nameZh: '保护性 Put',
      outlookZh: '持仓保险',
      riskZh: '买入 Put · 最大亏损为权利金',
      score: protectivePutScore,
      strikes: (() => {
        const strike = strikeNear(puts, 'put', spot, 0.05) ?? nearestStrike(puts, 'put', spot);
        return strike == null ? undefined : { longPut: strike };
      })(),
      legsZh: [
        `持有标的时，买入约 ${fmt(strikeNear(puts, 'put', spot, 0.05) ?? nearestStrike(puts, 'put', spot))} Put`,
      ],
      reasonsZh: [
        netGammaExposureUsd == null
          ? '当前缺少 GEX，但 PCR 偏高时可作为持仓保险参考。'
          : negativeGex
            ? '负 GEX 环境下下跌波动可能放大，保护性 Put 更值得关注。'
            : '正 GEX 环境下跌风险相对温和，保险需求较低。',
      ],
      riskNotesZh: [
        '保险成本会拖累收益，适合事件或持仓保护，不适合长期无条件滚动。',
        ...commonRisk,
      ],
    },
  ].sort((a, b) => b.score - a.score);
}

function buildExpiry(expiryMs: number, rows: OptionRow[], spot: number): OptionExpiry {
  const calls = rows.filter(row => row.optionType === 'call');
  const puts = rows.filter(row => row.optionType === 'put');
  const callOI = calls.reduce((sum, row) => sum + row.openInterest, 0);
  const putOI = puts.reduce((sum, row) => sum + row.openInterest, 0);
  const callVolume = calls.reduce((sum, row) => sum + row.volume, 0);
  const putVolume = puts.reduce((sum, row) => sum + row.volume, 0);
  const hasGamma = rows.some(row => row.gammaExposureUsd != null);
  const callWall = hasGamma
    ? calls.reduce<number | null>((best, row) =>
        (row.gammaExposureUsd || 0) > gammaAt(calls, best) ? row.strike : best, null)
    : null;
  const putWall = hasGamma
    ? puts.reduce<number | null>((best, row) =>
        Math.abs(row.gammaExposureUsd || 0) > gammaAt(puts, best) ? row.strike : best, null)
    : null;
  const netGammaExposureUsd = hasGamma
    ? rows.reduce((sum, row) => sum + (row.gammaExposureUsd || 0), 0)
    : undefined;

  return {
    expiryMs,
    label: expiryLabel(expiryMs),
    daysToExpiry: Math.max(0, Math.round((expiryMs - Date.now()) / 86_400_000)),
    rows: rows.sort((a, b) => a.strike - b.strike || a.optionType.localeCompare(b.optionType)),
    callOpenInterest: callOI,
    putOpenInterest: putOI,
    callVolume,
    putVolume,
    putCallOIRatio: callOI > 0 ? putOI / callOI : null,
    putCallVolumeRatio: callVolume > 0 ? putVolume / callVolume : null,
    maxPainStrike: calculateMaxPain(rows),
    netGammaExposureUsd,
    callWallStrike: callWall,
    putWallStrike: putWall,
    strategyIdeas: buildStrategyIdeas(
      rows,
      spot,
      expiryMs,
      callWall,
      putWall,
      netGammaExposureUsd,
    ),
  };
}

function toOptionRow(item: any, spot: number): OptionRow | null {
  const name = String(item.instrument_name || '');
  const parts = name.split('-');
  const assetPrefix = parts[0] || '';
  if (parts.length !== 4 || !['BTC', 'ETH'].includes(assetPrefix)) return null;
  const rawStrike = num(item.strike, NaN);
  const strike = Number.isFinite(rawStrike) ? rawStrike : num(parts[2]);
  const type = (parts[3] || '').toUpperCase() === 'P' ? 'put' : 'call';
  const markPriceBtc = num(item.mark_price);
  const bid = num(item.bid_price);
  const ask = num(item.ask_price);
  const spreadPct = bid > 0 && ask >= bid ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;
  return {
    instrumentName: name,
    strike,
    optionType: type,
    markPrice: markPriceBtc,
    premiumUsd: markPriceBtc * spot,
    impliedVolPct: num(item.mark_iv),
    bidPrice: item.bid_price == null ? 0 : bid,
    askPrice: item.ask_price == null ? 0 : ask,
    spreadPct,
    volume: num(item.volume),
    volumeUsd: num(item.volume_usd),
    openInterest: num(item.open_interest),
  };
}

function buildDeribitExpiries(instruments: any[], summaries: any[], asset: string, spot: number): OptionExpiry[] {
  const instrumentExpiry = new Map<string, number>();
  for (const item of instruments) {
    if (String(item.kind).toLowerCase() === 'option' && item.expiration_timestamp) {
      instrumentExpiry.set(String(item.instrument_name), num(item.expiration_timestamp));
    }
  }

  const grouped = new Map<number, OptionRow[]>();
  for (const item of summaries) {
    const name = String(item.instrument_name || '');
    const expiryMs = instrumentExpiry.get(name);
    if (!expiryMs || String(item.instrument_name || '').split('-')[0] !== asset) continue;
    const row = toOptionRow(item, spot);
    if (!row) continue;
    const list = grouped.get(expiryMs) || [];
    list.push(row);
    grouped.set(expiryMs, list);
  }

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([expiryMs, rows]) => buildExpiry(expiryMs, rows, spot));
}

export async function getOptionsSnapshot(rawAsset: string): Promise<OptionsSnapshot> {
  const asset = String(rawAsset || 'BTC').toUpperCase();
  if (!['BTC', 'ETH'].includes(asset)) throw new Error('目前支持 BTC 和 ETH 免费期权数据');
  const cached = snapshotCache.get(asset);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const base = 'https://www.deribit.com/api/v2/public';
  const [index, instruments, summaries] = await Promise.all([
    fetchResult(`${base}/get_index_price?index_name=${asset.toLowerCase()}_usd`),
    fetchResult(`${base}/get_instruments?currency=${asset}&kind=option&expired=false`),
    fetchResult(`${base}/get_book_summary_by_currency?currency=${asset}&kind=option`),
  ]);

  const spot = Number(index?.price) || num(summaries.find((item: any) => item.underlying_price)?.underlying_price);
  if (!spot) throw new Error('无法读取标的指数价格');
  const expiries = buildDeribitExpiries(instruments || [], summaries || [], asset, spot);
  const totalCallOpenInterest = expiries.reduce((sum, expiry) => sum + expiry.callOpenInterest, 0);
  const totalPutOpenInterest = expiries.reduce((sum, expiry) => sum + expiry.putOpenInterest, 0);
  const value: OptionsSnapshot = {
    source: 'Deribit Public API',
    market: 'crypto',
    asset,
    fetchedAt: new Date().toISOString(),
    spot,
    totalCallOpenInterest,
    totalPutOpenInterest,
    totalPutCallOIRatio: totalCallOpenInterest > 0 ? totalPutOpenInterest / totalCallOpenInterest : null,
    expiries,
  };
  snapshotCache.set(asset, { ts: Date.now(), value });
  return value;
}

function normalizeEquitySymbol(raw: string): string {
  const symbol = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{1,6}(?:[.-][A-Z])?$/.test(symbol)) {
    throw new Error('请输入有效的美股/ETF 代码，例如 AAPL、SPY 或 TSLA');
  }
  return symbol;
}

function parseCboeOptionSymbol(value: string) {
  const match = /^([A-Z0-9]{1,6})(\d{6})([CP])(\d{8})$/.exec(String(value || '').toUpperCase());
  if (!match) return null;
  const [, , expiry, kind, strikeText] = match;
  return {
    expiryMs: Date.UTC(
      2000 + Number(expiry.slice(0, 2)),
      Number(expiry.slice(2, 4)) - 1,
      Number(expiry.slice(4, 6)),
      20,
    ),
    optionType: kind === 'P' ? 'put' as const : 'call' as const,
    strike: Number(strikeText) / 1000,
  };
}

function cboePremium(item: any): number {
  const bid = num(item.bid);
  const ask = num(item.ask);
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return num(item.last_trade_price) || num(item.theo) || num(item.prev_day_close);
}

function buildCboeExpiries(options: any[], spot: number): OptionExpiry[] {
  const grouped = new Map<number, OptionRow[]>();
  for (const item of options) {
    const parsed = parseCboeOptionSymbol(String(item.option || ''));
    if (!parsed) continue;
    const openInterest = num(item.open_interest);
    const volume = num(item.volume);
    const bid = num(item.bid);
    const ask = num(item.ask);
    const last = num(item.last_trade_price);
    // CBOE returns many empty strikes for giants such as SPY; keep the chain readable.
    if (!openInterest && !volume && !bid && !ask && !last) continue;

    const mark = cboePremium(item);
    const spreadPct = bid > 0 && ask >= bid ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;
    const gamma = num(item.gamma);
    // First-order dollar gamma for a 1% underlying move. Calls are dealer-positive
    // and puts dealer-negative in this common approximation.
    const gammaExposureUsd = gamma > 0 && openInterest > 0
      ? gamma * openInterest * CONTRACT_MULTIPLIER * spot * spot * 0.01 * (parsed.optionType === 'call' ? 1 : -1)
      : 0;
    const row: OptionRow = {
      instrumentName: String(item.option),
      strike: parsed.strike,
      optionType: parsed.optionType,
      markPrice: mark,
      premiumUsd: mark,
      impliedVolPct: num(item.iv) * 100,
      bidPrice: bid,
      askPrice: ask,
      spreadPct,
      volume,
      volumeUsd: volume * mark * CONTRACT_MULTIPLIER,
      openInterest,
      delta: item.delta == null ? undefined : num(item.delta),
      gammaExposureUsd,
    };
    const rows = grouped.get(parsed.expiryMs) || [];
    rows.push(row);
    grouped.set(parsed.expiryMs, rows);
  }

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, 12)
    .map(([expiryMs, rows]) => buildExpiry(expiryMs, rows, spot));
}

export async function getEquityOptionsSnapshot(rawSymbol: string): Promise<OptionsSnapshot> {
  const symbol = normalizeEquitySymbol(rawSymbol);
  const cached = equityCache.get(symbol);
  if (cached && Date.now() - cached.ts < EQUITY_CACHE_TTL_MS) return cached.value;

  const response = await fetch(
    `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(response.status === 404 ? `CBOE 暂无 ${symbol} 期权数据` : `CBOE HTTP ${response.status}`);
  }
  const payload: any = await response.json();
  const data = payload?.data;
  if (!data?.current_price || !Array.isArray(data.options)) throw new Error(`CBOE 返回的 ${symbol} 数据不完整`);

  const expiries = buildCboeExpiries(data.options, Number(data.current_price));
  if (!expiries.length) throw new Error(`${symbol} 暂无有持仓或报价的期权链`);
  const totalCallOpenInterest = expiries.reduce((sum, expiry) => sum + expiry.callOpenInterest, 0);
  const totalPutOpenInterest = expiries.reduce((sum, expiry) => sum + expiry.putOpenInterest, 0);
  const value: OptionsSnapshot = {
    source: 'CBOE Delayed Quotes',
    market: 'us_equity',
    asset: symbol,
    fetchedAt: new Date().toISOString(),
    spot: Number(data.current_price),
    totalCallOpenInterest,
    totalPutOpenInterest,
    totalPutCallOIRatio: totalCallOpenInterest > 0 ? totalPutOpenInterest / totalCallOpenInterest : null,
    quote: {
      change: num(data.price_change),
      changePercent: num(data.price_change_percent),
      volume: num(data.volume),
      iv30Pct: data.iv30 == null ? undefined : num(data.iv30),
      bid: data.bid == null ? undefined : num(data.bid),
      ask: data.ask == null ? undefined : num(data.ask),
    },
    expiries,
  };
  if (equityCache.size >= 8) {
    const oldestKey = equityCache.keys().next().value;
    if (oldestKey) equityCache.delete(oldestKey);
  }
  equityCache.set(symbol, { ts: Date.now(), value });
  return value;
}
