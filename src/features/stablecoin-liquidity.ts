/**
 * Keyless stablecoin liquidity radar.
 *
 * Stablecoin supply is a slow liquidity proxy, not a direct flow measure. The
 * provider currently does not expose a verifiable observation timestamp, so
 * the snapshot remains research-only and cannot affect trade-assistant scores.
 */

export interface StablecoinFlowRow {
  id: number | null;
  symbol: string;
  name: string;
  circulatingUsd: number;
  netFlow1dUsd: number | null;
  netFlow7dUsd: number | null;
  netFlow30dUsd: number | null;
  change1dPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  pegPrice: number | null;
  pegDeviationPct: number | null;
}

export interface StablecoinLiquidityResult {
  market: 'crypto';
  source: 'DefiLlama Stablecoins Public API';
  fetchedAt: string;
  retrievedAt: string;
  sourceUpdatedAt: string | null;
  dataStatus: 'live' | 'partial' | 'empty' | 'unavailable';
  cacheStatus: 'hit' | 'miss';
  reason: string | null;
  coverage: {
    assetCount: number;
    validSupplyCount: number;
    invalidAssetCount: number;
    flow1dCount: number;
    flow7dCount: number;
    flow30dCount: number;
    pegPriceCount: number;
  };
  totalCirculatingUsd: number | null;
  netFlow1dUsd: number | null;
  netFlow7dUsd: number | null;
  netFlow30dUsd: number | null;
  change1dPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  flowScore: number | null;
  signal: 'expansion' | 'neutral' | 'contraction' | 'unavailable';
  signalZh: string;
  riskBias: 'Risk-on' | 'Risk-off' | 'Neutral' | 'Unavailable';
  advisorBiasZh: string;
  regimeBoost: number | null;
  top5: StablecoinFlowRow[];
}

const CACHE_TTL_MS = 10 * 60_000;
let cache: { ts: number; value: StablecoinLiquidityResult } | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function normalizeChangeScore(pct: number): number {
  // Aggregate supply moves are usually small; 1.5% is a strong liquidity shift.
  return clamp(pct / 1.5 * 100, -100, 100);
}

function compactUsd(value: number | null): string {
  if (value === null) return '暂无';
  const abs = Math.abs(value);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

function emptyResult(
  dataStatus: 'empty' | 'unavailable',
  reason: string,
  retrievedAt: string,
  cacheStatus: 'hit' | 'miss',
  assetCount = 0,
): StablecoinLiquidityResult {
  return {
    market: 'crypto',
    source: 'DefiLlama Stablecoins Public API',
    fetchedAt: retrievedAt,
    retrievedAt,
    sourceUpdatedAt: null,
    dataStatus,
    cacheStatus,
    reason,
    coverage: {
      assetCount,
      validSupplyCount: 0,
      invalidAssetCount: assetCount,
      flow1dCount: 0,
      flow7dCount: 0,
      flow30dCount: 0,
      pegPriceCount: 0,
    },
    totalCirculatingUsd: null,
    netFlow1dUsd: null,
    netFlow7dUsd: null,
    netFlow30dUsd: null,
    change1dPct: null,
    change7dPct: null,
    change30dPct: null,
    flowScore: null,
    signal: 'unavailable',
    signalZh: dataStatus === 'empty' ? '来源暂无稳定币记录' : '稳定币流动性数据不可用',
    riskBias: 'Unavailable',
    advisorBiasZh: reason,
    regimeBoost: null,
    top5: [],
  };
}

/** Normalize the provider envelope while preserving missing fields and coverage. */
export function buildStablecoinLiquidity(
  payload: unknown,
  retrievedAt = new Date().toISOString(),
  cacheStatus: 'hit' | 'miss' = 'miss',
): StablecoinLiquidityResult {
  const assets = (payload as any)?.peggedAssets;
  if (!Array.isArray(assets)) {
    return emptyResult('unavailable', 'DefiLlama 响应缺少 peggedAssets 数组', retrievedAt, cacheStatus);
  }
  if (!assets.length) {
    return emptyResult('empty', 'DefiLlama 请求成功，但没有稳定币记录', retrievedAt, cacheStatus);
  }

  let invalidAssetCount = 0;
  const rows: StablecoinFlowRow[] = [];
  for (const item of assets) {
    const current = optionalNumber(item?.circulating?.peggedUSD);
    const symbol = String(item?.symbol || item?.name || '').trim();
    const name = String(item?.name || item?.symbol || '').trim();
    if (current === null || current <= 0 || !symbol || !name) {
      invalidAssetCount += 1;
      continue;
    }

    const previousDay = optionalNumber(item?.circulatingPrevDay?.peggedUSD);
    const previousWeek = optionalNumber(item?.circulatingPrevWeek?.peggedUSD);
    const previousMonth = optionalNumber(item?.circulatingPrevMonth?.peggedUSD);
    const validPreviousDay = previousDay !== null && previousDay >= 0 ? previousDay : null;
    const validPreviousWeek = previousWeek !== null && previousWeek >= 0 ? previousWeek : null;
    const validPreviousMonth = previousMonth !== null && previousMonth >= 0 ? previousMonth : null;
    const pegPriceValue = optionalNumber(item?.price);
    const pegPrice = pegPriceValue !== null && pegPriceValue > 0 ? pegPriceValue : null;

    rows.push({
      id: Number.isSafeInteger(Number(item?.id)) && Number(item.id) > 0 ? Number(item.id) : null,
      symbol,
      name,
      circulatingUsd: current,
      netFlow1dUsd: validPreviousDay === null ? null : current - validPreviousDay,
      netFlow7dUsd: validPreviousWeek === null ? null : current - validPreviousWeek,
      netFlow30dUsd: validPreviousMonth === null ? null : current - validPreviousMonth,
      change1dPct: pctChange(current, validPreviousDay),
      change7dPct: pctChange(current, validPreviousWeek),
      change30dPct: pctChange(current, validPreviousMonth),
      pegPrice,
      pegDeviationPct: pegPrice === null ? null : (pegPrice - 1) * 100,
    });
  }

  if (!rows.length) {
    return emptyResult(
      'unavailable',
      `DefiLlama 返回 ${assets.length} 条记录，但没有有效资产身份和流通量`,
      retrievedAt,
      cacheStatus,
      assets.length,
    );
  }

  rows.sort((a, b) => b.circulatingUsd - a.circulatingUsd);
  const flow1dCount = rows.filter(row => row.netFlow1dUsd !== null).length;
  const flow7dCount = rows.filter(row => row.netFlow7dUsd !== null).length;
  const flow30dCount = rows.filter(row => row.netFlow30dUsd !== null).length;
  const pegPriceCount = rows.filter(row => row.pegPrice !== null).length;
  const completeUniverse = invalidAssetCount === 0;

  const aggregateHorizon = (horizon: '1d' | '7d' | '30d', coverageCount: number) => {
    if (!completeUniverse || coverageCount !== rows.length) return { flow: null, pct: null };
    const flowKey = `netFlow${horizon}Usd` as const;
    const flow = rows.reduce((sum, row) => sum + (row[flowKey] || 0), 0);
    const current = rows.reduce((sum, row) => sum + row.circulatingUsd, 0);
    const previous = current - flow;
    return { flow, pct: pctChange(current, previous) };
  };

  const oneDay = aggregateHorizon('1d', flow1dCount);
  const oneWeek = aggregateHorizon('7d', flow7dCount);
  const oneMonth = aggregateHorizon('30d', flow30dCount);
  // DefiLlama's current endpoint exposes no source observation time. Keep the
  // data visible, but do not turn an unverified snapshot into a direction score.
  const sourceUpdatedAt: string | null = null;
  const enoughCoverage = completeUniverse
    && flow1dCount === rows.length && flow7dCount === rows.length && flow30dCount === rows.length;
  const canScore = sourceUpdatedAt !== null
    && enoughCoverage
    && oneDay.pct !== null && oneWeek.pct !== null && oneMonth.pct !== null;
  const flowScore = canScore
    ? round(
      normalizeChangeScore(oneDay.pct!) * 0.15 +
      normalizeChangeScore(oneWeek.pct!) * 0.35 +
      normalizeChangeScore(oneMonth.pct!) * 0.50,
      1,
    )
    : null;
  const signal: StablecoinLiquidityResult['signal'] = flowScore === null
    ? 'unavailable'
    : flowScore >= 12 ? 'expansion' : flowScore <= -12 ? 'contraction' : 'neutral';
  const signalZh = signal === 'expansion'
    ? '稳定币流入扩张'
    : signal === 'contraction'
      ? '稳定币流出收缩'
      : signal === 'neutral'
        ? '稳定币流动性中性'
        : '综合方向暂不计算';
  const riskBias: StablecoinLiquidityResult['riskBias'] = signal === 'expansion'
    ? 'Risk-on'
    : signal === 'contraction'
      ? 'Risk-off'
      : signal === 'neutral' ? 'Neutral' : 'Unavailable';

  const reasonParts = ['来源未提供可验证观测时间；获取时间仅代表 MoneyMoney 请求时间'];
  if (invalidAssetCount) reasonParts.push(`${invalidAssetCount} 条资产记录身份或流通量无效`);
  if (flow1dCount !== rows.length) reasonParts.push(`1日流量覆盖 ${flow1dCount}/${rows.length}`);
  if (flow7dCount !== rows.length) reasonParts.push(`7日流量覆盖 ${flow7dCount}/${rows.length}`);
  if (flow30dCount !== rows.length) reasonParts.push(`30日流量覆盖 ${flow30dCount}/${rows.length}`);
  if (pegPriceCount !== rows.length) reasonParts.push(`锚定价格覆盖 ${pegPriceCount}/${rows.length}`);
  const reason = reasonParts.join('；');

  const netFlow1dUsd = oneDay.flow;
  const netFlow7dUsd = oneWeek.flow;
  const netFlow30dUsd = oneMonth.flow;
  const advisorBiasZh = flowScore === null
    ? '数据仍可用于查看已返回的原始资产与变化；因源端观测时间未验证或覆盖不完整，不形成综合方向、仓位建议或交易助手加分。'
    : `${signalZh}：1日 ${compactUsd(netFlow1dUsd)} / 7日 ${compactUsd(netFlow7dUsd)} / 30日 ${compactUsd(netFlow30dUsd)}。稳定币总量是慢速流动性 proxy，不代表资金直接流入交易所。`;

  return {
    market: 'crypto',
    source: 'DefiLlama Stablecoins Public API',
    fetchedAt: retrievedAt,
    retrievedAt,
    sourceUpdatedAt,
    dataStatus: sourceUpdatedAt && enoughCoverage ? 'live' : 'partial',
    cacheStatus,
    reason,
    coverage: {
      assetCount: assets.length,
      validSupplyCount: rows.length,
      invalidAssetCount,
      flow1dCount,
      flow7dCount,
      flow30dCount,
      pegPriceCount,
    },
    totalCirculatingUsd: completeUniverse ? rows.reduce((sum, row) => sum + row.circulatingUsd, 0) : null,
    netFlow1dUsd,
    netFlow7dUsd,
    netFlow30dUsd,
    change1dPct: oneDay.pct === null ? null : round(oneDay.pct, 3),
    change7dPct: oneWeek.pct === null ? null : round(oneWeek.pct, 3),
    change30dPct: oneMonth.pct === null ? null : round(oneMonth.pct, 3),
    flowScore,
    signal,
    signalZh,
    riskBias,
    advisorBiasZh,
    regimeBoost: flowScore === null ? null : round(clamp(flowScore * 0.10, -8, 8), 1),
    top5: rows.slice(0, 5),
  };
}

export function isStablecoinLiquidityActionable(
  value: StablecoinLiquidityResult | undefined,
): value is StablecoinLiquidityResult {
  if (!value || value.dataStatus !== 'live' || !value.sourceUpdatedAt
    || !Number.isFinite(value.flowScore) || !Number.isFinite(value.regimeBoost)) return false;
  const coverage = value.coverage;
  return coverage.invalidAssetCount === 0
    && coverage.validSupplyCount === coverage.assetCount
    && coverage.flow1dCount === coverage.validSupplyCount
    && coverage.flow7dCount === coverage.validSupplyCount
    && coverage.flow30dCount === coverage.validSupplyCount;
}

export function stablecoinFlowText(value: number | null): string {
  return compactUsd(value);
}

export async function getStablecoinLiquidity(): Promise<StablecoinLiquidityResult> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return { ...cache.value, cacheStatus: 'hit' };
  }

  const response = await fetch('https://stablecoins.llama.fi/stablecoins?includePrices=false', {
    headers: { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`稳定币数据源 HTTP ${response.status}`);
  const payload = await response.json();
  const value = buildStablecoinLiquidity(payload, new Date().toISOString(), 'miss');
  if (value.dataStatus !== 'unavailable') cache = { ts: Date.now(), value };
  return value;
}
