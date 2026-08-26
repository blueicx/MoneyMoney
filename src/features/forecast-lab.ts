import fs from 'fs';
import path from 'path';

import { DATA_ROOT } from '../utils/paths';
import type { PredictionMarket } from './prediction-radar';

export type ForecastOutcome = 'YES' | 'NO' | 'INVALID';

export interface ForecastSnapshot {
  t: string;
  market: number;
  model: number;
  consensus?: number;
  confidence?: number;
}

export interface ForecastCase {
  key: string;
  platform: string;
  id: string;
  title: string;
  titleZh?: string;
  group?: string;
  groupZh?: string;
  endDate?: string;
  openedAt: string;
  updatedAt: string;
  snapshots: ForecastSnapshot[];
}

export interface ResolvedForecastCase extends ForecastCase {
  outcome: ForecastOutcome;
  resolvedAt: string;
  autoExpired?: boolean;
}

interface ForecastLabFile {
  version: 1;
  updatedAt: string;
  active: Record<string, ForecastCase>;
  resolved: ResolvedForecastCase[];
}

interface ForecastSample {
  key: string;
  platform: string;
  group: string;
  confidence: number;
  model: number;
  market: number;
  actual: number;
}

export interface ForecastMetricSummary {
  cases: number;
  samples: number;
  brier: number;
  logLoss: number;
  hitRatePct: number;
}

export interface ForecastCalibrationBucket {
  label: string;
  count: number;
  avgForecastPct: number;
  hitRatePct: number;
  modelBrier: number;
  marketBrier: number;
}

export interface ForecastGroupStats {
  name: string;
  cases: number;
  samples: number;
  modelBrier: number;
  marketBrier: number;
  edgePct: number;
}

export interface ForecastLabReport {
  updatedAt: string;
  activeCount: number;
  resolvedCount: number;
  evaluatedCases: number;
  evaluatedSamples: number;
  model: ForecastMetricSummary;
  market: ForecastMetricSummary;
  modelEdgePct: number;
  verdictZh: string;
  calibration: ForecastCalibrationBucket[];
  platforms: ForecastGroupStats[];
  groups: ForecastGroupStats[];
  confidenceGroups: ForecastGroupStats[];
  activeCases: Array<{
    key: string;
    platform: string;
    title: string;
    titleZh?: string;
    groupZh?: string;
    endDate?: string;
    snapshots: number;
    firstSeenAt: string;
    updatedAt: string;
    marketPct: number;
    modelPct: number;
  }>;
  resolvedCases: Array<{
    key: string;
    platform: string;
    title: string;
    titleZh?: string;
    outcome: ForecastOutcome;
    resolvedAt: string;
    snapshots: number;
    marketPct: number;
    modelPct: number;
    modelBrier: number;
    marketBrier: number;
  }>;
  noteZh: string;
}

const LAB_FILE = path.join(DATA_ROOT, 'forecast-lab.json');
const MIN_SNAPSHOT_INTERVAL_MS = 30 * 60_000;
const MAX_SNAPSHOTS = 80;
const MAX_ACTIVE_CASES = 500;
const MAX_RESOLVED_CASES = 1_000;
const AUTO_EXPIRE_MS = 45 * 86_400_000;

function clampProbability(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.min(1, Math.max(0, parsed));
}

function caseKey(market: Pick<PredictionMarket, 'platform' | 'id'>): string {
  return `${market.platform}::${market.id}`;
}

function emptyLab(): ForecastLabFile {
  return { version: 1, updatedAt: new Date().toISOString(), active: {}, resolved: [] };
}

function normalizeOutcome(value: unknown): ForecastOutcome | null {
  const text = String(value || '').trim().toUpperCase();
  return text === 'YES' || text === 'NO' || text === 'INVALID' ? text : null;
}

function loadLab(): ForecastLabFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(LAB_FILE, 'utf8')) as ForecastLabFile;
    if (parsed?.version === 1 && parsed.active && typeof parsed.active === 'object' && Array.isArray(parsed.resolved)) {
      return parsed;
    }
  } catch {
    // First launch, a fresh desktop install, or a damaged local cache.
  }
  return emptyLab();
}

async function saveLab(state: ForecastLabFile): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await fs.promises.mkdir(path.dirname(LAB_FILE), { recursive: true });
  const tempFile = `${LAB_FILE}.tmp`;
  await fs.promises.writeFile(tempFile, JSON.stringify(state), 'utf8');
  await fs.promises.rename(tempFile, LAB_FILE);
}

function metricSummary(samples: ForecastSample[], useModel: boolean): ForecastMetricSummary {
  if (!samples.length) {
    return { cases: 0, samples: 0, brier: 0, logLoss: 0, hitRatePct: 0 };
  }
  let brierSum = 0;
  let lossSum = 0;
  let hits = 0;
  for (const sample of samples) {
    const forecast = useModel ? sample.model : sample.market;
    brierSum += (forecast - sample.actual) ** 2;
    const clipped = Math.min(1 - 1e-6, Math.max(1e-6, forecast));
    lossSum -= sample.actual === 1 ? Math.log(clipped) : Math.log(1 - clipped);
    const predictedYes = forecast >= 0.5 ? 1 : 0;
    hits += predictedYes === sample.actual ? 1 : 0;
  }
  return {
    cases: new Set(samples.map(sample => sample.key)).size,
    samples: samples.length,
    brier: Number((brierSum / samples.length).toFixed(4)),
    logLoss: Number((lossSum / samples.length).toFixed(4)),
    hitRatePct: Number(((hits / samples.length) * 100).toFixed(1)),
  };
}

function groupStats(name: string, samples: ForecastSample[]): ForecastGroupStats {
  const model = metricSummary(samples, true);
  const market = metricSummary(samples, false);
  const edge = market.brier > 0 ? ((market.brier - model.brier) / market.brier) * 100 : 0;
  return {
    name,
    cases: new Set(samples.map(sample => sample.key)).size,
    samples: samples.length,
    modelBrier: model.brier,
    marketBrier: market.brier,
    edgePct: Number(edge.toFixed(1)),
  };
}

function buildReport(state: ForecastLabFile): ForecastLabReport {
  const samples: ForecastSample[] = [];
  for (const item of state.resolved) {
    const actual = item.outcome === 'YES' ? 1 : item.outcome === 'NO' ? 0 : null;
    if (actual == null) continue;
    for (const snapshot of item.snapshots) {
      samples.push({
        key: item.key,
        platform: item.platform,
        group: item.groupZh || item.group || '综合',
        confidence: Math.round(snapshot.confidence ?? 50),
        model: clampProbability(snapshot.model),
        market: clampProbability(snapshot.market),
        actual,
      });
    }
  }

  const model = metricSummary(samples, true);
  const market = metricSummary(samples, false);
  const modelEdgePct = market.brier > 0 ? ((market.brier - model.brier) / market.brier) * 100 : 0;

  const bucketLabels = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'];
  const calibration: ForecastCalibrationBucket[] = bucketLabels.map(label => ({
    label, count: 0, avgForecastPct: 0, hitRatePct: 0, modelBrier: 0, marketBrier: 0,
  }));
  for (const sample of samples) {
    const index = Math.min(4, Math.max(0, Math.floor(sample.model * 5)));
    const bucket = calibration[index];
    const modelBrier = (sample.model - sample.actual) ** 2;
    const marketBrier = (sample.market - sample.actual) ** 2;
    const nextCount = bucket.count + 1;
    bucket.avgForecastPct = ((bucket.avgForecastPct * bucket.count) + sample.model * 100) / nextCount;
    bucket.hitRatePct = ((bucket.hitRatePct * bucket.count) + sample.actual * 100) / nextCount;
    bucket.modelBrier = ((bucket.modelBrier * bucket.count) + modelBrier) / nextCount;
    bucket.marketBrier = ((bucket.marketBrier * bucket.count) + marketBrier) / nextCount;
    bucket.count = nextCount;
  }
  for (const bucket of calibration) {
    bucket.avgForecastPct = Number(bucket.avgForecastPct.toFixed(1));
    bucket.hitRatePct = Number(bucket.hitRatePct.toFixed(1));
    bucket.modelBrier = Number(bucket.modelBrier.toFixed(4));
    bucket.marketBrier = Number(bucket.marketBrier.toFixed(4));
  }

  const collectGroups = (selector: (sample: ForecastSample) => string): ForecastGroupStats[] => {
    const map = new Map<string, ForecastSample[]>();
    for (const sample of samples) {
      const name = selector(sample) || '综合';
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(sample);
    }
    return [...map.entries()].map(([name, items]) => groupStats(name, items))
      .sort((a, b) => b.samples - a.samples);
  };

  const confidenceGroups: ForecastGroupStats[] = [
    groupStats('低信心 34-55%', samples.filter(item => item.confidence < 56)),
    groupStats('中信心 56-70%', samples.filter(item => item.confidence >= 56 && item.confidence <= 70)),
    groupStats('高信心 71%+', samples.filter(item => item.confidence > 70)),
  ].filter(group => group.samples > 0);

  const latestSnapshot = (item: ForecastCase) => item.snapshots.at(-1);
  const activeCases = Object.values(state.active)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 18)
    .map(item => {
      const snapshot = latestSnapshot(item)!;
      return {
        key: item.key,
        platform: item.platform,
        title: item.title,
        titleZh: item.titleZh,
        groupZh: item.groupZh,
        endDate: item.endDate,
        snapshots: item.snapshots.length,
        firstSeenAt: item.openedAt,
        updatedAt: item.updatedAt,
        marketPct: Math.round(clampProbability(snapshot.market) * 100),
        modelPct: Math.round(clampProbability(snapshot.model) * 100),
      };
    });

  const resolvedCases = [...state.resolved]
    .sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt))
    .slice(0, 12)
    .map(item => {
      const snapshot = latestSnapshot(item)!;
      const actual = item.outcome === 'YES' ? 1 : item.outcome === 'NO' ? 0 : 0.5;
      const model = clampProbability(snapshot.model);
      const price = clampProbability(snapshot.market);
      return {
        key: item.key,
        platform: item.platform,
        title: item.title,
        titleZh: item.titleZh,
        outcome: item.outcome,
        resolvedAt: item.resolvedAt,
        snapshots: item.snapshots.length,
        marketPct: Math.round(price * 100),
        modelPct: Math.round(model * 100),
        modelBrier: Number(((model - actual) ** 2).toFixed(4)),
        marketBrier: Number(((price - actual) ** 2).toFixed(4)),
      };
    });

  let verdictZh = '样本还不够，先让雷达持续刷新；事件落地后手动标记结果，统计会越来越有参考价值。';
  if (model.samples >= 30) {
    if (modelEdgePct >= 10) verdictZh = '目前系统概率整体优于开盘市场价，但请继续积累样本，避免只看短期运气。';
    else if (modelEdgePct <= -10) verdictZh = '当前市场价整体比系统参考更准，建议把系统判断当作研究线索，不作为下单依据。';
    else verdictZh = '系统与市场价格接近，暂无明显优势；继续按平台、分类和信心分组观察。';
  }

  return {
    updatedAt: state.updatedAt,
    activeCount: Object.keys(state.active).length,
    resolvedCount: state.resolved.length,
    evaluatedCases: new Set(samples.map(sample => sample.key)).size,
    evaluatedSamples: samples.length,
    model,
    market,
    modelEdgePct: Number(modelEdgePct.toFixed(1)),
    verdictZh,
    calibration,
    platforms: collectGroups(sample => sample.platform),
    groups: collectGroups(sample => sample.group).slice(0, 10),
    confidenceGroups,
    activeCases,
    resolvedCases,
    noteZh: 'Brier 越接近 0 越准；“系统优势”为正表示模型 Brier 低于市场价。复盘样本来自同一事件的多次快照，可能存在相关性，适合看趋势而不是绝对胜率。',
  };
}

/** Capture the system's pre-event judgment after every successful radar rebuild. */
export async function recordForecastLab(markets: PredictionMarket[]): Promise<void> {
  if (!Array.isArray(markets) || !markets.length) return;
  const state = loadLab();
  const now = Date.now();
  const selected = [...markets]
    .filter(item => item?.platform && item?.id)
    .sort((a, b) => (b.activityScore || 0) - (a.activityScore || 0))
    .slice(0, MAX_ACTIVE_CASES);

  for (const market of selected) {
    const key = caseKey(market);
    const existing = state.active[key];
    const snapshot: ForecastSnapshot = {
      t: new Date(now).toISOString(),
      market: clampProbability(market.yesPrice),
      model: clampProbability(market.modelProbability),
      consensus: market.consensusProbability == null ? undefined : clampProbability(market.consensusProbability),
      confidence: Math.round(market.probabilityConfidence || 50),
    };

    if (!existing) {
      state.active[key] = {
        key,
        platform: market.platform,
        id: market.id,
        title: market.title,
        titleZh: market.titleZh,
        group: market.category,
        groupZh: market.group || market.categoryZh,
        endDate: market.endDate,
        openedAt: snapshot.t,
        updatedAt: snapshot.t,
        snapshots: [snapshot],
      };
      continue;
    }

    existing.title = market.title || existing.title;
    existing.titleZh = market.titleZh || existing.titleZh;
    existing.group = market.category || existing.group;
    existing.groupZh = market.group || market.categoryZh || existing.groupZh;
    existing.endDate = market.endDate || existing.endDate;
    existing.updatedAt = snapshot.t;
    const last = existing.snapshots.at(-1);
    if (!last || now - new Date(last.t).getTime() >= MIN_SNAPSHOT_INTERVAL_MS) {
      existing.snapshots.push(snapshot);
      if (existing.snapshots.length > MAX_SNAPSHOTS) {
        existing.snapshots.splice(0, existing.snapshots.length - MAX_SNAPSHOTS);
      }
    } else {
      Object.assign(last, snapshot);
    }
  }

  // Unresolved stale events are kept as invalid research samples instead of
  // growing the active table forever.
  for (const [key, item] of Object.entries(state.active)) {
    const endTime = item.endDate ? new Date(item.endDate).getTime() : NaN;
    const staleAfter = Number.isFinite(endTime) ? endTime + AUTO_EXPIRE_MS : new Date(item.updatedAt).getTime() + AUTO_EXPIRE_MS;
    if (now > staleAfter) {
      state.resolved.push({ ...item, outcome: 'INVALID', resolvedAt: new Date(now).toISOString(), autoExpired: true });
      delete state.active[key];
    }
  }

  if (state.resolved.length > MAX_RESOLVED_CASES) {
    state.resolved.sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt));
    state.resolved.splice(MAX_RESOLVED_CASES);
  }

  await saveLab(state);
}

export function getForecastLabReport(): ForecastLabReport {
  return buildReport(loadLab());
}

export function resolveForecastCase(key: string, outcome: unknown): ForecastLabReport | null {
  const normalizedKey = String(key || '').trim();
  const normalizedOutcome = normalizeOutcome(outcome);
  if (!normalizedKey || !normalizedOutcome) return null;
  const state = loadLab();
  const item = state.active[normalizedKey];
  if (!item) return null;
  delete state.active[normalizedKey];
  state.resolved.push({
    ...item,
    outcome: normalizedOutcome,
    resolvedAt: new Date().toISOString(),
  });
  if (state.resolved.length > MAX_RESOLVED_CASES) {
    state.resolved.sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt));
    state.resolved.splice(MAX_RESOLVED_CASES);
  }
  void saveLab(state);
  return buildReport(state);
}
