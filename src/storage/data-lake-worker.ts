import { createBinanceKlineAdapter, CRYPTO_KLINE_PERIODS, type CryptoKlineBar } from '../data/binance-kline-adapter';
import { createYahooStockKlineAdapter, STOCK_KLINE_PERIODS, type StockKlineBar } from '../data/yahoo-adapter';
import type { DataSourceAdapter } from '../data/source-adapter';
import { dataLakeCatalog, type BarRow, type DataBackfillJob, type DataLakeCatalog } from './data-lake';

type BackfillBar = StockKlineBar | CryptoKlineBar;
type KlineAdapterFactory = () => DataSourceAdapter<BackfillBar[]>;

export interface DataLakeBackfillProvider {
  id: string;
  market: DataBackfillJob['market'];
  datasets: readonly string[];
  timeframes?: readonly string[];
  createAdapter: () => DataSourceAdapter<BackfillBar[]>;
}

export interface DataLakeBackfillWorkerOptions {
  providers?: readonly DataLakeBackfillProvider[];
}

const DEFAULT_PROVIDERS: readonly DataLakeBackfillProvider[] = [
  {
    id: 'yahoo-stock-bars', market: 'stocks', datasets: ['bars'], timeframes: Object.keys(STOCK_KLINE_PERIODS),
    createAdapter: () => createYahooStockKlineAdapter(),
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

  constructor(private readonly catalog: DataLakeCatalog, adapterOrOptions?: KlineAdapterFactory | DataLakeBackfillWorkerOptions) {
    if (typeof adapterOrOptions === 'function') {
      this.legacyAdapterFactory = adapterOrOptions;
      this.providers = [];
    } else {
      this.providers = adapterOrOptions?.providers || DEFAULT_PROVIDERS;
    }
  }

  async runOnce(): Promise<DataBackfillJob | null> {
    if (this.active) return null;
    this.active = true;
    let job: DataBackfillJob | null;
    try {
      job = this.catalog.claimNextBackfill();
    } catch (error) {
      this.active = false;
      throw error;
    }
    if (!job) {
      this.active = false;
      return null;
    }
    try {
      await this.execute(job);
      return this.catalog.getBackfill(job.id);
    } catch (error: any) {
      return this.catalog.updateBackfill(job.id, 'failed', error?.message || '数据回补失败');
    } finally {
      this.active = false;
    }
  }

  private async execute(job: DataBackfillJob): Promise<void> {
    let provider: DataLakeBackfillProvider | undefined;
    let adapter: DataSourceAdapter<BackfillBar[]>;
    if (this.legacyAdapterFactory) {
      if (job.market !== 'stocks') throw new Error('当前兼容回补 Worker 仅支持 stocks 市场');
      if (job.dataset !== 'bars') throw new Error('当前兼容回补 Worker 仅支持 bars 数据集');
      if (!STOCK_KLINE_PERIODS[job.timeframe]) throw new Error(`当前兼容回补 Worker 不支持周期：${job.timeframe}`);
      adapter = this.legacyAdapterFactory();
    } else {
      provider = this.providers.find(candidate => candidate.market === job.market && candidate.datasets.includes(job.dataset) && (!candidate.timeframes || candidate.timeframes.includes(job.timeframe)));
      if (!provider) throw new Error(`当前 ${job.market}/${job.dataset}/${job.timeframe} 没有可用 Provider，来源不可用`);
      adapter = provider.createAdapter();
    }
    const from = Date.parse(job.from);
    const to = Date.parse(job.to);
    const snapshot = await adapter.fetch({ symbol: job.instrument, period: job.timeframe });
    if (!snapshot.data?.length || ['unavailable', 'unconfigured'].includes(snapshot.status)) {
      throw new Error(snapshot.error || '来源未返回可用历史K线');
    }
    const bars = snapshot.data.filter(isFiniteBar).filter(bar => bar.time >= from && bar.time <= to);
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
    let rowCount = 0;
    for (const rows of groups.values()) {
      await this.catalog.stageBars({ market: job.market, dataset: job.dataset, instrument: job.instrument, timeframe: job.timeframe, source, publishedAt: snapshot.fetchedAt, rows });
      rowCount += rows.length;
    }
    this.catalog.updateBackfill(job.id, 'succeeded', `已写入 ${groups.size} 个 Parquet 分区，共 ${rowCount} 根K线，来源 ${source}`);
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
