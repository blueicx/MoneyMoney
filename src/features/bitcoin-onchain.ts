export type BitcoinOnchainChart =
  | 'n-unique-addresses'
  | 'estimated-transaction-volume-usd'
  | 'hash-rate'
  | 'miners-revenue'
  | 'market-cap';

export type BitcoinOnchainDataStatus = 'historical' | 'partial' | 'empty' | 'unavailable';

export interface BitcoinOnchainMetric {
  key: 'activeAddresses' | 'txVolumeUsd' | 'hashRate' | 'minerRevenue' | 'marketCap';
  labelZh: string;
  value: number;
  displayZh: string;
  change7dPct: number | null;
  change30dPct: number | null;
  percentile52w: number;
  sourceUpdatedAt: string;
  sampleCount: number;
}

export interface BitcoinOnchainSeriesStatus {
  chart: BitcoinOnchainChart;
  labelZh: string;
  dataStatus: BitcoinOnchainDataStatus;
  sourceUpdatedAt: string | null;
  retrievedAt: string;
  sampleCount: number;
  invalidCount: number;
  reason: string | null;
  url: string;
}

export interface BitcoinOnchainChartInput {
  points: Array<{ x: number; y: number }>;
  invalidCount?: number;
  error?: string | null;
}

export interface BitcoinOnchainResult {
  market: 'crypto';
  instrument: 'BTC';
  dataStatus: BitcoinOnchainDataStatus;
  reason: string | null;
  generatedAt: string;
  retrievedAt: string;
  sourceUpdatedAt: string | null;
  asOfAt: string | null;
  source: string;
  evidenceRefs: string[];
  seriesStatus: BitcoinOnchainSeriesStatus[];
  signal: 'healthy' | 'neutral' | 'cooling' | 'unavailable';
  signalZh: string;
  summaryZh: string;
  advisorBiasZh: string;
  regimeBoost: number | null;
  nvtRatio: number | null;
  nvtPercentile52w: number | null;
  activityScore: number | null;
  securityScore: number | null;
  metrics: BitcoinOnchainMetric[];
}

interface ChartPoint {
  x: number;
  y: number;
}

interface BlockchainChart {
  values?: Array<{ x?: number | string; y?: number | string | null }>;
}

export interface BitcoinOnchainDependencies {
  fetchChart?: (chart: BitcoinOnchainChart) => Promise<ChartPoint[] | BitcoinOnchainChartInput>;
  now?: () => Date;
}

const BASE = 'https://api.blockchain.info/charts';
const SOURCE = 'Blockchain.com Public Charts';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' };
const CACHE_TTL_MS = 30 * 60_000;
const MIN_HISTORY_POINTS = 30;
const CHART_NAMES: BitcoinOnchainChart[] = [
  'n-unique-addresses',
  'estimated-transaction-volume-usd',
  'hash-rate',
  'miners-revenue',
  'market-cap',
];
const CORE_CHARTS: BitcoinOnchainChart[] = [
  'n-unique-addresses',
  'estimated-transaction-volume-usd',
  'hash-rate',
  'market-cap',
];
const CHART_LABELS: Record<BitcoinOnchainChart, string> = {
  'n-unique-addresses': '活跃地址',
  'estimated-transaction-volume-usd': '链上结算额',
  'hash-rate': '全网算力',
  'miners-revenue': '矿工收入',
  'market-cap': 'BTC市值',
};
const CHART_URLS: Record<BitcoinOnchainChart, string> = Object.fromEntries(
  CHART_NAMES.map(chart => [chart, `${BASE}/${chart}?timespan=52weeks&format=json&sampleCount=365`]),
) as Record<BitcoinOnchainChart, string>;
let cache: { ts: number; value: BitcoinOnchainResult } | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Number.isFinite(value) ? Math.round(value * factor) / factor : 0;
}

function finiteNumber(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseBlockchainChartPoints(values: unknown): { points: ChartPoint[]; invalidCount: number } {
  if (!Array.isArray(values)) return { points: [], invalidCount: 0 };
  let invalidCount = 0;
  const points = values.flatMap((item: any) => {
    const seconds = finiteNumber(item?.x);
    const y = finiteNumber(item?.y);
    if (seconds === null || seconds <= 0 || y === null) {
      invalidCount += 1;
      return [];
    }
    const x = seconds * 1000;
    if (!Number.isFinite(x)) {
      invalidCount += 1;
      return [];
    }
    return [{ x, y }];
  }).sort((a, b) => a.x - b.x);
  return { points, invalidCount };
}

export function normalizeBlockchainChartPoints(values: unknown): ChartPoint[] {
  return parseBlockchainChartPoints(values).points;
}

function cleanPoints(points: unknown): ChartPoint[] {
  if (!Array.isArray(points)) return [];
  return points.flatMap((point: any) => {
    const x = finiteNumber(point?.x);
    const y = finiteNumber(point?.y);
    return x !== null && x > 0 && y !== null ? [{ x, y }] : [];
  }).sort((a, b) => a.x - b.x);
}

async function getChart(chart: BitcoinOnchainChart): Promise<BitcoinOnchainChartInput> {
  const response = await fetch(CHART_URLS[chart], { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${SOURCE} ${chart} HTTP ${response.status}`);
  const payload = await response.json() as BlockchainChart;
  if (!Array.isArray(payload.values)) throw new Error(`${SOURCE} ${chart} 响应缺少有效 values 数组`);
  return parseBlockchainChartPoints(payload.values);
}

function percentile(values: number[], current: number): number | null {
  if (!values.length || !Number.isFinite(current)) return null;
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
  const change7d = changePct(points, 7);
  const change30d = changePct(points, 30);
  const percentile52w = percentile(values, latest.y);
  if (percentile52w === null) throw new Error(`${labelZh}没有可计算的历史分位`);
  return {
    key,
    labelZh,
    value: latest.y,
    displayZh: formatter(latest.y),
    change7dPct: change7d === null ? null : round(change7d, 2),
    change30dPct: change30d === null ? null : round(change30d, 2),
    percentile52w: round(percentile52w, 1),
    sourceUpdatedAt: new Date(latest.x).toISOString(),
    sampleCount: points.length,
  };
}

function sourceStatus(chart: BitcoinOnchainChart, input: BitcoinOnchainChartInput, retrievedAt: string): BitcoinOnchainSeriesStatus {
  const points = cleanPoints(input.points);
  const latest = points[points.length - 1];
  const error = typeof input.error === 'string' ? input.error.trim().slice(0, 240) : '';
  const invalidCount = Number.isInteger(input.invalidCount) && Number(input.invalidCount) > 0 ? Number(input.invalidCount) : 0;
  const dataStatus: BitcoinOnchainDataStatus = error
    ? 'unavailable'
    : invalidCount > 0
      ? 'partial'
    : !points.length
      ? 'empty'
      : points.length < MIN_HISTORY_POINTS
        ? 'partial'
        : 'historical';
  const reason = error || (invalidCount > 0
    ? `${invalidCount}条记录的时间或数值字段无效，已丢弃`
    : dataStatus === 'empty'
    ? '来源成功响应，但未返回记录'
    : dataStatus === 'partial'
      ? `有效历史不足${MIN_HISTORY_POINTS}个样本，当前${points.length}个`
      : null);
  return {
    chart,
    labelZh: CHART_LABELS[chart],
    dataStatus,
    sourceUpdatedAt: latest ? new Date(latest.x).toISOString() : null,
    retrievedAt,
    sampleCount: points.length,
    invalidCount,
    reason,
    url: CHART_URLS[chart],
  };
}

function latestCommonTimestamp(series: ChartPoint[][]): number | null {
  if (!series.length || series.some(points => !points.length)) return null;
  const otherTimes = series.slice(1).map(points => new Set(points.map(point => point.x)));
  for (let index = series[0].length - 1; index >= 0; index -= 1) {
    const timestamp = series[0][index].x;
    if (otherTimes.every(times => times.has(timestamp))) return timestamp;
  }
  return null;
}

export function buildBitcoinOnchainRadar(
  chartInputs: Record<BitcoinOnchainChart, BitcoinOnchainChartInput>,
  retrievedAt: string,
): BitcoinOnchainResult {
  const retrievedMs = Date.parse(retrievedAt);
  if (!Number.isFinite(retrievedMs)) throw new Error('retrievedAt 必须是有效时间');
  const normalizedRetrievedAt = new Date(retrievedMs).toISOString();
  const normalizedInputs = Object.fromEntries(CHART_NAMES.map(chart => {
    const input = chartInputs[chart] || { points: [] };
    const parsedPoints = cleanPoints(input.points);
    const positiveOnly = chart === 'hash-rate' || chart === 'market-cap';
    const invalidDomainPoints = parsedPoints.filter(point => positiveOnly ? point.y <= 0 : point.y < 0).length;
    const points = parsedPoints.filter(point => positiveOnly ? point.y > 0 : point.y >= 0);
    const invalidCount = (Number.isInteger(input.invalidCount) && Number(input.invalidCount) > 0 ? Number(input.invalidCount) : 0) + invalidDomainPoints;
    return [chart, { ...input, points, invalidCount }];
  })) as Record<BitcoinOnchainChart, BitcoinOnchainChartInput>;
  const cleanByChart = Object.fromEntries(CHART_NAMES.map(chart => [chart, normalizedInputs[chart].points])) as Record<BitcoinOnchainChart, ChartPoint[]>;
  const statuses = CHART_NAMES.map(chart => sourceStatus(chart, normalizedInputs[chart], normalizedRetrievedAt));
  const statusByChart = new Map(statuses.map(status => [status.chart, status]));
  const coreAvailable = CORE_CHARTS.every(chart => statusByChart.get(chart)?.dataStatus === 'historical');
  const commonTimestamp = coreAvailable
    ? latestCommonTimestamp(CORE_CHARTS.map(chart => cleanByChart[chart]))
    : null;
  const metrics: BitcoinOnchainMetric[] = [];
  const definitions: Array<{
    chart: BitcoinOnchainChart;
    key: BitcoinOnchainMetric['key'];
    label: string;
    format: (value: number) => string;
  }> = [
    { chart: 'n-unique-addresses', key: 'activeAddresses', label: '活跃地址', format: value => Math.round(value).toLocaleString('en-US') },
    { chart: 'estimated-transaction-volume-usd', key: 'txVolumeUsd', label: '链上结算额', format: compactUsd },
    { chart: 'hash-rate', key: 'hashRate', label: '全网算力', format: value => value >= 1_000_000 ? `${round(value / 1_000_000, 2)} EH/s` : `${round(value / 1_000, 1)} PH/s` },
    { chart: 'miners-revenue', key: 'minerRevenue', label: '矿工收入', format: compactUsd },
    { chart: 'market-cap', key: 'marketCap', label: 'BTC市值', format: compactUsd },
  ];

  for (const definition of definitions) {
    const status = statusByChart.get(definition.chart)!;
    if (status.dataStatus !== 'historical') continue;
    let points = cleanByChart[definition.chart];
    if (commonTimestamp !== null) {
      points = points.filter(point => point.x <= commonTimestamp);
      if (points[points.length - 1]?.x !== commonTimestamp) {
        status.dataStatus = 'partial';
        status.reason = '截至共同样本日没有同日记录；为避免跨日拼接，该指标未纳入本次比较';
        continue;
      }
    }
    if (points.length < MIN_HISTORY_POINTS) {
      status.dataStatus = 'partial';
      status.reason = `共同样本时点之前有效历史不足${MIN_HISTORY_POINTS}个样本，当前${points.length}个`;
      continue;
    }
    metrics.push(metric(definition.key, definition.label, points, definition.format));
  }

  const metricByKey = new Map(metrics.map(row => [row.key, row]));
  const addressRow = metricByKey.get('activeAddresses');
  const volumeRow = metricByKey.get('txVolumeUsd');
  const hashRow = metricByKey.get('hashRate');
  const capRow = metricByKey.get('marketCap');
  const activityScore = addressRow && volumeRow
    ? round((addressRow.percentile52w + volumeRow.percentile52w) / 2, 1)
    : null;
  const securityScore = hashRow ? hashRow.percentile52w : null;

  let nvtRatio: number | null = null;
  let nvtPercentile52w: number | null = null;
  let nvtHistoryCount = 0;
  if (commonTimestamp !== null && capRow && volumeRow) {
    const volumeByTime = new Map(cleanByChart['estimated-transaction-volume-usd']
      .filter(point => point.x <= commonTimestamp)
      .map(point => [point.x, point.y]));
    const nvtHistory = cleanByChart['market-cap']
      .filter(point => point.x <= commonTimestamp && point.y > 0 && (volumeByTime.get(point.x) || 0) > 0)
      .map(point => ({ x: point.x, ratio: point.y / volumeByTime.get(point.x)! }))
      .filter(item => Number.isFinite(item.ratio));
    nvtHistoryCount = nvtHistory.length;
    nvtRatio = volumeRow.value > 0 && capRow.value > 0 ? round(capRow.value / volumeRow.value, 1) : null;
    if (nvtHistory.length >= MIN_HISTORY_POINTS && nvtRatio !== null) {
      const value = percentile(nvtHistory.map(item => item.ratio), nvtRatio);
      nvtPercentile52w = value === null ? null : round(value, 1);
    }
  }

  const signalReady = commonTimestamp !== null
    && Boolean(addressRow && volumeRow && hashRow && capRow)
    && activityScore !== null
    && securityScore !== null
    && nvtRatio !== null
    && nvtPercentile52w !== null;
  let regimeBoost: number | null = null;
  let signal: BitcoinOnchainResult['signal'] = 'unavailable';
  let signalZh = '链上综合判断不可用';
  let advisorBiasZh = '关键来源、同日样本或历史长度不足，暂不输出综合方向判断。';
  if (signalReady) {
    const rawScore = activityScore! * 0.45 + securityScore! * 0.35 + (100 - nvtPercentile52w!) * 0.20 - 50;
    regimeBoost = round(clamp(rawScore * 0.12, -5, 5), 2);
    signal = rawScore >= 12 ? 'healthy' : rawScore <= -12 ? 'cooling' : 'neutral';
    signalZh = signal === 'healthy' ? '链上使用偏健康' : signal === 'cooling' ? '链上使用转弱' : '链上活动中性';
    advisorBiasZh = signal === 'healthy'
      ? '链上使用与安全背景偏支持，但仍需价格结构确认，不单独加仓。'
      : signal === 'cooling'
        ? '链上参与度落后于价格，降低追多优先级，等真实需求回升。'
        : '链上活动没有给出额外方向，按技术面和风险规则执行。';
  }

  const reasons = statuses
    .filter(status => status.dataStatus !== 'historical')
    .map(status => `${status.labelZh}：${status.reason || status.dataStatus}`);
  if (coreAvailable && commonTimestamp === null) reasons.push('核心序列没有可核验的共同样本日，未生成综合判断');
  else if (commonTimestamp !== null && nvtHistoryCount < MIN_HISTORY_POINTS) reasons.push(`NVT同日历史只有${nvtHistoryCount}个有效样本，未生成综合判断`);
  if (!signalReady && !reasons.length) reasons.push('综合判断所需核心字段或同日历史不足，未生成方向结论');

  const allAvailable = statuses.every(status => status.dataStatus === 'historical')
    && signalReady
    && metrics.length === CHART_NAMES.length;
  const noRecords = metrics.length === 0 && statuses.every(status => status.dataStatus === 'empty');
  const hasAnySourceData = statuses.some(status => status.sampleCount > 0 || status.invalidCount > 0);
  const dataStatus: BitcoinOnchainDataStatus = allAvailable
    ? 'historical'
    : noRecords
      ? 'empty'
      : metrics.length || hasAnySourceData
        ? 'partial'
        : 'unavailable';
  const metricSummary = metrics.length
    ? `当前保留 ${metrics.length}/${CHART_NAMES.length} 项具备足够真实历史的指标。`
    : '当前没有达到最小历史样本要求的链上指标。';
  const summaryZh = signalReady
    ? `地址活跃度处于52周第 ${addressRow!.percentile52w}% 分位，链上结算额第 ${volumeRow!.percentile52w}% 分位，算力第 ${hashRow!.percentile52w}% 分位；NVT 第 ${nvtPercentile52w}% 分位。`
    : `${metricSummary}关键序列缺失、样本不足或时点未对齐，因此没有生成综合方向与环境加分。`;
  const sourceUpdatedAt = commonTimestamp === null ? null : new Date(commonTimestamp).toISOString();

  return {
    market: 'crypto',
    instrument: 'BTC',
    dataStatus,
    reason: reasons.length ? reasons.join('；') : null,
    generatedAt: normalizedRetrievedAt,
    retrievedAt: normalizedRetrievedAt,
    sourceUpdatedAt,
    asOfAt: sourceUpdatedAt,
    source: SOURCE,
    evidenceRefs: statuses.map(status => status.url),
    seriesStatus: statuses,
    signal,
    signalZh,
    summaryZh,
    advisorBiasZh,
    regimeBoost,
    nvtRatio,
    nvtPercentile52w,
    activityScore,
    securityScore,
    metrics,
  };
}

export async function getBitcoinOnchainRadar(dependencies: BitcoinOnchainDependencies = {}): Promise<BitcoinOnchainResult> {
  const injected = Boolean(dependencies.fetchChart || dependencies.now);
  if (!injected && cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;
  const retrievedAt = (dependencies.now ? dependencies.now() : new Date()).toISOString();
  const fetchChart = dependencies.fetchChart || getChart;
  const entries = await Promise.all(CHART_NAMES.map(async chart => {
    try {
      const fetched = await fetchChart(chart);
      if (Array.isArray(fetched)) return [chart, { points: cleanPoints(fetched) }] as const;
      return [chart, { ...fetched, points: cleanPoints(fetched.points) }] as const;
    } catch (error) {
      return [chart, { points: [], error: error instanceof Error ? error.message : '来源请求失败' }] as const;
    }
  }));
  const result = buildBitcoinOnchainRadar(Object.fromEntries(entries) as Record<BitcoinOnchainChart, BitcoinOnchainChartInput>, retrievedAt);
  if (!injected) cache = { ts: Date.now(), value: result };
  return result;
}
