export type SourceStatus = 'fresh' | 'stale' | 'failed' | 'unconfigured';

export interface SourceSnapshot<T> {
  data: T | null;
  source: string;
  fetchedAt: string;
  expiresAt: string;
  latencyMs: number | null;
  status: SourceStatus;
  error?: string;
  consecutiveFailures?: number;
}
export interface DataSourceAdapter<T> {
  id: string;
  group: string;
  fetch(input?: unknown): Promise<SourceSnapshot<T>>;
}

export interface ResilientSourceOptions<T> {
  id: string;
  group: string;
  ttlMs?: number;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  fetcher: (input: unknown, signal: AbortSignal) => Promise<T>;
}

export class ResilientDataSourceAdapter<T> implements DataSourceAdapter<T> {
  readonly id: string;
  readonly group: string;
  private readonly options: Required<Omit<ResilientSourceOptions<T>, 'id' | 'group' | 'fetcher'>> & Pick<ResilientSourceOptions<T>, 'fetcher'>;
  private cached: SourceSnapshot<T> | null = null;
  private failures = 0;
  private circuitOpenUntil = 0;

  constructor(options: ResilientSourceOptions<T>) {
    this.id = options.id;
    this.group = options.group;
    this.options = {
      ttlMs: options.ttlMs ?? 30_000,
      timeoutMs: options.timeoutMs ?? 8_000,
      retries: options.retries ?? 2,
      backoffMs: options.backoffMs ?? 250,
      fetcher: options.fetcher,
    };
  }

  async fetch(input: unknown = undefined): Promise<SourceSnapshot<T>> {
    const now = Date.now();
    if (this.cached?.status === 'fresh' && new Date(this.cached.expiresAt).getTime() > now) return this.cached;
    if (this.circuitOpenUntil > now && this.cached) return { ...this.cached, status: 'stale', error: 'source circuit is open', consecutiveFailures: this.failures };
    const started = Date.now();
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.options.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const data = await this.options.fetcher(input, controller.signal);
        clearTimeout(timer);
        const fetchedAt = new Date().toISOString();
        const snapshot: SourceSnapshot<T> = {
          data,
          source: this.id,
          fetchedAt,
          expiresAt: new Date(Date.now() + this.options.ttlMs).toISOString(),
          latencyMs: Date.now() - started,
          status: 'fresh',
          consecutiveFailures: 0,
        };
        this.cached = snapshot;
        this.failures = 0;
        this.circuitOpenUntil = 0;
        return snapshot;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt < this.options.retries) await new Promise(resolve => setTimeout(resolve, this.options.backoffMs * (2 ** attempt)));
      }
    }
    this.failures += 1;
    if (this.failures >= 3) this.circuitOpenUntil = Date.now() + Math.min(5 * 60_000, this.options.backoffMs * (2 ** this.failures));
    if (this.cached?.data != null) return { ...this.cached, status: 'stale', error: String(lastError), latencyMs: Date.now() - started, consecutiveFailures: this.failures };
    const nowIso = new Date().toISOString();
    return { data: null, source: this.id, fetchedAt: nowIso, expiresAt: nowIso, latencyMs: Date.now() - started, status: 'failed', error: String(lastError), consecutiveFailures: this.failures };
  }
}
