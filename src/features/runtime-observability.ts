export interface HttpObservation { method: string; path: string; status: number; latencyMs: number; at?: number }
export interface SourceObservation { id: string; ok: boolean; latencyMs: number | null; checkedAt: string; status: string }

function percentile95(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)];
}

export function buildSourceSlo(items: SourceObservation[], now = Date.now()): Record<string, {
  samples: number; successRate: number; p95LatencyMs: number | null; freshnessMs: number | null; consecutiveFailures: number; lastStatus: string;
}> {
  const grouped = new Map<string, SourceObservation[]>();
  for (const item of items) grouped.set(item.id, [...(grouped.get(item.id) || []), item]);
  return Object.fromEntries([...grouped.entries()].map(([id, rows]) => {
    const ordered = [...rows].sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
    const latest = ordered[ordered.length - 1];
    let consecutiveFailures = 0;
    for (let index = ordered.length - 1; index >= 0 && !ordered[index].ok; index -= 1) consecutiveFailures += 1;
    const checkedAt = Date.parse(latest.checkedAt);
    return [id, {
      samples: rows.length,
      successRate: rows.filter(item => item.ok).length / rows.length,
      p95LatencyMs: percentile95(rows.map(item => item.latencyMs).filter((value): value is number => Number.isFinite(value))),
      freshnessMs: Number.isFinite(checkedAt) ? Math.max(0, now - checkedAt) : null,
      consecutiveFailures,
      lastStatus: latest.status,
    }];
  }));
}

export function createRuntimeObservability(options?: { maxSamples?: number; startedAt?: number }) {
  const maxSamples = Math.max(10, options?.maxSamples ?? 2_000);
  const startedAt = options?.startedAt ?? Date.now();
  const http: HttpObservation[] = [];
  return {
    recordHttp(observation: HttpObservation): void {
      http.push({ ...observation, at: observation.at ?? Date.now() });
      if (http.length > maxSamples) http.splice(0, http.length - maxSamples);
    },
    snapshot(now = Date.now()) {
      const errors = http.filter(item => item.status >= 500).length;
      const memory = process.memoryUsage();
      return {
        startedAt: new Date(startedAt).toISOString(),
        uptimeMs: Math.max(0, now - startedAt),
        http: {
          requests: http.length,
          errors,
          errorRate: http.length ? errors / http.length : 0,
          p95LatencyMs: percentile95(http.map(item => item.latencyMs)),
        },
        memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal },
      };
    },
  };
}

export const runtimeObservability = createRuntimeObservability();
