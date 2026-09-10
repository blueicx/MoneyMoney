export function createResponseCache({ ttlMs, staleMs }: { ttlMs: number, staleMs: number }) {
    const store = new Map<string, any>();
    return {
        set: (key: string, data: any, source: string) => {
            store.set(`${key}:${source}`, { data, ts: Date.now() });
        },
        read: (key: string, source: string) => {
            const entry = store.get(`${key}:${source}`);
            if (!entry) return { status: 'miss' };
            const age = Date.now() - entry.ts;
            if (age < ttlMs) return { status: 'fresh', data: entry.data };
            if (age < ttlMs + staleMs) return { status: 'stale', data: entry.data };
            return { status: 'miss' };
        }
    };
}
