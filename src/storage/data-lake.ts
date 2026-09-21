import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DuckDBInstance } from '@duckdb/node-api';
import { timestampMillisValue } from '@duckdb/node-api';
import { DATA_ROOT, ensureDir } from '../utils/paths';
import { MARKET_IDS, type MarketId } from '../features/research-contracts';

export type DatasetStatus = 'staged' | 'committed' | 'rejected';
export interface DatasetManifest { id: string; dataset: string; market: MarketId; source: string; fieldVersion: string; timezone: string; adjustment: string; createdAt: string; contentHash: string; }
export interface DatasetPartition { id: string; manifestId: string; path: string; dataset: string; market: MarketId; instrument: string; timeframe: string; periodStart: string; periodEnd: string; publishedAt: string; fetchedAt: string; rowCount: number; status: DatasetStatus; contentHash: string; }
export interface PointInTimeSnapshot { id: string; market: MarketId; instrument: string; dataset: string; asOf: string; partitionId: string; contentHash: string; }
export interface DataRevision { id: string; dataset: string; partitionId: string; publishedAt: string; supersedes?: string; reason?: string; }
export interface CorporateAction { id: string; market: 'stocks'; instrument: string; kind: 'split' | 'dividend' | 'symbol-change' | 'delisting'; effectiveAt: string; factor?: number; oldSymbol?: string; newSymbol?: string; source: string; }
export interface ProviderContract { id: string; provider: string; market: MarketId; datasets: string[]; timezone: string; units: Record<string, string>; revisionPolicy: 'point-in-time' | 'latest'; }
export interface DataQualityReport { valid: boolean; rowCount: number; duplicateTimestamps: number; outOfOrderRows: number; missingFields: string[]; futureRows: number; errors: string[]; checkedAt: string; }
export interface DataBackfillJob { id: string; market: MarketId; dataset: string; instrument: string; timeframe: string; from: string; to: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; reason?: string; createdAt: string; updatedAt: string; }
export interface BarRow { timestamp: string; open: number; high: number; low: number; close: number; volume?: number; publishedAt?: string; }

const BAR_FIELDS = ['timestamp', 'open', 'high', 'low', 'close'] as const;
const IDENTIFIER = /^[A-Za-z0-9._:/-]+$/;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function hash(value: unknown): string { return crypto.createHash('sha256').update(stableJson(value)).digest('hex'); }
function sqlPath(value: string): string { return value.replace(/'/g, "''"); }

function validateInstrument(market: MarketId, instrument: string): void {
  if (!instrument || !IDENTIFIER.test(instrument)) throw new Error('invalid instrument identity');
  const stock = /^[A-Z][A-Z0-9.]{0,9}$/.test(instrument);
  const crypto = /^(BTC|ETH|BNB|SOL|XRP|DOGE|ADA|AVAX|DOT|LINK)(USDT|USD)?$/.test(instrument.toUpperCase());
  if (market === 'stocks' && (!stock || crypto)) throw new Error('instrument does not belong to stocks market');
  if (market === 'crypto' && !crypto) throw new Error('instrument does not belong to crypto market');
  if (market === 'options' && !instrument.includes(':')) throw new Error('option instrument must include an option identity');
  if (market === 'prediction' && !instrument.includes(':')) throw new Error('prediction instrument must include a market identity');
}

function qualityReport(rows: BarRow[], now = Date.now()): DataQualityReport {
  const missingFields = new Set<string>();
  let duplicateTimestamps = 0;
  let outOfOrderRows = 0;
  let futureRows = 0;
  let previous = -Infinity;
  const seen = new Set<number>();
  for (const row of rows) {
    for (const field of BAR_FIELDS) if (row[field] === undefined || row[field] === null || row[field] === '') missingFields.add(field);
    const timestamp = Date.parse(row.timestamp);
    if (!Number.isFinite(timestamp)) { missingFields.add('timestamp'); continue; }
    if (seen.has(timestamp)) duplicateTimestamps += 1;
    seen.add(timestamp);
    if (timestamp < previous) outOfOrderRows += 1;
    previous = timestamp;
    if (timestamp > now + 60_000) futureRows += 1;
    for (const field of ['open', 'high', 'low', 'close', 'volume'] as const) {
      if (row[field] !== undefined && !Number.isFinite(Number(row[field]))) missingFields.add(field);
    }
  }
  const errors = [
    ...(missingFields.size ? [`missing or invalid fields: ${[...missingFields].join(', ')}`] : []),
    ...(duplicateTimestamps ? [`duplicate timestamps: ${duplicateTimestamps}`] : []),
    ...(outOfOrderRows ? [`out-of-order rows: ${outOfOrderRows}`] : []),
    ...(futureRows ? [`future rows: ${futureRows}`] : []),
  ];
  return { valid: rows.length > 0 && errors.length === 0, rowCount: rows.length, duplicateTimestamps, outOfOrderRows, missingFields: [...missingFields], futureRows, errors, checkedAt: new Date(now).toISOString() };
}

export class DataLakeCatalog {
  private readonly db: Database.Database;
  private readonly lakeRoot: string;

  constructor(options?: { lakeRoot?: string; databasePath?: string }) {
    this.lakeRoot = options?.lakeRoot || path.join(DATA_ROOT, 'lake');
    const databasePath = options?.databasePath || path.join(DATA_ROOT, 'moneymoney.sqlite');
    ensureDir(this.lakeRoot);
    ensureDir(path.join(this.lakeRoot, '.staging'));
    ensureDir(path.dirname(databasePath));
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dataset_manifests (id TEXT PRIMARY KEY, dataset TEXT NOT NULL, market TEXT NOT NULL, source TEXT NOT NULL, field_version TEXT NOT NULL, timezone TEXT NOT NULL, adjustment TEXT NOT NULL, created_at TEXT NOT NULL, content_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dataset_partitions (id TEXT PRIMARY KEY, manifest_id TEXT NOT NULL, path TEXT NOT NULL UNIQUE, dataset TEXT NOT NULL, market TEXT NOT NULL, instrument TEXT NOT NULL, timeframe TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, published_at TEXT NOT NULL, fetched_at TEXT NOT NULL, row_count INTEGER NOT NULL, status TEXT NOT NULL, content_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS data_quality_reports (partition_id TEXT PRIMARY KEY, report TEXT NOT NULL, checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS data_backfill_jobs (id TEXT PRIMARY KEY, market TEXT NOT NULL, dataset TEXT NOT NULL, instrument TEXT NOT NULL, timeframe TEXT NOT NULL, from_at TEXT NOT NULL, to_at TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_dataset_partitions_lookup ON dataset_partitions (market, dataset, instrument, timeframe, published_at);
    `);
  }

  async stageBars(input: { market: MarketId; dataset: string; instrument: string; timeframe: string; source: string; publishedAt: string; rows: BarRow[]; fieldVersion?: string; timezone?: string; adjustment?: string }): Promise<DatasetPartition & { quality: DataQualityReport }> {
    if (!MARKET_IDS.includes(input.market)) throw new Error('invalid market');
    validateInstrument(input.market, input.instrument);
    if (!input.dataset || !input.timeframe || !input.source) throw new Error('dataset, timeframe and source are required');
    const publishedAt = Date.parse(input.publishedAt);
    if (!Number.isFinite(publishedAt)) throw new Error('invalid publishedAt');
    const quality = qualityReport(input.rows);
    if (!quality.valid) throw new Error(`quality gate rejected partition: ${quality.errors.join('; ')}`);
    const first = Date.parse(input.rows[0].timestamp);
    const last = Date.parse(input.rows[input.rows.length - 1].timestamp);
    const year = new Date(first).getUTCFullYear();
    const month = String(new Date(first).getUTCMonth() + 1).padStart(2, '0');
    const contentHash = hash({ ...input, rows: input.rows });
    const partitionId = `partition_${contentHash.slice(0, 24)}`;
    const manifestId = `manifest_${contentHash.slice(0, 24)}`;
    const relative = path.join(input.market, input.dataset, input.instrument, input.timeframe, String(year), month, `${contentHash}.parquet`);
    const finalPath = path.join(this.lakeRoot, relative);
    const stagePath = path.join(this.lakeRoot, '.staging', `${contentHash}.parquet.tmp`);
    ensureDir(path.dirname(finalPath));
    if (fs.existsSync(finalPath)) return { id: partitionId, manifestId, path: finalPath, dataset: input.dataset, market: input.market, instrument: input.instrument, timeframe: input.timeframe, periodStart: new Date(first).toISOString(), periodEnd: new Date(last).toISOString(), publishedAt: new Date(publishedAt).toISOString(), fetchedAt: new Date().toISOString(), rowCount: input.rows.length, status: 'committed', contentHash, quality };

    const instance = await DuckDBInstance.create(':memory:', { memory_limit: '512MB', threads: '1' });
    const connection = await instance.connect();
    try {
      await connection.run('CREATE TABLE bars (observation_ts TIMESTAMP_MS, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE, volume DOUBLE, published_at TIMESTAMP_MS, market VARCHAR, instrument VARCHAR, timeframe VARCHAR, source VARCHAR)');
      const appender = await connection.createAppender('bars');
      for (const row of input.rows) {
        appender.appendTimestampMilliseconds(timestampMillisValue(BigInt(Date.parse(row.timestamp))));
        appender.appendDouble(row.open); appender.appendDouble(row.high); appender.appendDouble(row.low); appender.appendDouble(row.close); appender.appendDouble(row.volume ?? 0);
        appender.appendTimestampMilliseconds(timestampMillisValue(BigInt(publishedAt)));
        appender.appendVarchar(input.market); appender.appendVarchar(input.instrument); appender.appendVarchar(input.timeframe); appender.appendVarchar(input.source); appender.endRow();
      }
      appender.closeSync();
      await connection.run(`COPY bars TO '${sqlPath(stagePath)}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
    } finally { connection.closeSync(); instance.closeSync(); }
    fs.renameSync(stagePath, finalPath);
    const manifest: DatasetManifest = { id: manifestId, dataset: input.dataset, market: input.market, source: input.source, fieldVersion: input.fieldVersion || 'bars-v1', timezone: input.timezone || 'UTC', adjustment: input.adjustment || 'unadjusted', createdAt: new Date().toISOString(), contentHash };
    const partition: DatasetPartition = { id: partitionId, manifestId, path: finalPath, dataset: input.dataset, market: input.market, instrument: input.instrument, timeframe: input.timeframe, periodStart: new Date(first).toISOString(), periodEnd: new Date(last).toISOString(), publishedAt: new Date(publishedAt).toISOString(), fetchedAt: manifest.createdAt, rowCount: input.rows.length, status: 'committed', contentHash };
    this.db.transaction(() => {
      this.db.prepare('INSERT OR REPLACE INTO dataset_manifests (id,dataset,market,source,field_version,timezone,adjustment,created_at,content_hash) VALUES (?,?,?,?,?,?,?,?,?)').run(manifest.id, manifest.dataset, manifest.market, manifest.source, manifest.fieldVersion, manifest.timezone, manifest.adjustment, manifest.createdAt, manifest.contentHash);
      this.db.prepare('INSERT OR REPLACE INTO dataset_partitions (id,manifest_id,path,dataset,market,instrument,timeframe,period_start,period_end,published_at,fetched_at,row_count,status,content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(partition.id, partition.manifestId, partition.path, partition.dataset, partition.market, partition.instrument, partition.timeframe, partition.periodStart, partition.periodEnd, partition.publishedAt, partition.fetchedAt, partition.rowCount, partition.status, partition.contentHash);
      this.db.prepare('INSERT OR REPLACE INTO data_quality_reports (partition_id, report, checked_at) VALUES (?, ?, ?)').run(partition.id, JSON.stringify(quality), quality.checkedAt);
    })();
    return { ...partition, quality };
  }

  async queryBarsAsOf(input: { market: MarketId; instrument: string; timeframe: string; asOf: string }): Promise<{ rows: Array<Record<string, unknown>>; dataStatus: 'historical' | 'unavailable'; source: string | null; updatedAt: string | null; reason?: string; snapshot?: PointInTimeSnapshot }> {
    validateInstrument(input.market, input.instrument);
    const asOf = Date.parse(input.asOf);
    if (!Number.isFinite(asOf)) throw new Error('invalid asOf');
    const candidates = this.db.prepare('SELECT p.*, m.source AS source FROM dataset_partitions p JOIN dataset_manifests m ON m.id = p.manifest_id WHERE p.market = ? AND p.dataset = ? AND p.instrument = ? AND p.timeframe = ? AND p.published_at <= ? AND p.status = ? ORDER BY p.period_start ASC, p.period_end ASC, p.published_at DESC, p.id DESC').all(input.market, 'bars', input.instrument, input.timeframe, new Date(asOf).toISOString(), 'committed') as Array<Record<string, any>>;
    const selected: Array<Record<string, any>> = [];
    const periods = new Set<string>();
    for (const candidate of candidates) {
      const periodKey = `${candidate.period_start}|${candidate.period_end}`;
      if (periods.has(periodKey)) continue;
      periods.add(periodKey);
      selected.push(candidate);
    }
    if (!selected.length) return { rows: [], dataStatus: 'unavailable', source: null, updatedAt: null, reason: '没有在 asOf 时点之前发布的数据分区' };
    const instance = await DuckDBInstance.create(':memory:', { memory_limit: '512MB', threads: '1' });
    const connection = await instance.connect();
    try {
      const rows: Array<Record<string, unknown>> = [];
      for (const partition of selected) {
        const reader = await connection.runAndReadAll(`SELECT observation_ts AS timestamp, open, high, low, close, volume, published_at, market, instrument, timeframe, source FROM read_parquet('${sqlPath(String(partition.path))}') ORDER BY observation_ts`);
        rows.push(...reader.getRowObjectsJS() as Array<Record<string, unknown>>);
      }
      rows.sort((left, right) => Date.parse(String(left.timestamp)) - Date.parse(String(right.timestamp)));
      const latest = selected.reduce((current, candidate) => String(candidate.published_at) > String(current.published_at) ? candidate : current, selected[0]);
      const source = [...new Set(selected.map(item => String(item.source || '')).filter(Boolean))].join(', ');
      const contentHash = crypto.createHash('sha256').update(selected.map(item => String(item.content_hash)).join('|')).digest('hex');
      return { rows, dataStatus: 'historical', source, updatedAt: String(latest.published_at || ''), snapshot: { id: `snapshot_${contentHash.slice(0, 24)}_${asOf}`, market: input.market, instrument: input.instrument, dataset: 'bars', asOf: new Date(asOf).toISOString(), partitionId: selected.map(item => String(item.id)).join(','), contentHash } };
    } finally { connection.closeSync(); instance.closeSync(); }
  }

  listPartitions(): DatasetPartition[] {
    return (this.db.prepare('SELECT id, manifest_id AS manifestId, path, dataset, market, instrument, timeframe, period_start AS periodStart, period_end AS periodEnd, published_at AS publishedAt, fetched_at AS fetchedAt, row_count AS rowCount, status, content_hash AS contentHash FROM dataset_partitions ORDER BY published_at').all() as Array<Record<string, any>>).map((row): DatasetPartition => ({
      id: String(row.id), manifestId: String(row.manifestId), path: String(row.path), dataset: String(row.dataset), market: row.market as MarketId, instrument: String(row.instrument), timeframe: String(row.timeframe), periodStart: String(row.periodStart), periodEnd: String(row.periodEnd), publishedAt: String(row.publishedAt), fetchedAt: String(row.fetchedAt), rowCount: Number(row.rowCount), status: row.status as DatasetStatus, contentHash: String(row.contentHash),
    }));
  }

  listQuality(market?: MarketId): Array<{ partitionId: string; report: DataQualityReport }> {
    const rows = (market
      ? this.db.prepare('SELECT q.partition_id AS partitionId, q.report FROM data_quality_reports q JOIN dataset_partitions p ON p.id = q.partition_id WHERE p.market = ? ORDER BY q.checked_at DESC').all(market)
      : this.db.prepare('SELECT partition_id AS partitionId, report FROM data_quality_reports ORDER BY checked_at DESC').all()) as Array<{ partitionId: string; report: string }>;
    return rows.map(row => ({ partitionId: row.partitionId, report: JSON.parse(row.report) as DataQualityReport }));
  }

  claimNextBackfill(): DataBackfillJob | null {
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare('SELECT id,market,dataset,instrument,timeframe,from_at AS "from",to_at AS "to",status,reason,created_at AS createdAt,updated_at AS updatedAt FROM data_backfill_jobs WHERE status = ? ORDER BY created_at ASC LIMIT 1').get('queued') as Record<string, any> | undefined;
      if (!row) return null;
      const now = new Date().toISOString();
      const updated = this.db.prepare('UPDATE data_backfill_jobs SET status = ?, reason = ?, updated_at = ? WHERE id = ? AND status = ?').run('running', 'Worker 已领取，正在读取免费数据源', now, row.id, 'queued');
      if (updated.changes !== 1) return null;
      return { ...row, status: 'running', reason: 'Worker 已领取，正在读取免费数据源', updatedAt: now, market: row.market as MarketId } as DataBackfillJob;
    });
    return transaction() as DataBackfillJob | null;
  }

  updateBackfill(id: string, status: DataBackfillJob['status'], reason?: string): DataBackfillJob | null {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE data_backfill_jobs SET status = ?, reason = ?, updated_at = ? WHERE id = ?').run(status, reason || null, now, id);
    return this.getBackfill(id);
  }

  recoverStaleBackfills(staleAfterMs = 10 * 60 * 1000): number {
    const cutoff = new Date(Date.now() - Math.max(0, staleAfterMs)).toISOString();
    const now = new Date().toISOString();
    const result = this.db.prepare('UPDATE data_backfill_jobs SET status = ?, reason = ?, updated_at = ? WHERE status = ? AND updated_at < ?').run('queued', '检测到上次 Worker 中断，已重新排队', now, 'running', cutoff);
    return Number(result.changes || 0);
  }

  listBackfills(): DataBackfillJob[] {
    const rows = this.db.prepare('SELECT id,market,dataset,instrument,timeframe,from_at AS "from",to_at AS "to",status,reason,created_at AS createdAt,updated_at AS updatedAt FROM data_backfill_jobs ORDER BY created_at DESC').all() as Array<Record<string, any>>;
    return rows.map(row => ({ ...row, market: row.market as MarketId } as DataBackfillJob));
  }

  createBackfill(input: { market: MarketId; dataset: string; instrument: string; timeframe: string; from: string; to: string }): DataBackfillJob {
    if (!MARKET_IDS.includes(input.market)) throw new Error('invalid market');
    validateInstrument(input.market, input.instrument);
    if (!input.dataset || !input.timeframe || !Number.isFinite(Date.parse(input.from)) || !Number.isFinite(Date.parse(input.to)) || Date.parse(input.from) >= Date.parse(input.to)) throw new Error('invalid backfill range');
    const now = new Date().toISOString();
    const job: DataBackfillJob = { id: `backfill_${crypto.randomUUID()}`, ...input, status: 'queued', reason: '已登记，等待单并发数据 Worker 按 Provider 契约执行', createdAt: now, updatedAt: now };
    this.db.prepare('INSERT INTO data_backfill_jobs (id,market,dataset,instrument,timeframe,from_at,to_at,status,reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(job.id, job.market, job.dataset, job.instrument, job.timeframe, job.from, job.to, job.status, job.reason, job.createdAt, job.updatedAt);
    return job;
  }

  getBackfill(id: string): DataBackfillJob | null {
    const row = this.db.prepare('SELECT id,market,dataset,instrument,timeframe,from_at AS "from",to_at AS "to",status,reason,created_at AS createdAt,updated_at AS updatedAt FROM data_backfill_jobs WHERE id = ?').get(id) as Record<string, any> | undefined;
    return row ? { ...row, market: row.market as MarketId } as DataBackfillJob : null;
  }

  close(): void { this.db.close(); }
}

export const dataLakeCatalog = new DataLakeCatalog();
