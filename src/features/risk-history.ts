import fs from 'fs';
import path from 'path';
import { pushNotification } from './notifications';
import type { PortfolioRiskOverview } from './risk-overview';

export type RiskLevel = PortfolioRiskOverview['riskLevelZh'];

export interface RiskHistorySnapshot {
  t: string;
  level: RiskLevel;
  riskScore: number;
  openCount: number;
  exposureUsd: number;
  concentrationPct: number;
  marketRiskScore: number | null;
  highRiskFlags: number;
  expiringSoonCount: number;
  themeClusterCount: number;
  var95Usd: number;
}

export interface RiskHistoryTrend {
  direction: 'improving' | 'worsening' | 'stable' | 'insufficient';
  deltaRiskScore: number;
  hours: number;
  concentrationDeltaPct: number;
  exposureDeltaUsd: number;
  highRiskDelta: number;
  expiringDelta: number;
  headlineZh: string;
  detailZh: string;
}

export interface RiskHistoryReport {
  updatedAt: string;
  points: RiskHistorySnapshot[];
  trend: RiskHistoryTrend;
}

interface RiskHistoryFile {
  version: 1;
  updatedAt: string;
  points: RiskHistorySnapshot[];
}

const HISTORY_FILE = path.join(process.cwd(), 'data', 'risk-history.json');
const MAX_POINTS = 240;
const MAX_AGE_MS = 30 * 86_400_000;
const MIN_APPEND_INTERVAL_MS = 2 * 60_000;
const TREND_WINDOW_MS = 24 * 60 * 60_000;

const LEVEL_SCORE: Record<RiskLevel, number> = {
  稳健: 0,
  观察: 1,
  偏高: 2,
  危险: 3,
};

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function loadHistory(): RiskHistoryFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) as RiskHistoryFile;
    if (parsed?.version === 1 && Array.isArray(parsed.points)) {
      return {
        version: 1,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        points: parsed.points.filter(point => point && typeof point.t === 'string' && LEVEL_SCORE[point.level] != null),
      };
    }
  } catch {
    // First launch, a fresh desktop install, or a damaged local cache.
  }
  return { version: 1, updatedAt: new Date().toISOString(), points: [] };
}

function toSnapshot(overview: PortfolioRiskOverview): RiskHistorySnapshot {
  return {
    t: overview.updatedAt || new Date().toISOString(),
    level: overview.riskLevelZh,
    riskScore: LEVEL_SCORE[overview.riskLevelZh] ?? 1,
    openCount: Number(overview.openCount || 0),
    exposureUsd: Number(overview.simulatedExposureUsd || 0),
    concentrationPct: Number(overview.concentrationPct || 0),
    marketRiskScore: overview.marketRiskScore == null ? null : Number(overview.marketRiskScore),
    highRiskFlags: Number(overview.highRiskFlags || 0),
    expiringSoonCount: Number(overview.expiringSoonCount || 0),
    themeClusterCount: Number(overview.themeClusters?.length || 0),
    var95Usd: Number(overview.var95Usd || 0),
  };
}

export function buildRiskHistoryInsight(input: RiskHistorySnapshot[]): RiskHistoryTrend {
  const points = [...(input || [])]
    .filter(point => point && Number.isFinite(new Date(point.t).getTime()) && LEVEL_SCORE[point.level] != null)
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
  if (points.length < 2) {
    return {
      direction: 'insufficient',
      deltaRiskScore: 0,
      hours: 0,
      concentrationDeltaPct: 0,
      exposureDeltaUsd: 0,
      highRiskDelta: 0,
      expiringDelta: 0,
      headlineZh: '趋势样本还在积累',
      detailZh: '再打开一两次风险页后，这里会显示 24 小时变化和恶化提醒。',
    };
  }

  const current = points.at(-1)!;
  const now = new Date(current.t).getTime();
  const windowPoints = points.filter(point => now - new Date(point.t).getTime() <= TREND_WINDOW_MS);
  const baseline = (windowPoints.length >= 2 ? windowPoints[0] : points.at(-2)!);
  const hours = Math.max(0, round((now - new Date(baseline.t).getTime()) / 3_600_000));
  const deltaRiskScore = current.riskScore - baseline.riskScore;
  const concentrationDeltaPct = round(current.concentrationPct - baseline.concentrationPct);
  const exposureDeltaUsd = round(current.exposureUsd - baseline.exposureUsd, 2);
  const highRiskDelta = current.highRiskFlags - baseline.highRiskFlags;
  const expiringDelta = current.expiringSoonCount - baseline.expiringSoonCount;
  const direction: RiskHistoryTrend['direction'] = deltaRiskScore > 0 ? 'worsening'
    : deltaRiskScore < 0 ? 'improving' : 'stable';
  const headlineZh = direction === 'worsening'
    ? `近 ${hours} 小时风险由「${baseline.level}」升至「${current.level}」`
    : direction === 'improving'
      ? `近 ${hours} 小时风险由「${baseline.level}」降至「${current.level}」`
      : `近 ${hours} 小时风险等级保持在「${current.level}」`;
  const details: string[] = [`集中度 ${concentrationDeltaPct >= 0 ? '+' : ''}${concentrationDeltaPct} 点`];
  details.push(`敞口 ${exposureDeltaUsd >= 0 ? '+' : '-'}$${round(Math.abs(exposureDeltaUsd), 2)}`);
  details.push(`高风险提醒 ${highRiskDelta >= 0 ? '+' : ''}${highRiskDelta}`);
  details.push(`临近截止 ${expiringDelta >= 0 ? '+' : ''}${expiringDelta}`);
  const detailZh = direction === 'worsening'
    ? `${details.join(' · ')}。恶化时优先减少新仓，而不是寻找补仓理由。`
    : `${details.join(' · ')}。`;

  return {
    direction,
    deltaRiskScore,
    hours,
    concentrationDeltaPct,
    exposureDeltaUsd,
    highRiskDelta,
    expiringDelta,
    headlineZh,
    detailZh,
  };
}

export async function recordRiskHistory(overview: PortfolioRiskOverview): Promise<void> {
  const snapshot = toSnapshot(overview);
  if (!Number.isFinite(new Date(snapshot.t).getTime())) return;
  const state = loadHistory();
  const last = state.points.at(-1);
  const now = new Date(snapshot.t).getTime();

  if (last && now - new Date(last.t).getTime() < MIN_APPEND_INTERVAL_MS) {
    state.points[state.points.length - 1] = snapshot;
  } else {
    const previousScore = last?.riskScore ?? snapshot.riskScore;
    state.points.push(snapshot);
    if (snapshot.riskScore > previousScore) {
      pushNotification(
        'risk',
        `🛡 风险等级上升：${last?.level || '—'} → ${snapshot.level}。建议先检查集中度、高风险提醒和临近结算仓位。`,
      );
    }
  }

  const cutoff = Date.now() - MAX_AGE_MS;
  state.points = state.points.filter(point => new Date(point.t).getTime() >= cutoff).slice(-MAX_POINTS);
  state.updatedAt = new Date().toISOString();
  await fs.promises.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  await fs.promises.writeFile(HISTORY_FILE, JSON.stringify(state), 'utf8');
}

export function getRiskHistory(limit = 72): RiskHistoryReport {
  const state = loadHistory();
  const points = state.points.slice(-Math.max(1, Math.min(240, limit)));
  return {
    updatedAt: state.updatedAt,
    points,
    trend: buildRiskHistoryInsight(points),
  };
}
