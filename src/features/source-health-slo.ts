export type SourceHealthOutcome = 'success' | 'empty' | 'failed' | 'unconfigured';

export interface SourceHealthSample {
  market: string;
  sourceId: string;
  sourceName: string;
  checkedAt: string;
  outcome: SourceHealthOutcome;
  latencyMs: number | null;
  capabilities: string[];
  detail: string;
}

export interface SourceSloSummary {
  windowStart: string;
  windowEnd: string;
  market: string;
  sources: Array<{
    sourceId: string;
    sourceName: string;
    capabilities: string[];
    checks: number;
    available: number;
    empty: number;
    failed: number;
    availabilityPct: number;
    p95LatencyMs: number | null;
    latestCheckAt: string;
    freshnessSeconds: number;
    lastError: string | null;
  }>;
  reason: string | null;
}

export function summarizeSourceSlo(
  samples: readonly SourceHealthSample[],
  input: { market: string; now?: string | number | Date; windowMs?: number },
): SourceSloSummary {
  const end = input.now instanceof Date ? input.now.getTime() : typeof input.now === 'number' ? input.now : Date.parse(input.now || new Date().toISOString());
  const windowMs = Math.max(60_000, Math.min(30 * 86_400_000, Number(input.windowMs || 7 * 86_400_000)));
  const start = end - windowMs;
  const groups = new Map<string, SourceHealthSample[]>();
  for (const sample of samples) {
    const checkedAt = Date.parse(sample.checkedAt);
    if (sample.market !== input.market || !Number.isFinite(checkedAt) || checkedAt < start || checkedAt > end || sample.outcome === 'unconfigured') continue;
    const group = groups.get(sample.sourceId) || [];
    group.push(sample);
    groups.set(sample.sourceId, group);
  }
  const sources = [...groups.entries()].map(([sourceId, rows]) => {
    rows.sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
    const latencies = rows.map(row => row.latencyMs).filter((value): value is number => Number.isFinite(value) && Number(value) >= 0).map(Number).sort((a, b) => a - b);
    const failures = rows.filter(row => row.outcome === 'failed');
    const available = rows.filter(row => row.outcome === 'success' || row.outcome === 'empty').length;
    const empty = rows.filter(row => row.outcome === 'empty').length;
    const latest = rows[rows.length - 1];
    const capabilities = [...new Set(rows.flatMap(row => row.capabilities || []))].sort();
    return {
      sourceId,
      sourceName: latest.sourceName,
      capabilities,
      checks: rows.length,
      available,
      empty,
      failed: failures.length,
      availabilityPct: Math.round((available / rows.length) * 10000) / 100,
      p95LatencyMs: latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] : null,
      latestCheckAt: latest.checkedAt,
      freshnessSeconds: Math.max(0, Math.floor((end - Date.parse(latest.checkedAt)) / 1000)),
      lastError: failures.at(-1)?.detail || null,
    };
  }).sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  return {
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
    market: input.market,
    sources,
    reason: sources.length ? null : '该市场在所选时间窗内没有已记录的数据源检查样本',
  };
}
