/**
 * Keyless stablecoin liquidity radar.
 *
 * Stablecoin supply is a slow liquidity proxy: persistent expansion can support
 * risk appetite, while persistent contraction can make rallies harder to fund.
 * The score is deliberately bounded and is used as context, never as a standalone trade.
 */

export interface StablecoinFlowRow {
  id: number;
  symbol: string;
  name: string;
  circulatingUsd: number;
  netFlow1dUsd: number | null;
  netFlow7dUsd: number | null;
  netFlow30dUsd: number | null;
  change1dPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  pegPrice: number;
  pegDeviationPct: number;
}

export interface StablecoinLiquidityResult {
  source: 'DefiLlama Stablecoins Public API';
  fetchedAt: string;
  totalCirculatingUsd: number;
  netFlow1dUsd: number | null;
  netFlow7dUsd: number | null;
  netFlow30dUsd: number | null;
  change1dPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  flowScore: number;
  signal: 'expansion' | 'neutral' | 'contraction';
  signalZh: string;
  riskBias: 'Risk-on' | 'Risk-off' | 'Neutral';
  advisorBiasZh: string;
  regimeBoost: number;
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

function optionalNumber(value: any): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function normalizeChangeScore(pct: number | null): number {
  // Aggregate supply moves are usually small; 1.5% is a strong liquidity shift.
  if (pct === null) return 0;
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

export function stablecoinFlowText(value: number | null): string {
  return compactUsd(value);
}

export async function getStablecoinLiquidity(): Promise<StablecoinLiquidityResult> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const response = await fetch('https://stablecoins.llama.fi/stablecoins?includePrices=false', {
    headers: { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`稳定币数据源 HTTP ${response.status}`);
  const payload: any = await response.json();
  const assets: any[] = Array.isArray(payload?.peggedAssets) ? payload.peggedAssets : [];
  const usable = assets.filter(item => Number(item?.circulating?.peggedUSD) > 0);
  if (!usable.length) throw new Error('稳定币数据为空');

  const rows: StablecoinFlowRow[] = usable.map((item: any) => {
    const current = optionalNumber(item.circulating?.peggedUSD);
    const prevDay = optionalNumber(item.circulatingPrevDay?.peggedUSD);
    const prevWeek = optionalNumber(item.circulatingPrevWeek?.peggedUSD);
    const prevMonth = optionalNumber(item.circulatingPrevMonth?.peggedUSD);
    const pegPrice = optionalNumber(item.price) ?? 1;
    return {
      id: Number(item.id) || 0,
      symbol: String(item.symbol || item.name || 'UNKNOWN'),
      name: String(item.name || item.symbol || 'Unknown'),
      circulatingUsd: current ?? 0,
      netFlow1dUsd: current !== null && prevDay !== null ? current - prevDay : null,
      netFlow7dUsd: current !== null && prevWeek !== null ? current - prevWeek : null,
      netFlow30dUsd: current !== null && prevMonth !== null ? current - prevMonth : null,
      change1dPct: pctChange(current, prevDay),
      change7dPct: pctChange(current, prevWeek),
      change30dPct: pctChange(current, prevMonth),
      pegPrice,
      pegDeviationPct: (pegPrice - 1) * 100,
    };
  }).sort((a, b) => b.circulatingUsd - a.circulatingUsd);

  const sumFlow = (selector: (row: StablecoinFlowRow) => number | null): number | null => {
    const values = rows.map(selector).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const aggregatePct = (selector: (row: StablecoinFlowRow) => number | null): number | null => {
    const values = rows.map(row => ({ current: row.circulatingUsd, flow: selector(row) }))
      .filter(item => item.flow !== null && item.current > 0);
    if (!values.length) return null;
    const current = values.reduce((sum, item) => sum + item.current, 0);
    const previous = values.reduce((sum, item) => sum + item.current - item.flow!, 0);
    return pctChange(current, previous);
  };

  const netFlow1dUsd = sumFlow(row => row.netFlow1dUsd);
  const netFlow7dUsd = sumFlow(row => row.netFlow7dUsd);
  const netFlow30dUsd = sumFlow(row => row.netFlow30dUsd);
  const change1dPct = aggregatePct(row => row.netFlow1dUsd);
  const change7dPct = aggregatePct(row => row.netFlow7dUsd);
  const change30dPct = aggregatePct(row => row.netFlow30dUsd);

  const flowScore = round(
    normalizeChangeScore(change1dPct) * 0.15 +
    normalizeChangeScore(change7dPct) * 0.35 +
    normalizeChangeScore(change30dPct) * 0.50,
    1,
  );
  const signal: StablecoinLiquidityResult['signal'] = flowScore >= 12
    ? 'expansion'
    : flowScore <= -12
      ? 'contraction'
      : 'neutral';
  const signalZh = signal === 'expansion'
    ? '稳定币流入扩张'
    : signal === 'contraction'
      ? '稳定币流出收缩'
      : '稳定币流动性中性';
  const riskBias: StablecoinLiquidityResult['riskBias'] = signal === 'expansion'
    ? 'Risk-on'
    : signal === 'contraction'
      ? 'Risk-off'
      : 'Neutral';
  const advisorBiasZh = `${signalZh}：1日 ${compactUsd(netFlow1dUsd)} / 7日 ${compactUsd(netFlow7dUsd)} / 30日 ${compactUsd(netFlow30dUsd)}。` +
    (signal === 'expansion'
      ? '场内购买力proxy偏强，顺势信号可优先，但仍要等价格确认。'
      : signal === 'contraction'
        ? '可用保证金proxy偏弱，追高要更保守，防守信号权重提高。'
        : '流动性变化未给出方向，作为风险背景观察。');

  const value: StablecoinLiquidityResult = {
    source: 'DefiLlama Stablecoins Public API',
    fetchedAt: new Date().toISOString(),
    totalCirculatingUsd: rows.reduce((sum, row) => sum + row.circulatingUsd, 0),
    netFlow1dUsd,
    netFlow7dUsd,
    netFlow30dUsd,
    change1dPct: change1dPct === null ? null : round(change1dPct, 3),
    change7dPct: change7dPct === null ? null : round(change7dPct, 3),
    change30dPct: change30dPct === null ? null : round(change30dPct, 3),
    flowScore,
    signal,
    signalZh,
    riskBias,
    advisorBiasZh,
    regimeBoost: round(clamp(flowScore * 0.10, -8, 8), 1),
    top5: rows.slice(0, 5),
  };
  cache = { ts: Date.now(), value };
  return value;
}
