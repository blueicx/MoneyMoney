import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DuckDBInstance } from '@duckdb/node-api';
import { timestampMillisValue } from '@duckdb/node-api';
import { DATA_ROOT, ensureDir } from '../utils/paths';
import { MARKET_IDS, type MarketId } from '../features/research-contracts';
import { normalizeInstrumentRef, type InstrumentRef } from '../features/unified-instruments';

export type DatasetStatus = 'staged' | 'committed' | 'rejected';
export interface DatasetManifest { id: string; dataset: string; market: MarketId; source: string; fieldVersion: string; timezone: string; adjustment: string; createdAt: string; contentHash: string; }
export interface DatasetPartition { id: string; manifestId: string; path: string; dataset: string; market: MarketId; instrument: string; timeframe: string; periodStart: string; periodEnd: string; publishedAt: string; fetchedAt: string; rowCount: number; status: DatasetStatus; contentHash: string; }
export interface PointInTimeSnapshot { id: string; market: MarketId; instrument: string; dataset: string; timeframe: string; asOf: string; partitionId: string; contentHash: string; source: string | null; createdAt: string; }
export interface DataRevision { id: string; dataset: string; market: MarketId; instrument: string; timeframe: string; partitionId: string; publishedAt: string; contentHash: string; supersedes?: string; reason?: string; }
export interface CorporateAction { id: string; market: 'stocks'; instrument: string; kind: 'split' | 'dividend' | 'symbol-change' | 'delisting'; effectiveAt: string; factor?: number; oldSymbol?: string; newSymbol?: string; source: string; }
export interface ProviderContract { id: string; provider: string; market: MarketId; datasets: string[]; timezone: string; units: Record<string, string>; revisionPolicy: 'point-in-time' | 'latest'; }
export interface DataQualityReport { valid: boolean; rowCount: number; duplicateTimestamps: number; outOfOrderRows: number; missingFields: string[]; futureRows: number; errors: string[]; checkedAt: string; }
export interface BackfillCheckpoint { cursor?: string; rowsWritten: number; partitionsCommitted: number; }
export interface DataBackfillJob { id: string; market: MarketId; dataset: string; instrument: string; timeframe: string; from: string; to: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; reason?: string; createdAt: string; updatedAt: string; leaseOwner?: string; leaseExpiresAt?: string; checkpoint: BackfillCheckpoint; }
export interface BarRow { timestamp: string; open: number; high: number; low: number; close: number; volume?: number; publishedAt?: string; }
export interface DataLakeDiagnostics {
  root: string;
  generatedAt: string;
  usageBytes: number;
  quotaBytes: number;
  usagePercent: number;
  quotaState: 'ok' | 'warning' | 'blocked';
  partitionCount: number;
  stagingFileCount: number;
  byMarket: Record<MarketId, number>;
  byDataset: Record<string, number>;
  backfills: Record<DataBackfillJob['status'], number>;
}
export interface DataCoverage { market: MarketId; instrument: string; dataset: string; timeframe: string; partitionCount: number; rowCount: number; periodStart: string; periodEnd: string; latestPublishedAt: string; status: DatasetStatus; }
export interface DataDiscrepancy { id: string; market: MarketId; instrument: string; timeframe: string; sourceA: string; sourceB: string; status: 'partial'; reason: string; evidence: Array<{ timestamp: string; closeA: number; closeB: number; differencePct: number }>; createdAt: string; }
export interface InstrumentQuarantine { market: MarketId; instrument: string; reason: string; createdAt: string; }

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
function parseCheckpoint(value: unknown): BackfillCheckpoint {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return { cursor: parsed?.cursor ? String(parsed.cursor) : undefined, rowsWritten: Number(parsed?.rowsWritten || 0), partitionsCommitted: Number(parsed?.partitionsCommitted || 0) };
  } catch { return { rowsWritten: 0, partitionsCommitted: 0 }; }
}

function validateInstrument(market: MarketId, instrument: string): void {
  if (!instrument || !IDENTIFIER.test(instrument)) throw new Error('invalid instrument identity');
  const stock = /^[A-Z][A-Z0-9.]{0,9}$/.test(instrument);
  const crypto = /^[A-Z0-9]{2,20}(USDT|USDC|USD)$/.test(instrument.toUpperCase());
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
  let invalidPrices = 0;
  let invalidVolumes = 0;
  let timezoneMissing = 0;
  let previous = -Infinity;
  const seen = new Set<number>();
  for (const row of rows) {
    for (const field of BAR_FIELDS) if (row[field] === undefined || row[field] === null || row[field] === '') missingFields.add(field);
    const timestamp = Date.parse(row.timestamp);
    if (!Number.isFinite(timestamp)) { missingFields.add('timestamp'); continue; }
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(row.timestamp)) timezoneMissing += 1;
    if (seen.has(timestamp)) duplicateTimestamps += 1;
    seen.add(timestamp);
    if (timestamp < previous) outOfOrderRows += 1;
    previous = timestamp;
    if (timestamp > now + 60_000) futureRows += 1;
    for (const field of ['open', 'high', 'low', 'close', 'volume'] as const) {
      if (row[field] !== undefined && !Number.isFinite(Number(row[field]))) missingFields.add(field);
    }
    if ([row.open, row.high, row.low, row.close].every(Number.isFinite) &&
        (row.open <= 0 || row.high <= 0 || row.low <= 0 || row.close <= 0 ||
         row.low > Math.min(row.open, row.close) || row.high < Math.max(row.open, row.close) || row.low > row.high)) invalidPrices += 1;
    if (row.volume !== undefined && Number.isFinite(row.volume) && row.volume < 0) invalidVolumes += 1;
  }
  const errors = [
    ...(missingFields.size ? [`missing or invalid fields: ${[...missingFields].join(', ')}`] : []),
    ...(duplicateTimestamps ? [`duplicate timestamps: ${duplicateTimestamps}`] : []),
    ...(outOfOrderRows ? [`out-of-order rows: ${outOfOrderRows}`] : []),
    ...(futureRows ? [`future rows: ${futureRows}`] : []),
    ...(invalidPrices ? [`invalid OHLC rows: ${invalidPrices}`] : []),
    ...(invalidVolumes ? [`negative volume rows: ${invalidVolumes}`] : []),
    ...(timezoneMissing ? [`timestamps missing timezone: ${timezoneMissing}`] : []),
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
      CREATE TABLE IF NOT EXISTS data_revisions (id TEXT PRIMARY KEY, dataset TEXT NOT NULL, market TEXT NOT NULL, instrument TEXT NOT NULL, timeframe TEXT NOT NULL, partition_id TEXT NOT NULL, published_at TEXT NOT NULL, content_hash TEXT NOT NULL, supersedes TEXT, reason TEXT);
      CREATE TABLE IF NOT EXISTS point_in_time_snapshots (id TEXT PRIMARY KEY, market TEXT NOT NULL, instrument TEXT NOT NULL, dataset TEXT NOT NULL, timeframe TEXT NOT NULL, as_of TEXT NOT NULL, partition_id TEXT NOT NULL, content_hash TEXT NOT NULL, source TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS corporate_actions (id TEXT PRIMARY KEY, market TEXT NOT NULL, instrument TEXT NOT NULL, kind TEXT NOT NULL, effective_at TEXT NOT NULL, factor REAL, old_symbol TEXT, new_symbol TEXT, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_contracts (id TEXT PRIMARY KEY, provider TEXT NOT NULL, market TEXT NOT NULL, datasets TEXT NOT NULL, timezone TEXT NOT NULL, units TEXT NOT NULL, revision_policy TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS instrument_registry (id TEXT PRIMARY KEY, market TEXT NOT NULL, venue TEXT NOT NULL, symbol TEXT NOT NULL, title TEXT NOT NULL, aliases TEXT NOT NULL, registered_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_instrument_registry_symbol ON instrument_registry (market, symbol);
      CREATE TABLE IF NOT EXISTS data_discrepancies (id TEXT PRIMARY KEY, market TEXT NOT NULL, instrument TEXT NOT NULL, timeframe TEXT NOT NULL, source_a TEXT NOT NULL, source_b TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_data_discrepancies_scope ON data_discrepancies (market, instrument, created_at);
      CREATE TABLE IF NOT EXISTS instrument_identity_quarantine (market TEXT NOT NULL, instrument TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (market, instrument));
      CREATE TABLE IF NOT EXISTS data_backfill_jobs (id TEXT PRIMARY KEY, market TEXT NOT NULL, dataset TEXT NOT NULL, instrument TEXT NOT NULL, timeframe TEXT NOT NULL, from_at TEXT NOT NULL, to_at TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, lease_owner TEXT, lease_expires_at TEXT, checkpoint TEXT NOT NULL DEFAULT '{"rowsWritten":0,"partitionsCommitted":0}');
      CREATE INDEX IF NOT EXISTS idx_dataset_partitions_lookup ON dataset_partitions (market, dataset, instrument, timeframe, published_at);
      CREATE INDEX IF NOT EXISTS idx_data_revisions_lookup ON data_revisions (market, dataset, instrument, timeframe, published_at);
      CREATE INDEX IF NOT EXISTS idx_snapshots_lookup ON point_in_time_snapshots (market, instrument, dataset, timeframe, as_of);
    `);
    this.ensureBackfillColumns();
    this.migrateLegacyInstrumentIdentities();
  }

  private migrateLegacyInstrumentIdentities(): void {
    const rows = this.db.prepare('SELECT DISTINCT p.market, p.instrument, m.source FROM dataset_partitions p JOIN dataset_manifests m ON m.id = p.manifest_id ORDER BY p.market,p.instrument,m.source').all() as Array<{ market: MarketId; instrument: string; source: string }>;
    for (const row of rows) {
      if (!MARKET_IDS.includes(row.market) || this.resolveInstrument(row.market, row.instrument)) continue;
      const type = ({ stocks: 'stock', options: 'option', crypto: 'crypto', prediction: 'prediction' } as const)[row.market];
      const venue = row.market === 'stocks' ? 'us' : row.market === 'crypto' && /binance/i.test(row.source) ? 'binance' : '';
      if (venue) {
        try { this.registerInstrument({ type, venue, symbol: row.instrument, title: row.instrument, aliases: [] }); continue; } catch { /* keep ambiguous historical records quarantined */ }
      }
      this.db.prepare('INSERT OR IGNORE INTO instrument_identity_quarantine (market,instrument,reason,created_at) VALUES (?,?,?,?)').run(row.market, row.instrument, `旧数据缺少可确认的交易场所：${row.source}`, new Date().toISOString());
    }
  }

  listInstrumentQuarantine(market: MarketId): InstrumentQuarantine[] {
    return (this.db.prepare('SELECT market,instrument,reason,created_at AS createdAt FROM instrument_identity_quarantine WHERE market = ? ORDER BY instrument').all(market) as InstrumentQuarantine[]);
  }

  private ensureBackfillColumns(): void {
    const columns = this.db.prepare('PRAGMA table_info(data_backfill_jobs)').all() as Array<{ name: string }>;
    const names = new Set(columns.map(column => column.name));
    if (!names.has('lease_owner')) this.db.exec('ALTER TABLE data_backfill_jobs ADD COLUMN lease_owner TEXT');
    if (!names.has('lease_expires_at')) this.db.exec('ALTER TABLE data_backfill_jobs ADD COLUMN lease_expires_at TEXT');
    if (!names.has('checkpoint')) this.db.exec(`ALTER TABLE data_backfill_jobs ADD COLUMN checkpoint TEXT NOT NULL DEFAULT '{"rowsWritten":0,"partitionsCommitted":0}'`);
  }

  registerInstrument(input: Pick<InstrumentRef, 'type' | 'venue' | 'symbol'> & Partial<Pick<InstrumentRef, 'title' | 'aliases'>>): InstrumentRef {
    const ref = normalizeInstrumentRef({ ...input, title: input.title || input.symbol, aliases: input.aliases || [] });
    const market = ({ stock: 'stocks', option: 'options', crypto: 'crypto', prediction: 'prediction' } as const)[ref.type];
    validateInstrument(market, ref.symbol);
    this.db.prepare('INSERT INTO instrument_registry (id,market,venue,symbol,title,aliases,registered_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, aliases=excluded.aliases')
      .run(ref.id, market, ref.venue, ref.symbol, ref.title, JSON.stringify(ref.aliases), new Date().toISOString());
    this.db.prepare('DELETE FROM instrument_identity_quarantine WHERE market = ? AND instrument = ?').run(market, ref.symbol);
    return ref;
  }

  resolveInstrument(market: MarketId | undefined, query: string): InstrumentRef | null {
    if (!market) throw new Error('market is required to resolve an instrument');
    const value = String(query || '').trim().toUpperCase();
    const rows = this.db.prepare('SELECT id,market,venue,symbol,title,aliases FROM instrument_registry WHERE market = ? AND (UPPER(id) = ? OR UPPER(symbol) = ?) ORDER BY id').all(market, value, value) as Array<Record<string, string>>;
    if (rows.length > 1) throw new Error('ambiguous instrument: specify market and venue');
    const row = rows[0];
    if (!row) return null;
    const type = ({ stocks: 'stock', options: 'option', crypto: 'crypto', prediction: 'prediction' } as const)[market];
    return { id: row.id, type, venue: row.venue, symbol: row.symbol, title: row.title, aliases: JSON.parse(row.aliases) as string[] };
  }

  listDiscrepancies(market: MarketId, instrument?: string): DataDiscrepancy[] {
    const rows = (instrument
      ? this.db.prepare('SELECT * FROM data_discrepancies WHERE market = ? AND instrument = ? ORDER BY created_at DESC').all(market, instrument)
      : this.db.prepare('SELECT * FROM data_discrepancies WHERE market = ? ORDER BY created_at DESC').all(market)) as Array<Record<string, any>>;
    return rows.map(row => ({ id: String(row.id), market: row.market as MarketId, instrument: String(row.instrument), timeframe: String(row.timeframe), sourceA: String(row.source_a), sourceB: String(row.source_b), status: 'partial', reason: String(row.reason), evidence: JSON.parse(String(row.evidence)), createdAt: String(row.created_at) }));
  }

  private async rejectConflictingBars(input: { market: MarketId; instrument: string; timeframe: string; source: string; rows: BarRow[]; adjustment?: string; timezone?: string }): Promise<void> {
    const candidates = this.db.prepare('SELECT p.path, m.source, m.adjustment, m.timezone FROM dataset_partitions p JOIN dataset_manifests m ON m.id = p.manifest_id WHERE p.market = ? AND p.dataset = ? AND p.instrument = ? AND p.timeframe = ? AND m.source != ? AND p.status = ? ORDER BY p.published_at DESC LIMIT 12')
      .all(input.market, 'bars', input.instrument, input.timeframe, input.source, 'committed') as Array<{ path: string; source: string; adjustment: string; timezone: string }>;
    if (!candidates.length) return;
    const incoming = new Map(input.rows.map(row => [Date.parse(row.timestamp), row]));
    const instance = await DuckDBInstance.create(':memory:', { memory_limit: '512MB', threads: '1' });
    const connection = await instance.connect();
    try {
      for (const candidate of candidates) {
        if (!fs.existsSync(candidate.path) || candidate.adjustment !== (input.adjustment || 'unadjusted') || candidate.timezone !== (input.timezone || 'UTC')) continue;
        const result = await connection.runAndReadAll(`SELECT observation_ts AS timestamp, close FROM read_parquet('${sqlPath(candidate.path)}') ORDER BY observation_ts`);
        const evidence: DataDiscrepancy['evidence'] = [];
        for (const row of result.getRowObjectsJS() as Array<Record<string, unknown>>) {
          const time = row.timestamp instanceof Date ? row.timestamp.getTime() : Date.parse(String(row.timestamp));
          const next = incoming.get(time);
          const closeA = Number(row.close);
          if (!next || !Number.isFinite(closeA) || closeA <= 0) continue;
          const differencePct = Math.abs(next.close - closeA) / closeA * 100;
          if (differencePct > (input.market === 'stocks' || input.market === 'options' ? 0.5 : 1)) evidence.push({ timestamp: new Date(time).toISOString(), closeA, closeB: next.close, differencePct });
        }
        if (!evidence.length) continue;
        const id = `discrepancy_${hash({ market: input.market, instrument: input.instrument, timeframe: input.timeframe, sourceA: candidate.source, sourceB: input.source, evidence }).slice(0, 24)}`;
        const reason = `${candidate.source} 与 ${input.source} 的 ${evidence.length} 个重叠收盘价超出同市场容差`;
        this.db.prepare('INSERT OR IGNORE INTO data_discrepancies (id,market,instrument,timeframe,source_a,source_b,status,reason,evidence,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(id, input.market, input.instrument, input.timeframe, candidate.source, input.source, 'partial', reason, JSON.stringify(evidence), new Date().toISOString());
        throw new Error(`provider conflict: ${reason}`);
      }
    } finally { connection.closeSync(); instance.closeSync(); }
  }

  async stageBars(input: { market: MarketId; dataset: string; instrument: string; timeframe: string; source: string; publishedAt: string; rows: BarRow[]; fieldVersion?: string; timezone?: string; adjustment?: string; units?: Record<string, string> }): Promise<DatasetPartition & { quality: DataQualityReport }> {
    if (!MARKET_IDS.includes(input.market)) throw new Error('invalid market');
    validateInstrument(input.market, input.instrument);
    this.resolveInstrument(input.market, input.instrument);
    if (!input.dataset || !input.timeframe || !input.source) throw new Error('dataset, timeframe and source are required');
    const contract = this.listProviderContracts(input.market).find(item => item.provider === input.source && item.datasets.includes(input.dataset));
    if (contract) {
      if ((input.timezone || 'UTC') !== contract.timezone) throw new Error('provider timezone mismatch');
      for (const [field, expectedUnit] of Object.entries(contract.units)) {
        if (input.units?.[field] !== expectedUnit) throw new Error(`provider unit mismatch for ${field}`);
      }
    }
    const publishedAt = Date.parse(input.publishedAt);
    if (!Number.isFinite(publishedAt)) throw new Error('invalid publishedAt');
    const quality = qualityReport(input.rows);
    if (!quality.valid) throw new Error(`quality gate rejected partition: ${quality.errors.join('; ')}`);
    await this.rejectConflictingBars(input);
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
    const previous = this.db.prepare('SELECT id FROM data_revisions WHERE market = ? AND dataset = ? AND instrument = ? AND timeframe = ? ORDER BY published_at DESC, id DESC LIMIT 1').get(input.market, input.dataset, input.instrument, input.timeframe) as { id?: string } | undefined;
    const revision: DataRevision = { id: `revision_${partitionId}`, dataset: input.dataset, market: input.market, instrument: input.instrument, timeframe: input.timeframe, partitionId, publishedAt: partition.publishedAt, contentHash, ...(previous?.id ? { supersedes: String(previous.id) } : {}) };
    this.db.transaction(() => {
      this.db.prepare('INSERT OR REPLACE INTO dataset_manifests (id,dataset,market,source,field_version,timezone,adjustment,created_at,content_hash) VALUES (?,?,?,?,?,?,?,?,?)').run(manifest.id, manifest.dataset, manifest.market, manifest.source, manifest.fieldVersion, manifest.timezone, manifest.adjustment, manifest.createdAt, manifest.contentHash);
      this.db.prepare('INSERT OR REPLACE INTO dataset_partitions (id,manifest_id,path,dataset,market,instrument,timeframe,period_start,period_end,published_at,fetched_at,row_count,status,content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(partition.id, partition.manifestId, partition.path, partition.dataset, partition.market, partition.instrument, partition.timeframe, partition.periodStart, partition.periodEnd, partition.publishedAt, partition.fetchedAt, partition.rowCount, partition.status, partition.contentHash);
      this.db.prepare('INSERT OR REPLACE INTO data_quality_reports (partition_id, report, checked_at) VALUES (?, ?, ?)').run(partition.id, JSON.stringify(quality), quality.checkedAt);
      this.db.prepare('INSERT OR REPLACE INTO data_revisions (id,dataset,market,instrument,timeframe,partition_id,published_at,content_hash,supersedes,reason) VALUES (?,?,?,?,?,?,?,?,?,?)').run(revision.id, revision.dataset, revision.market, revision.instrument, revision.timeframe, revision.partitionId, revision.publishedAt, revision.contentHash, revision.supersedes || null, revision.reason || null);
    })();
    if ((input.market === 'stocks' && /^[A-Z][A-Z0-9.]{0,9}$/.test(input.instrument)) ||
        (input.market === 'crypto' && /binance/i.test(input.source))) {
      const type = input.market === 'stocks' ? 'stock' : 'crypto';
      const venue = input.market === 'stocks' ? 'us' : 'binance';
      this.registerInstrument({ type, venue, symbol: input.instrument, title: input.instrument, aliases: [] });
    }
    return { ...partition, quality };
  }

  async queryBarsAsOf(input: { market: MarketId; instrument: string; timeframe: string; asOf: string }): Promise<{ rows: Array<Record<string, unknown>>; dataStatus: 'historical' | 'unavailable'; source: string | null; updatedAt: string | null; reason?: string; snapshot?: PointInTimeSnapshot }> {
    validateInstrument(input.market, input.instrument);
    if (this.listInstrumentQuarantine(input.market).some(item => item.instrument === input.instrument)) return { rows: [], dataStatus: 'unavailable', source: null, updatedAt: null, reason: '标的身份未确认，旧分区已隔离' };
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
        rows.push(...(reader.getRowObjectsJS() as Array<Record<string, unknown>>).filter(row => {
          const timestamp = row.timestamp instanceof Date ? row.timestamp.getTime() : Date.parse(String(row.timestamp));
          return Number.isFinite(timestamp) && timestamp <= asOf;
        }));
      }
      rows.sort((left, right) => Date.parse(String(left.timestamp)) - Date.parse(String(right.timestamp)));
      const latest = selected.reduce((current, candidate) => String(candidate.published_at) > String(current.published_at) ? candidate : current, selected[0]);
      const source = [...new Set(selected.map(item => String(item.source || '')).filter(Boolean))].join(', ');
      if (!rows.length) return { rows: [], dataStatus: 'unavailable', source: source || null, updatedAt: String(latest.published_at || ''), reason: '已发布分区中没有早于该 asOf 时点的 K 线观测' };
      const contentHash = crypto.createHash('sha256').update(selected.map(item => String(item.content_hash)).join('|')).digest('hex');
      const snapshot: PointInTimeSnapshot = { id: `snapshot_${contentHash.slice(0, 24)}_${asOf}`, market: input.market, instrument: input.instrument, dataset: 'bars', timeframe: input.timeframe, asOf: new Date(asOf).toISOString(), partitionId: selected.map(item => String(item.id)).join(','), contentHash, source: source || null, createdAt: new Date().toISOString() };
      this.db.prepare('INSERT OR IGNORE INTO point_in_time_snapshots (id,market,instrument,dataset,timeframe,as_of,partition_id,content_hash,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(snapshot.id, snapshot.market, snapshot.instrument, snapshot.dataset, snapshot.timeframe, snapshot.asOf, snapshot.partitionId, snapshot.contentHash, snapshot.source, snapshot.createdAt);
      return { rows, dataStatus: 'historical', source, updatedAt: String(latest.published_at || ''), snapshot: this.getSnapshot(snapshot.id) || snapshot };
    } finally { connection.closeSync(); instance.closeSync(); }
  }

  getSnapshot(id: string): PointInTimeSnapshot | null {
    const row = this.db.prepare('SELECT id,market,instrument,dataset,timeframe,as_of AS asOf,partition_id AS partitionId,content_hash AS contentHash,source,created_at AS createdAt FROM point_in_time_snapshots WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { id: String(row.id), market: row.market as MarketId, instrument: String(row.instrument), dataset: String(row.dataset), timeframe: String(row.timeframe), asOf: String(row.asOf), partitionId: String(row.partitionId), contentHash: String(row.contentHash), source: row.source == null ? null : String(row.source), createdAt: String(row.createdAt) };
  }

  listRevisions(market?: MarketId): DataRevision[] {
    const rows = (market
      ? this.db.prepare('SELECT id,dataset,market,instrument,timeframe,partition_id AS partitionId,published_at AS publishedAt,content_hash AS contentHash,supersedes,reason FROM data_revisions WHERE market = ? ORDER BY published_at, id').all(market)
      : this.db.prepare('SELECT id,dataset,market,instrument,timeframe,partition_id AS partitionId,published_at AS publishedAt,content_hash AS contentHash,supersedes,reason FROM data_revisions ORDER BY published_at, id').all()) as Array<Record<string, unknown>>;
    return rows.map(row => ({ id: String(row.id), dataset: String(row.dataset), market: row.market as MarketId, instrument: String(row.instrument), timeframe: String(row.timeframe), partitionId: String(row.partitionId), publishedAt: String(row.publishedAt), contentHash: String(row.contentHash), ...(row.supersedes ? { supersedes: String(row.supersedes) } : {}), ...(row.reason ? { reason: String(row.reason) } : {}) }));
  }

  saveCorporateAction(input: CorporateAction): CorporateAction {
    if (input.market !== 'stocks') throw new Error('Corporate actions are only supported for stocks');
    validateInstrument(input.market, input.instrument);
    if (!['split', 'dividend', 'symbol-change', 'delisting'].includes(input.kind)) throw new Error('Invalid corporate action kind');
    if (!Number.isFinite(Date.parse(input.effectiveAt)) || !input.source?.trim()) throw new Error('Corporate action requires effectiveAt and source');
    if (input.kind === 'split' && (!Number.isFinite(input.factor) || Number(input.factor) <= 0)) throw new Error('Split factor must be positive');
    if (input.kind === 'dividend' && (!Number.isFinite(input.factor) || Number(input.factor) < 0)) throw new Error('Dividend amount must be nonnegative');
    if (input.kind === 'symbol-change' && (!input.oldSymbol || !input.newSymbol || input.oldSymbol === input.newSymbol)) throw new Error('Symbol change requires distinct old and new symbols');
    this.db.prepare('INSERT OR REPLACE INTO corporate_actions (id,market,instrument,kind,effective_at,factor,old_symbol,new_symbol,source) VALUES (?,?,?,?,?,?,?,?,?)').run(input.id, input.market, input.instrument, input.kind, new Date(input.effectiveAt).toISOString(), input.factor ?? null, input.oldSymbol || null, input.newSymbol || null, input.source.trim());
    return { ...input, effectiveAt: new Date(input.effectiveAt).toISOString(), source: input.source.trim() };
  }

  listCorporateActions(market?: MarketId, instrument?: string): CorporateAction[] {
    const rows = (market && instrument
      ? this.db.prepare('SELECT id,market,instrument,kind,effective_at AS effectiveAt,factor,old_symbol AS oldSymbol,new_symbol AS newSymbol,source FROM corporate_actions WHERE market = ? AND instrument = ? ORDER BY effective_at').all(market, instrument)
      : market
        ? this.db.prepare('SELECT id,market,instrument,kind,effective_at AS effectiveAt,factor,old_symbol AS oldSymbol,new_symbol AS newSymbol,source FROM corporate_actions WHERE market = ? ORDER BY effective_at').all(market)
        : this.db.prepare('SELECT id,market,instrument,kind,effective_at AS effectiveAt,factor,old_symbol AS oldSymbol,new_symbol AS newSymbol,source FROM corporate_actions ORDER BY effective_at').all()) as Array<Record<string, unknown>>;
    return rows.map(row => ({ id: String(row.id), market: row.market as 'stocks', instrument: String(row.instrument), kind: row.kind as CorporateAction['kind'], effectiveAt: String(row.effectiveAt), ...(row.factor == null ? {} : { factor: Number(row.factor) }), ...(row.oldSymbol ? { oldSymbol: String(row.oldSymbol) } : {}), ...(row.newSymbol ? { newSymbol: String(row.newSymbol) } : {}), source: String(row.source) }));
  }

  registerProviderContract(input: ProviderContract): ProviderContract {
    if (!MARKET_IDS.includes(input.market) || !input.provider?.trim() || !input.id?.trim() || !input.datasets.length) throw new Error('Provider contract is incomplete');
    if (!['point-in-time', 'latest'].includes(input.revisionPolicy)) throw new Error('Invalid provider revision policy');
    this.db.prepare('INSERT OR REPLACE INTO provider_contracts (id,provider,market,datasets,timezone,units,revision_policy,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(input.id, input.provider.trim(), input.market, JSON.stringify([...input.datasets]), input.timezone || 'UTC', JSON.stringify(input.units || {}), input.revisionPolicy, new Date().toISOString());
    return { ...input, provider: input.provider.trim(), datasets: [...input.datasets], timezone: input.timezone || 'UTC', units: { ...input.units } };
  }

  listProviderContracts(market?: MarketId): ProviderContract[] {
    const rows = (market ? this.db.prepare('SELECT id,provider,market,datasets,timezone,units,revision_policy AS revisionPolicy FROM provider_contracts WHERE market = ? ORDER BY id').all(market) : this.db.prepare('SELECT id,provider,market,datasets,timezone,units,revision_policy AS revisionPolicy FROM provider_contracts ORDER BY id').all()) as Array<Record<string, unknown>>;
    return rows.map(row => ({ id: String(row.id), provider: String(row.provider), market: row.market as MarketId, datasets: JSON.parse(String(row.datasets)) as string[], timezone: String(row.timezone), units: JSON.parse(String(row.units)) as Record<string, string>, revisionPolicy: row.revisionPolicy as ProviderContract['revisionPolicy'] }));
  }

  listCoverage(market?: MarketId, instrument?: string, timeframe?: string): DataCoverage[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (market) { clauses.push('market = ?'); values.push(market); }
    if (instrument) { clauses.push('instrument = ?'); values.push(instrument); }
    if (timeframe) { clauses.push('timeframe = ?'); values.push(timeframe); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT market,instrument,dataset,timeframe,COUNT(*) AS partitionCount,SUM(row_count) AS rowCount,MIN(period_start) AS periodStart,MAX(period_end) AS periodEnd,MAX(published_at) AS latestPublishedAt,MAX(status) AS status FROM dataset_partitions ${where} GROUP BY market,instrument,dataset,timeframe ORDER BY market,instrument,timeframe`).all(...values) as Array<Record<string, unknown>>;
    return rows.map(row => ({ market: row.market as MarketId, instrument: String(row.instrument), dataset: String(row.dataset), timeframe: String(row.timeframe), partitionCount: Number(row.partitionCount), rowCount: Number(row.rowCount), periodStart: String(row.periodStart), periodEnd: String(row.periodEnd), latestPublishedAt: String(row.latestPublishedAt), status: row.status as DatasetStatus }));
  }

  listPartitions(): DatasetPartition[] {
    return (this.db.prepare('SELECT id, manifest_id AS manifestId, path, dataset, market, instrument, timeframe, period_start AS periodStart, period_end AS periodEnd, published_at AS publishedAt, fetched_at AS fetchedAt, row_count AS rowCount, status, content_hash AS contentHash FROM dataset_partitions ORDER BY published_at').all() as Array<Record<string, any>>).map((row): DatasetPartition => ({
      id: String(row.id), manifestId: String(row.manifestId), path: String(row.path), dataset: String(row.dataset), market: row.market as MarketId, instrument: String(row.instrument), timeframe: String(row.timeframe), periodStart: String(row.periodStart), periodEnd: String(row.periodEnd), publishedAt: String(row.publishedAt), fetchedAt: String(row.fetchedAt), rowCount: Number(row.rowCount), status: row.status as DatasetStatus, contentHash: String(row.contentHash),
    }));
  }

  listQuality(market?: MarketId, instrument?: string): Array<{ partitionId: string; report: DataQualityReport }> {
    const rows = (market && instrument
      ? this.db.prepare('SELECT q.partition_id AS partitionId, q.report FROM data_quality_reports q JOIN dataset_partitions p ON p.id = q.partition_id WHERE p.market = ? AND p.instrument = ? ORDER BY q.checked_at DESC').all(market, instrument)
      : market
        ? this.db.prepare('SELECT q.partition_id AS partitionId, q.report FROM data_quality_reports q JOIN dataset_partitions p ON p.id = q.partition_id WHERE p.market = ? ORDER BY q.checked_at DESC').all(market)
        : this.db.prepare('SELECT partition_id AS partitionId, report FROM data_quality_reports ORDER BY checked_at DESC').all()) as Array<{ partitionId: string; report: string }>;
    return rows.map(row => ({ partitionId: row.partitionId, report: JSON.parse(row.report) as DataQualityReport }));
  }

  getDiagnostics(options: { quotaBytes?: number; warningPercent?: number; stopPercent?: number } = {}): DataLakeDiagnostics {
    const partitions = this.listPartitions();
    const byMarket: Record<MarketId, number> = { stocks: 0, options: 0, crypto: 0, prediction: 0 };
    const byDataset: Record<string, number> = {};
    let usageBytes = 0;
    for (const partition of partitions) {
      if (MARKET_IDS.includes(partition.market)) byMarket[partition.market] += 1;
      byDataset[partition.dataset] = (byDataset[partition.dataset] || 0) + 1;
      try { usageBytes += fs.statSync(partition.path).size; } catch { /* catalog rows can outlive a removed local file */ }
    }
    let stagingFileCount = 0;
    try { stagingFileCount = fs.readdirSync(path.join(this.lakeRoot, '.staging'), { withFileTypes: true }).filter(item => item.isFile()).length; } catch { /* the constructor normally creates it */ }
    const backfills: Record<DataBackfillJob['status'], number> = { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
    for (const job of this.listBackfills()) backfills[job.status] += 1;
    const quotaBytes = Math.max(1, Number(options.quotaBytes ?? process.env.MONEYMONEY_DATA_LAKE_MAX_BYTES ?? 8 * 1024 ** 3));
    const usagePercent = usageBytes / quotaBytes * 100;
    const warningPercent = Number(options.warningPercent ?? 70);
    const stopPercent = Number(options.stopPercent ?? 90);
    const quotaState = usagePercent >= stopPercent ? 'blocked' : usagePercent >= warningPercent ? 'warning' : 'ok';
    return { root: this.lakeRoot, generatedAt: new Date().toISOString(), usageBytes, quotaBytes, usagePercent, quotaState, partitionCount: partitions.length, stagingFileCount, byMarket, byDataset, backfills };
  }

  claimNextBackfill(owner = '', leaseMs = 5 * 60 * 1000): DataBackfillJob | null {
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare('SELECT id,market,dataset,instrument,timeframe,from_at AS "from",to_at AS "to",status,reason,created_at AS createdAt,updated_at AS updatedAt,lease_owner AS leaseOwner,lease_expires_at AS leaseExpiresAt,checkpoint FROM data_backfill_jobs WHERE status = ? ORDER BY created_at ASC LIMIT 1').get('queued') as Record<string, any> | undefined;
      if (!row) return null;
      const now = new Date().toISOString();
      const leaseOwner = String(owner || '').trim() || null;
      const leaseExpiresAt = leaseOwner ? new Date(Date.now() + Math.max(1_000, leaseMs)).toISOString() : null;
      const updated = this.db.prepare('UPDATE data_backfill_jobs SET status = ?, reason = ?, updated_at = ?, lease_owner = ?, lease_expires_at = ? WHERE id = ? AND status = ?').run('running', 'Worker 已领取，正在读取免费数据源', now, leaseOwner, leaseExpiresAt, row.id, 'queued');
      if (updated.changes !== 1) return null;
      return { ...row, status: 'running', reason: 'Worker 已领取，正在读取免费数据源', updatedAt: now, leaseOwner: leaseOwner || undefined, leaseExpiresAt: leaseExpiresAt || undefined, checkpoint: parseCheckpoint(row.checkpoint), market: row.market as MarketId } as DataBackfillJob;
    });
    return transaction() as DataBackfillJob | null;
  }

  heartbeatBackfill(id: string, owner: string, checkpoint?: Partial<BackfillCheckpoint>, leaseMs = 5 * 60 * 1000): DataBackfillJob | null {
    const current = this.getBackfill(id);
    if (!current || current.status !== 'running' || current.leaseOwner !== owner) return null;
    const nextCheckpoint: BackfillCheckpoint = { ...current.checkpoint, ...checkpoint, rowsWritten: Number(checkpoint?.rowsWritten ?? current.checkpoint.rowsWritten), partitionsCommitted: Number(checkpoint?.partitionsCommitted ?? current.checkpoint.partitionsCommitted) };
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + Math.max(1_000, leaseMs)).toISOString();
    const result = this.db.prepare('UPDATE data_backfill_jobs SET updated_at = ?, lease_expires_at = ?, checkpoint = ? WHERE id = ? AND status = ? AND lease_owner = ?').run(now, leaseExpiresAt, JSON.stringify(nextCheckpoint), id, 'running', owner);
    return result.changes === 1 ? this.getBackfill(id) : null;
  }

  updateBackfill(id: string, status: DataBackfillJob['status'], reason?: string, owner?: string): DataBackfillJob | null {
    const now = new Date().toISOString();
    const terminal = ['succeeded', 'failed', 'cancelled'].includes(status);
    const query = owner
      ? 'UPDATE data_backfill_jobs SET status = ?, reason = ?, updated_at = ?, lease_owner = ?, lease_expires_at = ? WHERE id = ? AND (? IS NULL OR lease_owner = ?)'
      : 'UPDATE data_backfill_jobs SET status = ?, reason = ?, updated_at = ?, lease_owner = ?, lease_expires_at = ? WHERE id = ?';
    const args = owner
      ? [status, reason || null, now, terminal ? null : owner, terminal ? null : new Date(Date.now() + 5 * 60 * 1000).toISOString(), id, owner, owner]
      : [status, reason || null, now, terminal ? null : null, terminal ? null : null, id];
    this.db.prepare(query).run(...args);
    return this.getBackfill(id);
  }

  recoverStaleBackfills(staleAfterMs = 10 * 60 * 1000): number {
    const cutoff = new Date(Date.now() - Math.max(0, staleAfterMs)).toISOString();
    const now = new Date().toISOString();
    const result = this.db.prepare('UPDATE data_backfill_jobs SET status = ?, reason = ?, updated_at = ?, lease_owner = NULL, lease_expires_at = NULL WHERE status = ? AND ((lease_expires_at IS NOT NULL AND lease_expires_at < ?) OR (lease_expires_at IS NULL AND updated_at < ?))').run('queued', '检测到上次 Worker 中断，已重新排队', now, 'running', now, cutoff);
    return Number(result.changes || 0);
  }

  listBackfills(): DataBackfillJob[] {
    const rows = this.db.prepare('SELECT id,market,dataset,instrument,timeframe,from_at AS "from",to_at AS "to",status,reason,created_at AS createdAt,updated_at AS updatedAt,lease_owner AS leaseOwner,lease_expires_at AS leaseExpiresAt,checkpoint FROM data_backfill_jobs ORDER BY created_at DESC').all() as Array<Record<string, any>>;
    return rows.map(row => ({ ...row, leaseOwner: row.leaseOwner || undefined, leaseExpiresAt: row.leaseExpiresAt || undefined, checkpoint: parseCheckpoint(row.checkpoint), market: row.market as MarketId } as DataBackfillJob));
  }

  createBackfill(input: { market: MarketId; dataset: string; instrument: string; timeframe: string; from: string; to: string }): DataBackfillJob {
    if (!MARKET_IDS.includes(input.market)) throw new Error('invalid market');
    validateInstrument(input.market, input.instrument);
    if (!input.dataset || !input.timeframe || !Number.isFinite(Date.parse(input.from)) || !Number.isFinite(Date.parse(input.to)) || Date.parse(input.from) >= Date.parse(input.to)) throw new Error('invalid backfill range');
    const now = new Date().toISOString();
    const job: DataBackfillJob = { id: `backfill_${crypto.randomUUID()}`, ...input, status: 'queued', reason: '已登记，等待单并发数据 Worker 按 Provider 契约执行', createdAt: now, updatedAt: now, checkpoint: { rowsWritten: 0, partitionsCommitted: 0 } };
    this.db.prepare('INSERT INTO data_backfill_jobs (id,market,dataset,instrument,timeframe,from_at,to_at,status,reason,created_at,updated_at,lease_owner,lease_expires_at,checkpoint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(job.id, job.market, job.dataset, job.instrument, job.timeframe, job.from, job.to, job.status, job.reason, job.createdAt, job.updatedAt, null, null, JSON.stringify(job.checkpoint));
    return job;
  }

  getBackfill(id: string): DataBackfillJob | null {
    const row = this.db.prepare('SELECT id,market,dataset,instrument,timeframe,from_at AS "from",to_at AS "to",status,reason,created_at AS createdAt,updated_at AS updatedAt,lease_owner AS leaseOwner,lease_expires_at AS leaseExpiresAt,checkpoint FROM data_backfill_jobs WHERE id = ?').get(id) as Record<string, any> | undefined;
    return row ? { ...row, leaseOwner: row.leaseOwner || undefined, leaseExpiresAt: row.leaseExpiresAt || undefined, checkpoint: parseCheckpoint(row.checkpoint), market: row.market as MarketId } as DataBackfillJob : null;
  }

  close(): void { this.db.close(); }
}

export const dataLakeCatalog = new DataLakeCatalog();
