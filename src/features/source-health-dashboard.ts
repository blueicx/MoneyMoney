import { createHash } from 'node:crypto';

/**
 * Long-window source health aggregation. It consumes observations recorded by
 * existing health checks and never fabricates a sample count. Sources with too
 * few observations are reported as unknown.
 */

export interface SourceHealthObservation {
  sourceId: string;
  sourceName: string;
  market: string;
  at: string;
  ok: boolean;
  latencyMs: number | null;
  reason: string | null;
}

export interface SourceHealthSummary {
  sourceId: string;
  sourceName: string;
  market: string;
  status: 'live' | 'degraded' | 'unavailable' | 'unknown';
  samples: number;
  successRate: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  lastOkAt: string | null;
  lastFailureAt: string | null;
  failureReasons: Array<{ reason: string; count: number }>;
}

export interface SourceHealthDashboard {
  generatedAt: string;
  windowFrom: string;
  windowTo: string;
  minSamples: number;
  thresholds: { successRate: number; latencyP95Ms: number };
  sources: SourceHealthSummary[];
  unknownSources: number;
  contentHash: string;
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function buildSourceHealthDashboard(input: {
  observations: readonly SourceHealthObservation[];
  windowMs?: number;
  minSamples?: number;
  successRateThreshold?: number;
  latencyP95ThresholdMs?: number;
  now?: number;
}): SourceHealthDashboard {
  if (!input || !Array.isArray(input.observations)) throw new Error('健康观测必须是数组');
  const windowMs = input.windowMs ?? 7 * 86_400_000;
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('健康窗口无效');
  const minSamples = input.minSamples ?? 3;
  if (!Number.isSafeInteger(minSamples) || minSamples < 1 || minSamples > 10000) throw new Error('最小样本必须是正整数');
  const successRateThreshold = input.successRateThreshold ?? 0.98;
  if (!Number.isFinite(successRateThreshold) || successRateThreshold <= 0 || successRateThreshold > 1) throw new Error('成功率门槛必须在 (0,1] 区间');
  const latencyP95ThresholdMs = input.latencyP95ThresholdMs ?? 5000;
  if (!Number.isFinite(latencyP95ThresholdMs) || latencyP95ThresholdMs <= 0) throw new Error('延迟门槛必须为正数');
  const now = input.now ?? Date.now();
  const from = now - windowMs;
  const groups = new Map<string, SourceHealthObservation[]>();
  input.observations.forEach(observation => {
    if (!observation || typeof observation !== 'object') throw new Error('健康观测必须是对象');
    if (typeof observation.sourceId !== 'string' || !observation.sourceId.trim()) throw new Error('健康观测来源无效');
    const at = Date.parse(observation.at);
    if (!Number.isFinite(at)) throw new Error('健康观测时间无效');
    if (at < from || at > now + 1000) return;
    const list = groups.get(observation.sourceId) ?? [];
    list.push(observation);
    groups.set(observation.sourceId, list);
  });
  const sources: SourceHealthSummary[] = [...groups.entries()].map(([sourceId, rows]) => {
    const sortedByTime = rows.slice().sort((a, b) => a.at.localeCompare(b.at));
    const successful = sortedByTime.filter(row => row.ok);
    const failures = sortedByTime.filter(row => !row.ok);
    const latencies = sortedByTime.map(row => row.latencyMs).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
    const samples = sortedByTime.length;
    const successRate = samples ? Number((successful.length / samples).toFixed(4)) : null;
    const latencyP50Ms = quantile(latencies, 0.5);
    const latencyP95Ms = quantile(latencies, 0.95);
    const reasonCounts = new Map<string, number>();
    failures.forEach(row => {
      const reason = row.reason?.trim() || 'unknown';
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    });
    let status: SourceHealthSummary['status'] = 'unknown';
    if (samples >= minSamples && successRate !== null) {
      if (successRate === 0) status = 'unavailable';
      else if (latencyP95Ms === null || successRate < successRateThreshold || latencyP95Ms > latencyP95ThresholdMs) status = 'degraded';
      else status = 'live';
    }
    return {
      sourceId,
      sourceName: sortedByTime[sortedByTime.length - 1]?.sourceName ?? sourceId,
      market: sortedByTime[sortedByTime.length - 1]?.market ?? 'unknown',
      status,
      samples,
      successRate,
      latencyP50Ms: latencyP50Ms === null ? null : Number(latencyP50Ms.toFixed(1)),
      latencyP95Ms: latencyP95Ms === null ? null : Number(latencyP95Ms.toFixed(1)),
      lastOkAt: successful[successful.length - 1]?.at ?? null,
      lastFailureAt: failures[failures.length - 1]?.at ?? null,
      failureReasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    };
  }).sort((left, right) => left.status.localeCompare(right.status) || left.sourceId.localeCompare(right.sourceId));
  const thresholds = { successRate: successRateThreshold, latencyP95Ms: latencyP95ThresholdMs };
  const payload = {
    generatedAt: new Date(now).toISOString(),
    windowFrom: new Date(from).toISOString(),
    windowTo: new Date(now).toISOString(),
    minSamples,
    thresholds,
    sources,
    unknownSources: sources.filter(source => source.status === 'unknown').length,
  };
  return { ...payload, contentHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}
