export type SourceStatus = 'live' | 'stale' | 'unavailable' | 'fallback' | 'unconfigured' | 'cached' | 'degraded';

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
  private inputs = new Map<string,{cached:SourceSnapshot<T>|null;failures:number;circuitOpenUntil:number;inflight?:Promise<SourceSnapshot<T>>}>();

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
    const key=JSON.stringify(input)??'undefined';let state=this.inputs.get(key);
    if(!state){
      if(this.inputs.size>=64){const idle=[...this.inputs].find(([,entry])=>!entry.inflight);if(idle)this.inputs.delete(idle[0]);else throw Error('source input request capacity exceeded');}
      state={cached:null,failures:0,circuitOpenUntil:0};this.inputs.set(key,state);
    }
    if(state.inflight)return state.inflight;
    const current=state;
    const pending=this.fetchInput(input,current);current.inflight=pending;
    try{return await pending;}finally{if(current.inflight===pending)current.inflight=undefined;}
  }

  private async fetchInput(input:unknown,state:{cached:SourceSnapshot<T>|null;failures:number;circuitOpenUntil:number}):Promise<SourceSnapshot<T>> {
    const now = Date.now();
    if (state.cached?.status === 'live' && new Date(state.cached.expiresAt).getTime() > now) return state.cached;
    if (state.circuitOpenUntil > now && state.cached) return { ...state.cached, status: 'stale', error: 'source circuit is open', consecutiveFailures: state.failures };
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
          status: 'live',
          consecutiveFailures: 0,
        };
        state.cached = snapshot;
        state.failures = 0;
        state.circuitOpenUntil = 0;
        return snapshot;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt < this.options.retries) await new Promise(resolve => setTimeout(resolve, this.options.backoffMs * (2 ** attempt)));
      }
    }
    state.failures += 1;
    if (state.failures >= 3) state.circuitOpenUntil = Date.now() + Math.min(5 * 60_000, this.options.backoffMs * (2 ** state.failures));
    if (state.cached?.data != null) return { ...state.cached, status: 'stale', error: String(lastError), latencyMs: Date.now() - started, consecutiveFailures: state.failures };
    const nowIso = new Date().toISOString();
    return { data: null, source: this.id, fetchedAt: nowIso, expiresAt: nowIso, latencyMs: Date.now() - started, status: 'unavailable', error: String(lastError), consecutiveFailures: state.failures };
  }
}

export class TradingViewAdapter<T> implements DataSourceAdapter<T> {
  readonly id = 'tradingview';
  readonly group = 'vendor';
  private enabled = false;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }

  async fetch(input?: unknown): Promise<SourceSnapshot<T>> {
    const nowIso = new Date().toISOString();
    if (!this.enabled) {
      return { data: null, source: this.id, fetchedAt: nowIso, expiresAt: nowIso, latencyMs: 0, status: 'unconfigured', error: 'TradingView adapter is disabled by default' };
    }
    return { data: null, source: this.id, fetchedAt: nowIso, expiresAt: nowIso, latencyMs: 0, status: 'unavailable', error: 'Not implemented' };
  }
}

