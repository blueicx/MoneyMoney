export interface BitcoinOnchainMetric {
  key: 'activeAddresses' | 'txVolumeUsd' | 'hashRate' | 'minerRevenue' | 'marketCap';
  labelZh: string;
  value: number;
  displayZh: string;
  change7dPct: number | null;
  change30dPct: number | null;
  percentile52w: number;
}

export interface BitcoinOnchainResult {
  generatedAt: string;
  asOfAt: string;
  source: string;
  signal: 'healthy' | 'neutral' | 'cooling';
  signalZh: string;
  summaryZh: string;
  advisorBiasZh: string;
  regimeBoost: number;
  nvtRatio: number;
  nvtPercentile52w: number;
  activityScore: number;
  securityScore: number;
  metrics: BitcoinOnchainMetric[];
}

interface ChartPoint {
  x: number;
  y: number;
}

interface BlockchainChart {
  name?: string;
  unit?: string;
  values?: Array<{ x?: number | string; y?: number | string }>;
}

const BASE = 'https://api.blockchain.info/charts';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' };
const CACHE_TTL_MS = 30 * 60_000;
let cache: { ts: number; value: BitcoinOnchainResult } | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Number.isFinite(value) ? Math.round(value * factor) / factor : 0;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getChart(chart: string): Promise<ChartPoint[]> {
  const url = `${BASE}/${chart}?timespan=52weeks&format=json&sampleCount=365`;
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Blockchain.com ${chart} HTTP ${response.status}`);
  const payload = await response.json() as BlockchainChart;
  return (payload.values || [])
    .map(item => ({ x: num(item.x) * 1000, y: num(item.y) }))
    .filter(item => item.x > 0 && Number.isFinite(item.y))
    .sort((a, b) => a.x - b.x);
}

function percentile(values: number[], current: number): number {
  if (!values.length || !Number.isFinite(current)) return 50;
  const belowOrEqual = values.filter(value => value <= current).length;
  return clamp((belowOrEqual / values.length) * 100, 0, 100);
}

function previousByAge(points: ChartPoint[], ageDays: number): ChartPoint | null {
  if (!points.length) return null;
  const cutoff = points[points.length - 1].x - ageDays * 86_400_000;
  let candidate: ChartPoint | null = null;
  for (const point of points) {
    if (point.x <= cutoff) candidate = point;
    else break;
  }
  return candidate || points[0];
}

function changePct(points: ChartPoint[], ageDays: number): number | null {
  const latest = points[points.length - 1];
  const previous = previousByAge(points, ageDays);
  if (!previous || !previous.y || !latest) return null;
  return ((latest.y - previous.y) / Math.abs(previous.y)) * 100;
}

function compactUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function metric(
  key: BitcoinOnchainMetric['key'],
  labelZh: string,
  points: ChartPoint[],
  formatter: (value: number) => string,
): BitcoinOnchainMetric {
  const latest = points[points.length - 1];
  const values = points.map(point => point.y);
  return {
    key,
    labelZh,
    value: latest.y,
    displayZh: formatter(latest.y),
    change7dPct: changePct(points, 7) === null ? null : round(changePct(points, 7)!, 2),
    change30dPct: changePct(points, 30) === null ? null : round(changePct(points, 30)!, 2),
    percentile52w: round(percentile(values, latest.y), 1),
  };
}

export async function getBitcoinOnchainRadar(): Promise<BitcoinOnchainResult> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const [addressPoints, volumePoints, hashPoints, revenuePoints, capPoints] = await Promise.all([
    getChart('n-unique-addresses'),
    getChart('estimated-transaction-volume-usd'),
    getChart('hash-rate'),
    getChart('miners-revenue'),
    getChart('market-cap'),
  ]);

  if (addressPoints.length < 30 || volumePoints.length < 30 || hashPoints.length < 30 || capPoints.length < 30) {
    throw new Error('链上指标历史数据不足');
  }

  const metrics: BitcoinOnchainMetric[] = [
    metric('activeAddresses', '活跃地址', addressPoints, value => `${Math.round(value).toLocaleString('en-US')}`),
    metric('txVolumeUsd', '链上结算额', volumePoints, compactUsd),
    metric('hashRate', '全网算力', hashPoints, value =>
      value >= 1_000_000 ? `${round(value / 1_000_000, 2)} EH/s` : `${round(value / 1_000, 1)} PH/s`),
    metric('minerRevenue', '矿工收入', revenuePoints.length ? revenuePoints : [{ x: Date.now(), y: 0 }], compactUsd),
    metric('marketCap', 'BTC市值', capPoints, compactUsd),
  ];

  const addressRow = metrics[0];
  const volumeRow = metrics[1];
  const hashRow = metrics[2];
  const capRow = metrics[4];
  const activityScore = round((addressRow.percentile52w + volumeRow.percentile52w) / 2, 1);
  const securityScore = round(hashRow.percentile52w, 1);

  // Build a like-for-like NVT history only where both series share the same day.
  const volumeByDay = new Map(volumePoints.map(point => [point.x, point.y]));
  const nvtHistory = capPoints
    .filter(point => volumeByDay.has(point.x))
    .map(point => ({ x: point.x, ratio: point.y / Math.max(volumeByDay.get(point.x)!, 1) }))
    .filter(item => Number.isFinite(item.ratio));
  const currentVolume = volumeRow.value;
  const nvtRatio = capRow.value / Math.max(currentVolume, 1);
  const nvtPercentile = nvtHistory.length >= 30
    ? percentile(nvtHistory.map(item => item.ratio), nvtRatio)
    : 50;

  // Usage + security are supportive; a high NVT percentile means price is ahead
  // of on-chain settlement. The final boost remains deliberately bounded.
  const rawScore = activityScore * 0.45 + securityScore * 0.35 + (100 - nvtPercentile) * 0.20 - 50;
  const regimeBoost = round(clamp(rawScore * 0.12, -5, 5), 2);
  const signal: BitcoinOnchainResult['signal'] = rawScore >= 12
    ? 'healthy'
    : rawScore <= -12
      ? 'cooling'
      : 'neutral';
  const signalZh = signal === 'healthy'
    ? '链上使用偏健康'
    : signal === 'cooling'
      ? '链上使用转弱'
      : '链上活动中性';
  const advisorBiasZh = signal === 'healthy'
    ? '链上使用与安全背景偏支持，但仍需价格结构确认，不单独加仓。'
    : signal === 'cooling'
      ? '链上参与度落后于价格，降低追多优先级，等真实需求回升。'
      : '链上活动没有给出额外方向，按技术面和风险规则执行。';
  const summaryZh =
    `地址活跃度处于52周第 ${addressRow.percentile52w}% 分位，链上结算额第 ${volumeRow.percentile52w}% 分位，` +
    `算力第 ${hashRow.percentile52w}% 分位；NVT 第 ${round(nvtPercentile, 1)}% 分位。`;

  const value: BitcoinOnchainResult = {
    generatedAt: new Date().toISOString(),
    asOfAt: new Date(capRow.value ? capPoints[capPoints.length - 1].x : Date.now()).toISOString(),
    source: 'Blockchain.com Public Charts',
    signal,
    signalZh,
    summaryZh,
    advisorBiasZh,
    regimeBoost,
    nvtRatio: round(nvtRatio, 1),
    nvtPercentile52w: round(nvtPercentile, 1),
    activityScore,
    securityScore,
    metrics,
  };
  cache = { ts: Date.now(), value };
  return value;
}
