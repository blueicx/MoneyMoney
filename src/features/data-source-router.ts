export type DataStatus = 'live' | 'cached' | 'degraded' | 'unavailable' | 'empty';
export type DataQuality = 'high' | 'medium' | 'low';
export type DataDataset = 'quote' | 'bars' | 'depth' | 'funding' | 'openInterest' | 'optionsChain' | 'fundamentals' | 'filings' | 'news' | 'events' | 'settlementEvidence';

export interface DataCapability {
  status: DataStatus;
  reason?: string;
  lastUpdated: number;
  quality?: DataQuality;
  budget?: number;
  marketScope?: readonly string[];
  capabilities?: readonly DataDataset[];
}

export interface DataFetchParams {
  marketId?: string;
  capability?: DataDataset;
  [key: string]: unknown;
}

export interface RetryPolicy {
  maxAttempts?: number;
  delayMs?: number;
}

export interface DataSourceDefinition {
  markets?: readonly string[];
  capabilities?: readonly DataDataset[];
  quality?: DataQuality;
  budget?: number;
  lastUpdated?: number;
  retry?: RetryPolicy;
  fetchLive: (params: DataFetchParams) => Promise<unknown>;
  fetchCached?: (params: DataFetchParams) => Promise<unknown>;
}

export interface RoutedData {
  data: unknown;
  capability: DataCapability;
}

function isEmptyData(data: unknown): boolean {
  return data === null || data === undefined || (Array.isArray(data) && data.length === 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DataSourceRouter {
  private readonly sources = new Map<string, DataSourceDefinition>();

  register(name: string, source: DataSourceDefinition): void {
    if (!name.trim()) throw new Error('Data source name is required');
    if (typeof source.fetchLive !== 'function') throw new Error(`Data source ${name} must define fetchLive()`);
    this.sources.set(name, source);
  }

  private async fetchWithRetry(source: DataSourceDefinition, params: DataFetchParams): Promise<unknown> {
    const maxAttempts = Math.max(1, Math.floor(source.retry?.maxAttempts ?? 1));
    const delayMs = Math.max(0, source.retry?.delayMs ?? 0);
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await source.fetchLive(params);
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts && delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(errorMessage(lastError));
  }

  private unavailable(reason: string, source?: DataSourceDefinition): RoutedData {
    return {
      data: null,
      capability: {
        status: 'unavailable', reason, lastUpdated: source?.lastUpdated ?? Date.now(), quality: source?.quality ?? 'low', budget: source?.budget,
        marketScope: source?.markets, capabilities: source?.capabilities,
      },
    };
  }

  async fetch(name: string, params: DataFetchParams = {}): Promise<RoutedData> {
    const source = this.sources.get(name);
    if (!source) return this.unavailable('Source not found');
    if (source.markets?.length && (!params.marketId || !source.markets.includes(params.marketId))) {
      return this.unavailable(`Data source ${name} does not support market ${params.marketId ?? '(missing)'}`, source);
    }
    if (source.capabilities?.length && (!params.capability || !source.capabilities.includes(params.capability))) {
      return this.unavailable(`Data source ${name} does not support capability ${params.capability ?? '(missing)'}`, source);
    }

    try {
      const data = await this.fetchWithRetry(source, params);
      const capability: DataCapability = {
        status: isEmptyData(data) ? 'empty' : 'live',
        ...(isEmptyData(data) ? { reason: 'No data returned by the selected source' } : {}),
        lastUpdated: Date.now(), quality: source.quality ?? 'high', budget: source.budget,
        marketScope: source.markets, capabilities: source.capabilities,
      };
      return { data, capability };
    } catch (error) {
      const liveReason = errorMessage(error);
      if (source.fetchCached) {
        try {
          const cached = await source.fetchCached(params);
          if (!isEmptyData(cached)) {
            return { data: cached, capability: { status: 'cached', reason: liveReason, lastUpdated: source.lastUpdated ?? Date.now(), quality: source.quality ?? 'medium', budget: source.budget, marketScope: source.markets, capabilities: source.capabilities } };
          }
        } catch (cachedError) {
          return this.unavailable(`${liveReason}; cache unavailable: ${errorMessage(cachedError)}`, source);
        }
      }
      return this.unavailable(liveReason, source);
    }
  }
}
