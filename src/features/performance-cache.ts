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
  const store = new Map<string, { value: any, updatedAt: number, expiresAt: number, staleAt: number, error?: unknown }>();
  const pending = new Map<string, Promise<any>>();

  function prune() {
    while (store.size > maxEntries) {
      const oldest = [...store.keys()].find(key => !pending.has(key));
      if (!oldest) break;
      store.delete(oldest);
    }
  }

  function write(cacheKey: string, entry: { value: any, updatedAt: number, expiresAt: number, staleAt: number, error?: unknown }) {
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

  async function fetch<T>(key: string, fetcher: () => Promise<T>, options: CacheOptions): Promise<CacheEntry<T>> {
    const now = Date.now();
    const cacheKey = scopedKey(key, options);
    const cached = store.get(cacheKey);
    
    if (cached) {
      if (now < cached.expiresAt) {
        touch(cacheKey, cached);
        return { data: cached.value, status: 'fresh', updatedAt: cached.updatedAt, cacheHit: true, ...(cached.error ? { error: cached.error } : {}) };
      }
      if (options.staleTtl && now < cached.staleAt) {
        if (!pending.has(cacheKey)) {
          const p = fetchWithTimeout(fetcher, options.timeoutMs).then(data => {
            const updatedAt = Date.now();
            write(cacheKey, { value: data, updatedAt, expiresAt: updatedAt + options.ttl, staleAt: updatedAt + options.ttl + options.staleTtl! });
          }).catch(error => {
            const current = store.get(cacheKey);
            if (current) write(cacheKey, { ...current, error });
          }).finally(() => { pending.delete(cacheKey); prune(); });
          pending.set(cacheKey, p);
        }
        touch(cacheKey, cached);
        return { data: cached.value, status: 'stale', updatedAt: cached.updatedAt, cacheHit: true, ...(cached.error ? { error: cached.error } : {}) };
      }
    }

    if (pending.has(cacheKey)) {
      try {
        const data = await pending.get(cacheKey);
        return { data, status: 'fresh', updatedAt: Date.now(), cacheHit: false };
      } catch (err) {
        if (cached) return { data: cached.value, status: 'expired', updatedAt: cached.updatedAt, cacheHit: true, error: err };
        return { data: null as any, status: 'error', updatedAt: Date.now(), cacheHit: false, error: err };
      }
    }

    const p = fetchWithTimeout(fetcher, options.timeoutMs);
    pending.set(cacheKey, p);
    try {
      const data = await p;
      const updatedAt = Date.now();
      write(cacheKey, { value: data, updatedAt, expiresAt: updatedAt + options.ttl, staleAt: updatedAt + options.ttl + (options.staleTtl || 0) });
      return { data, status: 'fresh', updatedAt, cacheHit: false };
    } catch (err) {
      if (cached) return { data: cached.value, status: 'expired', updatedAt: cached.updatedAt, cacheHit: true, error: err };
      return { data: null as any, status: 'error', updatedAt: Date.now(), cacheHit: false, error: err };
    } finally {
      pending.delete(cacheKey);
      prune();
    }
  }
  return { fetch };
}

export const globalCache = createPerformanceCache();
