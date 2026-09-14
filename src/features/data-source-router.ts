export type DataStatus = 'live' | 'cached' | 'degraded' | 'unavailable';

export interface DataCapability {
    status: DataStatus;
    reason?: string;
    lastUpdated: number;
}

export class DataSourceRouter {
    private sources = new Map<string, any>();
    
    register(name: string, source: any) {
        this.sources.set(name, source);
    }

    async fetch(name: string, params: any): Promise<{ data: any, capability: DataCapability }> {
        const source = this.sources.get(name);
        if (!source) {
            return { data: null, capability: { status: 'unavailable', reason: 'Source not found', lastUpdated: Date.now() } };
        }

        try {
            const data = await source.fetchLive(params);
            return { data, capability: { status: 'live', lastUpdated: Date.now() } };
        } catch (e: any) {
            try {
                const cached = await source.fetchCached(params);
                if (cached) {
                    return { data: cached, capability: { status: 'cached', reason: e.message, lastUpdated: source.lastUpdated } };
                }
            } catch (ce) {
                // fallthrough
            }
            return { data: null, capability: { status: 'unavailable', reason: e.message, lastUpdated: Date.now() } };
        }
    }
}