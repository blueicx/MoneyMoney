export interface HttpObservation { method: string; path: string; status: number; latencyMs: number; at?: number; requestId?: string|null; outcome?: 'completed'|'aborted' }
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
  const maxSamples = Math.max(10, Math.min(2000, options?.maxSamples ?? 2_000));
  const startedAt = options?.startedAt ?? Date.now();
  const http: HttpObservation[] = [];
  return {
    recordHttp(observation: HttpObservation): void {
      if(!Number.isFinite(observation.latencyMs)||observation.latencyMs<0||!Number.isInteger(observation.status)||observation.status<0||observation.status>599)return;
      const allowed=new Set(['api','health','live','version','readiness','stock','stocks','kline','crypto','options','prediction','research','projects','experiments','forward-observations','ai-evaluations','forecasts','quality','operations','history','diagnostics','data','coverage','recovery','auth','status','login','watchlist','paper','positions']);
      const category=observation.path.startsWith('/')?observation.path.split('?')[0].split('/').slice(1,6).map(p=>allowed.has(p)?p:':id').join('/'):'other';
      http.push({method:['GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS'].includes(observation.method)?observation.method:'OTHER',path:'/'+category,status:observation.status,latencyMs:observation.latencyMs,at:observation.at??Date.now(),requestId:/^[a-f0-9-]{36}$/i.test(observation.requestId||'')?observation.requestId:null,outcome:observation.outcome==='aborted'?'aborted':'completed'});
      if (http.length > maxSamples) http.splice(0, http.length - maxSamples);
    },
    diagnostics(now=Date.now()){
      const recent=http.filter(row=>row.at!<=now&&row.at!>=now-900000).slice(-100).map(({path,...row})=>({...row,category:path}));
      return {windowMs:900000,capacity:maxSamples,recent,retention:'process-memory-only',networkRootCause:'unknown',reason:'仅为服务器已收到的请求；DNS、TCP、TLS握手失败可能完全到不了应用，不凭这些记录推断根因'};
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
