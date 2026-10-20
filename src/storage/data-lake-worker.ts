import { createBinanceKlineAdapter, CRYPTO_KLINE_PERIODS, type CryptoKlineBar } from '../data/binance-kline-adapter';
import { createYahooStockHistoryAdapter, createYahooStockKlineAdapter, normalizeYahooSymbol, STOCK_KLINE_PERIODS, type StockKlineBar, type YahooCorporateAction, type YahooStockHistory } from '../data/yahoo-adapter';
import type { DataSourceAdapter } from '../data/source-adapter';
import { randomUUID } from 'node:crypto';
import { dataLakeCatalog, type BarRow, type DataBackfillJob, type DataLakeCatalog } from './data-lake';

type BackfillBar = StockKlineBar | CryptoKlineBar;
type KlineAdapterFactory = () => DataSourceAdapter<BackfillBar[]>;

export interface DataLakeBackfillProvider {
  id: string;
  market: DataBackfillJob['market'];
  datasets: readonly string[];
  timeframes?: readonly string[];
  createAdapter: () => DataSourceAdapter<BackfillBar[]>;
  createHistoryAdapter?: () => DataSourceAdapter<YahooStockHistory>;
}

export interface DataLakeBackfillWorkerOptions {
  providers?: readonly DataLakeBackfillProvider[];
  workerId?: string;
  leaseMs?: number;
}

const DEFAULT_PROVIDERS: readonly DataLakeBackfillProvider[] = [
  {
    id: 'yahoo-finance-history', market: 'stocks', datasets: ['bars'], timeframes: Object.keys(STOCK_KLINE_PERIODS),
    createAdapter: () => createYahooStockKlineAdapter(),
    createHistoryAdapter: () => createYahooStockHistoryAdapter(),
  },
  {
    id: 'binance-crypto-bars', market: 'crypto', datasets: ['bars'], timeframes: Object.keys(CRYPTO_KLINE_PERIODS),
    createAdapter: () => createBinanceKlineAdapter(),
  },
];

function isFiniteBar(bar: StockKlineBar): boolean {
  return Number.isFinite(bar.time) && [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite);
}

export class DataLakeBackfillWorker {
  private active = false;
  private timer: NodeJS.Timeout | null = null;

  private readonly legacyAdapterFactory?: KlineAdapterFactory;
  private readonly providers: readonly DataLakeBackfillProvider[];
  private readonly workerId: string;
  private readonly leaseMs: number;

  capabilities() {
    return this.providers.map(provider => ({ id: provider.id, market: provider.market, datasets: [...provider.datasets], timeframes: [...(provider.timeframes || [])] }));
  }

  constructor(private readonly catalog: DataLakeCatalog, adapterOrOptions?: KlineAdapterFactory | DataLakeBackfillWorkerOptions) {
    if (typeof adapterOrOptions === 'function') {
      this.legacyAdapterFactory = adapterOrOptions;
      this.providers = [];
      this.workerId = `data-lake-worker-${process.pid}`;
      this.leaseMs = 5 * 60 * 1000;
    } else {
      this.providers = adapterOrOptions?.providers || DEFAULT_PROVIDERS;
      this.workerId = adapterOrOptions?.workerId || `data-lake-worker-${process.pid}`;
      this.leaseMs = adapterOrOptions?.leaseMs || 5 * 60 * 1000;
    }
    for (const provider of this.providers) {
      this.catalog.registerProviderContract({
        id: provider.id,
        provider: provider.id,
        market: provider.market,
        datasets: [...provider.datasets],
        timezone: 'UTC',
        units: { timestamp: 'UTC', price: 'native', volume: 'native' },
        revisionPolicy: 'point-in-time',
      });
    }
  }

  async runOnce(): Promise<DataBackfillJob | null> {
    if (this.active) return null;
    this.active = true;
    let job: DataBackfillJob | null;
    try {
      this.catalog.recoverStaleBackfills();
      job = this.catalog.claimNextBackfill(`${this.workerId}:${randomUUID()}`, this.leaseMs);
    } catch (error) {
      this.active = false;
      throw error;
    }
    if (!job) {
      this.active = false;
      return null;
    }
    let heartbeatFailed=false;
    const heartbeat = setInterval(() => { try { if(!this.catalog.heartbeatBackfill(job!.id, job!.leaseOwner!, undefined, this.leaseMs))heartbeatFailed=true; } catch { heartbeatFailed=true; } }, Math.max(250, Math.floor(this.leaseMs / 3)));
    heartbeat.unref();
    try {
      await this.execute(job,()=>!heartbeatFailed);
      return this.catalog.getBackfill(job.id);
    } catch (error: any) {
      return this.catalog.updateBackfill(job.id, 'failed', error?.message || '数据回补失败', job.leaseOwner);
    } finally {
      clearInterval(heartbeat);
      this.active = false;
    }
  }

  private async execute(job: DataBackfillJob, heartbeatValid=()=>true): Promise<void> {
    const canPublish = () => {
      const current = this.catalog.getBackfill(job.id);
      return heartbeatValid() && !!current && current.status === 'running' && current.leaseOwner === job.leaseOwner && Date.parse(current.leaseExpiresAt || '') > Date.now();
    };
    let provider: DataLakeBackfillProvider | undefined;
    let adapter: DataSourceAdapter<BackfillBar[] | YahooStockHistory>;
    if (this.legacyAdapterFactory) {
      if (job.market !== 'stocks') throw new Error('当前兼容回补 Worker 仅支持 stocks 市场');
      if (job.dataset !== 'bars') throw new Error('当前兼容回补 Worker 仅支持 bars 数据集');
      if (!STOCK_KLINE_PERIODS[job.timeframe]) throw new Error(`当前兼容回补 Worker 不支持周期：${job.timeframe}`);
      adapter = this.legacyAdapterFactory() as DataSourceAdapter<BackfillBar[] | YahooStockHistory>;
    } else {
      provider = this.providers.find(candidate => candidate.market === job.market && candidate.datasets.includes(job.dataset) && (!candidate.timeframes || candidate.timeframes.includes(job.timeframe)));
      if (!provider) throw new Error(`当前 ${job.market}/${job.dataset}/${job.timeframe} 没有可用 Provider，来源不可用`);
      adapter = provider.createHistoryAdapter?.() || provider.createAdapter() as DataSourceAdapter<BackfillBar[] | YahooStockHistory>;
    }
    const from = Date.parse(job.from);
    const to = Date.parse(job.to);
    const inRange=(time:number)=>time>=from&&(job.id.startsWith('backfill_plan_')?time<to:time<=to);
    const aggregateDays = job.market === 'stocks' ? STOCK_KLINE_PERIODS[job.timeframe]?.aggregateDays : undefined;
    const snapshot = await adapter.fetch({ symbol: job.instrument, period: job.timeframe, ...(!aggregateDays ? { startTime: from, endTime: to, ...(job.market==='crypto'?{limit:1000}:{}) } : {}) });
    if (!canPublish()) throw new Error('任务已暂停、取消或租约已失效');
    const historyData = snapshot.data && !Array.isArray(snapshot.data) ? snapshot.data as YahooStockHistory : null;
    const sourceBars = Array.isArray(snapshot.data) ? snapshot.data as BackfillBar[] : historyData?.bars || [];
    const corporateActions = (historyData?.corporateActions || []) as YahooCorporateAction[];
    if (!sourceBars.length || ['unavailable', 'unconfigured'].includes(snapshot.status)) {
      throw new Error(snapshot.error || '来源未返回可用历史K线');
    }
    if (corporateActions.some(action => action.market !== job.market || job.market !== 'stocks' || normalizeYahooSymbol(String(action.instrument)) !== normalizeYahooSymbol(job.instrument))) {
      throw new Error('公司行动证据与回补任务的市场/标的不一致，拒绝发布本批历史数据');
    }
    if (corporateActions.some(action => !action.id?.trim() || !action.source?.trim() || !['split', 'dividend'].includes(action.kind) || !Number.isFinite(Date.parse(action.effectiveAt)) ||
      (action.kind === 'split' && (!Number.isFinite(action.factor) || Number(action.factor) <= 0)) ||
      (action.kind === 'dividend' && (!Number.isFinite(action.factor) || Number(action.factor) < 0)))) {
      throw new Error('公司行动证据字段无效，拒绝发布本批历史数据');
    }
    const actionsToPersist = corporateActions.filter(action => {
      const effectiveAt = Date.parse(action.effectiveAt);
      return inRange(effectiveAt);
    }).map(action => ({ ...action, instrument: job.instrument }));
    const bars = sourceBars.filter(isFiniteBar).filter(bar => inRange(bar.time));
    if (!bars.length) throw new Error('来源未返回指定区间内的历史K线');
    const groups = new Map<string, BarRow[]>();
    for (const bar of bars) {
      const date = new Date(bar.time);
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      const rows = groups.get(key) || [];
      rows.push({ timestamp: date.toISOString(), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
      groups.set(key, rows);
    }
    const source = snapshot.status === 'live' ? snapshot.source : `${snapshot.source}:${snapshot.status}`;
    let rowCount = job.checkpoint.rowsWritten;
    let partitionsCommitted = job.checkpoint.partitionsCommitted;
    for (const rows of groups.values()) {
      if (job.checkpoint.cursor && Date.parse(rows[rows.length - 1].timestamp) <= Date.parse(job.checkpoint.cursor)) continue;
      await this.catalog.stageBars({ market: job.market, dataset: job.dataset, instrument: job.instrument, timeframe: job.timeframe, source, publishedAt: snapshot.fetchedAt, timezone: 'UTC', adjustment: historyData?.adjustment, units: { timestamp: 'UTC', price: 'native', volume: 'native' }, rows }, canPublish,()=>{
        const checkpoint = this.catalog.heartbeatBackfill(job.id, job.leaseOwner!, { cursor: rows[rows.length - 1]?.timestamp, rowsWritten: rowCount+rows.length, partitionsCommitted:partitionsCommitted+1 }, this.leaseMs);
        if (!checkpoint) throw new Error('回补任务租约已失效，请重新排队后重试');
      });
      rowCount += rows.length;
      partitionsCommitted += 1;
    }
    for (const action of actionsToPersist) {
      if (!canPublish()) throw new Error('任务已暂停、取消或租约失效，未保存公司行动');
      this.catalog.saveCorporateAction({ ...action, observedAt: snapshot.fetchedAt });
    }
    this.catalog.updateBackfill(job.id, 'succeeded', `累计写入 ${partitionsCommitted} 个 Parquet 分区，共 ${rowCount} 根K线，来源 ${source}`, job.leaseOwner);
  }

  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.catalog.recoverStaleBackfills();
    this.timer = setInterval(() => { void this.runOnce(); }, intervalMs);
    this.timer.unref();
    void this.runOnce();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

export const dataLakeWorker = new DataLakeBackfillWorker(dataLakeCatalog);
