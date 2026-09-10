export interface CacheOptions {
  ttl: number;
  staleTtl?: number;
}

export interface CacheEntry<T> {
  data: T;
  status: 'fresh' | 'stale' | 'expired' | 'error';
  updatedAt: number;
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

export function createPerformanceCache() {
  const store = new Map<string, { value: any, expiresAt: number, staleAt: number }>();
  const pending = new Map<string, Promise<any>>();

  async function fetch<T>(key: string, fetcher: () => Promise<T>, options: CacheOptions): Promise<CacheEntry<T>> {
    const now = Date.now();
    const cached = store.get(key);
    
    if (cached) {
      if (now < cached.expiresAt) {
        return { data: cached.value, status: 'fresh', updatedAt: cached.staleAt - options.ttl };
      }
      if (options.staleTtl && now < cached.staleAt) {
        if (!pending.has(key)) {
          const p = fetcher().then(data => {
            store.set(key, { value: data, expiresAt: Date.now() + options.ttl, staleAt: Date.now() + options.ttl + options.staleTtl! });
          }).catch(() => {}).finally(() => pending.delete(key));
          pending.set(key, p);
        }
        return { data: cached.value, status: 'stale', updatedAt: cached.staleAt - options.staleTtl - options.ttl };
      }
    }

    if (pending.has(key)) {
      try {
        const data = await pending.get(key);
        return { data, status: 'fresh', updatedAt: Date.now() };
      } catch (err) {
        if (cached) return { data: cached.value, status: 'expired', updatedAt: cached.staleAt - (options.staleTtl || 0) - options.ttl, error: err };
        throw err;
      }
    }

    const p = fetcher();
    pending.set(key, p);
    try {
      const data = await p;
      store.set(key, { value: data, expiresAt: Date.now() + options.ttl, staleAt: Date.now() + options.ttl + (options.staleTtl || 0) });
      return { data, status: 'fresh', updatedAt: Date.now() };
    } catch (err) {
      if (cached) return { data: cached.value, status: 'expired', updatedAt: cached.staleAt - (options.staleTtl || 0) - options.ttl, error: err };
      return { data: null as any, status: 'error', updatedAt: Date.now(), error: err };
    } finally {
      pending.delete(key);
    }
  }
  return { fetch };
}

export const globalCache = createPerformanceCache();
