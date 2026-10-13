export interface CacheOptions {
  ttl: number;
  staleTtl?: number;
  scope?: string;
  source?: string;
  timeoutMs?: number;
}

export interface CacheEntry<T> {
  data: T;
  status: 'fresh' | 'stale' | 'expired' | 'error';
  updatedAt: number;
  cacheHit: boolean;
  cacheMode: 'origin' | 'coalesced' | 'cache' | 'stale' | 'expired' | 'error';
  providerLatencyMs: number | null;
  providerLatencyAt: number | null;
  error?: any;
}

export function createCacheEtag(value: unknown): string {
  const input = JSON.stringify(value) ?? 'null';
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `"${(hash >>> 0).toString(16)}"`;
}

export function createPerformanceCache(options: { maxEntries?: number } = {}) {
  const maxEntries = Number.isSafeInteger(options.maxEntries) && Number(options.maxEntries) > 0 ? Number(options.maxEntries) : Infinity;
  type StoredEntry = { value: any, updatedAt: number, expiresAt: number, staleAt: number, providerLatencyMs: number, providerLatencyAt: number, error?: unknown };
  type ProviderResult<T> = { data: T, updatedAt: number, providerLatencyMs: number, providerLatencyAt: number, error?: unknown };
  const store = new Map<string, StoredEntry>();
  const pending = new Map<string, Promise<ProviderResult<any>>>();

  function prune() {
    while (store.size > maxEntries) {
      const oldest = [...store.keys()].find(key => !pending.has(key));
      if (!oldest) break;
      store.delete(oldest);
    }
  }

  function write(cacheKey: string, entry: StoredEntry) {
    store.delete(cacheKey);
    store.set(cacheKey, entry);
    prune();
  }

  function touch<T>(cacheKey: string, entry: T): T {
    store.delete(cacheKey);
    store.set(cacheKey, entry as any);
    return entry;
  }

  function scopedKey(key: string, options: CacheOptions): string {
    return `${options.scope || 'global'}:${options.source || 'unknown'}:${key}`;
  }

  async function fetchWithTimeout<T>(fetcher: () => Promise<T>, timeoutMs?: number): Promise<T> {
    if (!Number.isFinite(timeoutMs) || Number(timeoutMs) <= 0) return fetcher();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fetcher(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`data source timed out after ${timeoutMs}ms`)), Number(timeoutMs));
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function nonNegativeMetric(value: unknown): number | null {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  async function fetchMeasured<T>(fetcher: () => Promise<T>, timeoutMs?: number): Promise<ProviderResult<T>> {
    const startedAt = Date.now();
    try {
      const data = await fetchWithTimeout(fetcher, timeoutMs);
      const providerLatencyAt = Date.now();
      return { data, updatedAt: providerLatencyAt, providerLatencyMs: Math.max(0, providerLatencyAt - startedAt), providerLatencyAt };
    } catch (error: any) {
      const providerLatencyAt = Date.now();
      const providerLatencyMs = Math.max(0, providerLatencyAt - startedAt);
      const original = error instanceof Error ? error : new Error(String(error));
      try {
        Object.assign(original, { providerLatencyMs, providerLatencyAt });
        throw original;
      } catch (annotated) {
        if (annotated === original) throw original;
        const wrapped = new Error(original.message, { cause: error });
        Object.assign(wrapped, { providerLatencyMs, providerLatencyAt });
        throw wrapped;
      }
    }
  }

  async function fetch<T>(key: string, fetcher: () => Promise<T>, options: CacheOptions): Promise<CacheEntry<T>> {
    const now = Date.now();
    const cacheKey = scopedKey(key, options);
    const cached = store.get(cacheKey);
    
    if (cached) {
      if (now < cached.expiresAt) {
        touch(cacheKey, cached);
        return { data: cached.value, status: 'fresh', updatedAt: cached.updatedAt, cacheHit: true, cacheMode: 'cache', providerLatencyMs: cached.providerLatencyMs, providerLatencyAt: cached.providerLatencyAt, ...(cached.error ? { error: cached.error } : {}) };
      }
      if (options.staleTtl && now < cached.staleAt) {
        if (!pending.has(cacheKey)) {
          const p = fetchMeasured(fetcher, options.timeoutMs).then(result => {
            write(cacheKey, { value: result.data, updatedAt: result.updatedAt, expiresAt: result.updatedAt + options.ttl, staleAt: result.updatedAt + options.ttl + options.staleTtl!, providerLatencyMs: result.providerLatencyMs, providerLatencyAt: result.providerLatencyAt });
            return result;
          }).catch(error => {
            const current = store.get(cacheKey);
            const failedLatencyMs = nonNegativeMetric(error?.providerLatencyMs);
            const failedLatencyAt = nonNegativeMetric(error?.providerLatencyAt);
            if (current) write(cacheKey, { ...current, error, providerLatencyMs: failedLatencyMs ?? current.providerLatencyMs, providerLatencyAt: failedLatencyAt ?? current.providerLatencyAt });
            return { data: cached.value, updatedAt: cached.updatedAt, providerLatencyMs: failedLatencyMs ?? cached.providerLatencyMs, providerLatencyAt: failedLatencyAt ?? cached.providerLatencyAt, error };
          }).finally(() => { pending.delete(cacheKey); prune(); });
          pending.set(cacheKey, p);
        }
        touch(cacheKey, cached);
        return { data: cached.value, status: 'stale', updatedAt: cached.updatedAt, cacheHit: true, cacheMode: 'stale', providerLatencyMs: cached.providerLatencyMs, providerLatencyAt: cached.providerLatencyAt, ...(cached.error ? { error: cached.error } : {}) };
      }
    }

    if (pending.has(cacheKey)) {
      try {
        const result = await pending.get(cacheKey)!;
        if (result.error) {
          if (cached) return { data: cached.value, status: 'expired', updatedAt: cached.updatedAt, cacheHit: true, cacheMode: 'expired', providerLatencyMs: result.providerLatencyMs, providerLatencyAt: result.providerLatencyAt, error: result.error };
          return { data: null as any, status: 'error', updatedAt: Date.now(), cacheHit: false, cacheMode: 'error', providerLatencyMs: result.providerLatencyMs, providerLatencyAt: result.providerLatencyAt, error: result.error };
        }
        return { data: result.data, status: 'fresh', updatedAt: result.updatedAt, cacheHit: false, cacheMode: 'coalesced', providerLatencyMs: result.providerLatencyMs, providerLatencyAt: result.providerLatencyAt };
      } catch (err) {
        if (cached) return { data: cached.value, status: 'expired', updatedAt: cached.updatedAt, cacheHit: true, cacheMode: 'expired', providerLatencyMs: cached.providerLatencyMs, providerLatencyAt: cached.providerLatencyAt, error: err };
        return { data: null as any, status: 'error', updatedAt: Date.now(), cacheHit: false, cacheMode: 'error', providerLatencyMs: nonNegativeMetric((err as any)?.providerLatencyMs), providerLatencyAt: nonNegativeMetric((err as any)?.providerLatencyAt), error: err };
      }
    }

    const p = fetchMeasured(fetcher, options.timeoutMs);
    pending.set(cacheKey, p);
    try {
      const result = await p;
      write(cacheKey, { value: result.data, updatedAt: result.updatedAt, expiresAt: result.updatedAt + options.ttl, staleAt: result.updatedAt + options.ttl + (options.staleTtl || 0), providerLatencyMs: result.providerLatencyMs, providerLatencyAt: result.providerLatencyAt });
      return { data: result.data, status: 'fresh', updatedAt: result.updatedAt, cacheHit: false, cacheMode: 'origin', providerLatencyMs: result.providerLatencyMs, providerLatencyAt: result.providerLatencyAt };
    } catch (err) {
      if (cached) return { data: cached.value, status: 'expired', updatedAt: cached.updatedAt, cacheHit: true, cacheMode: 'expired', providerLatencyMs: cached.providerLatencyMs, providerLatencyAt: cached.providerLatencyAt, error: err };
      return { data: null as any, status: 'error', updatedAt: Date.now(), cacheHit: false, cacheMode: 'error', providerLatencyMs: nonNegativeMetric((err as any)?.providerLatencyMs), providerLatencyAt: nonNegativeMetric((err as any)?.providerLatencyAt), error: err };
    } finally {
      pending.delete(cacheKey);
      prune();
    }
  }
  return { fetch };
}

export const globalCache = createPerformanceCache();
