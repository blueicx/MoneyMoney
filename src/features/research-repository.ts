import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ResearchJob, JobStatus, ArtifactManifest, MarketId, DataSnapshot, EvidenceBundle, LineageRef, AlertDelivery, assertMarketContext } from './research-contracts';
import { DATA_ROOT, ensureDir } from '../utils/paths';

let db: Database.Database;

export function setDbPath(dbPath: string) {
  if (db) db.close();
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  initDb(db);
}

function initDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_jobs (
      id TEXT PRIMARY KEY,
      market TEXT NOT NULL,
      workspace TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL,
      errorReason TEXT,
      inputSummary TEXT,
      strategyVersion TEXT,
      dataSnapshotId TEXT,
      artifactHash TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jobId TEXT NOT NULL,
      eventType TEXT NOT NULL,
      payload TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      jobId TEXT NOT NULL,
      hash TEXT NOT NULL,
      uri TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategy_candidates (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signal_monitor (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );


    CREATE TABLE IF NOT EXISTS data_snapshots (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence_bundles (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lineage_refs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alert_deliveries (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS data_source_health (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_health_events (
      id TEXT PRIMARY KEY,
      market TEXT NOT NULL,
      at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_source_health_events_market_at ON source_health_events(market, at DESC);
    CREATE TABLE IF NOT EXISTS source_health_samples (
      id TEXT PRIMARY KEY,
      market TEXT NOT NULL,
      source_id TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_source_health_samples_market_at ON source_health_samples(market, checked_at DESC);
    CREATE TABLE IF NOT EXISTS signal_status_history (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      market TEXT NOT NULL,
      instrument TEXT NOT NULL,
      at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_signal_status_history_signal_at ON signal_status_history(market, signal_id, at ASC);
  `);
}

setDbPath(path.join(DATA_ROOT, 'research.db'));

export const researchRepository = {
  saveJob(job: ResearchJob) {
    const stmt = db.prepare(`
      INSERT INTO research_jobs (id, market, workspace, status, progress, errorReason, inputSummary, strategyVersion, dataSnapshotId, artifactHash, createdAt, updatedAt)
      VALUES (@id, @market, @workspace, @status, @progress, @errorReason, @inputSummary, @strategyVersion, @dataSnapshotId, @artifactHash, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        progress = excluded.progress,
        errorReason = excluded.errorReason,
        inputSummary = excluded.inputSummary,
        strategyVersion = excluded.strategyVersion,
        dataSnapshotId = excluded.dataSnapshotId,
        artifactHash = excluded.artifactHash,
        updatedAt = excluded.updatedAt
    `);
    stmt.run(job);
  },

  getJob(id: string): ResearchJob | null {
    const stmt = db.prepare('SELECT * FROM research_jobs WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return row as ResearchJob;
  },

  listJobs(market?: MarketId): ResearchJob[] {
    const rows = market
      ? db.prepare('SELECT * FROM research_jobs WHERE market = ? ORDER BY updatedAt DESC').all(market)
      : db.prepare('SELECT * FROM research_jobs ORDER BY updatedAt DESC').all();
    return rows as ResearchJob[];
  },

  updateJobStatus(id: string, status: JobStatus, progress?: number, errorReason?: string) {
    const job = this.getJob(id);
    if (!job) throw new Error('Job not found');

    // Status migration checks
    const validTransitions: Record<JobStatus, JobStatus[]> = {
      queued: ['running', 'cancelled'],
      running: ['paused', 'cancelling', 'succeeded', 'failed'],
      paused: ['running', 'cancelled'],
      cancelling: ['cancelled', 'failed'],
      succeeded: [],
      failed: [],
      cancelled: []
    };
    if (!validTransitions[job.status as JobStatus].includes(status)) {
      throw new Error(`Invalid job status transition: ${job.status} -> ${status}`);
    }

    job.status = status;
    job.updatedAt = new Date().toISOString();
    if (progress !== undefined) job.progress = progress;
    if (errorReason !== undefined) job.errorReason = errorReason;
    this.saveJob(job);
    this.addEvent(id, 'STATUS_UPDATE', { status, progress, errorReason });
  },

  addEvent(jobId: string, eventType: string, payload: any) {
    const stmt = db.prepare('INSERT INTO job_events (jobId, eventType, payload, createdAt) VALUES (?, ?, ?, ?)');
    stmt.run(jobId, eventType, JSON.stringify(payload), new Date().toISOString());
  },

  getEvents(jobId: string, afterId: number = 0) {
    const stmt = db.prepare('SELECT * FROM job_events WHERE jobId = ? AND id > ? ORDER BY id ASC');
    return stmt.all(jobId, afterId).map((row: any) => ({
      ...row,
      payload: JSON.parse(row.payload)
    }));
  },

  saveArtifact(artifact: ArtifactManifest) {
    const stmt = db.prepare('INSERT OR REPLACE INTO artifacts (id, jobId, hash, uri, createdAt) VALUES (@id, @jobId, @hash, @uri, @createdAt)');
    stmt.run(artifact);
  },

  getArtifacts(jobId: string): ArtifactManifest[] {
    const stmt = db.prepare('SELECT * FROM artifacts WHERE jobId = ?');
    return stmt.all(jobId) as ArtifactManifest[];
  },

  saveExperiment(id: string, data: any) {
    const stmt = db.prepare('INSERT OR REPLACE INTO experiments (id, data) VALUES (?, ?)');
    stmt.run(id, JSON.stringify(data));
  },

  getExperiment(id: string) {
    const stmt = db.prepare('SELECT data FROM experiments WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },
  listExperiments(limit = 100) {
    const size = Math.max(1, Math.min(500, Number(limit) || 100));
    return db.prepare('SELECT data FROM experiments ORDER BY rowid DESC LIMIT ?').all(size).map((row: any) => JSON.parse(row.data));
  },

  close() {
    if (db) {
      db.close();
    }
  },

  saveCandidate(id: string, data: any) {
    db.prepare('INSERT OR REPLACE INTO strategy_candidates (id, data) VALUES (?, ?)').run(id, JSON.stringify(data));
  },
  getCandidate(id: string) {
    const row = db.prepare('SELECT data FROM strategy_candidates WHERE id = ?').get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },
  getAllCandidates() {
    return db.prepare('SELECT data FROM strategy_candidates').all().map((row: any) => JSON.parse(row.data));
  },
  saveSignal(id: string, data: any) {
    db.prepare('INSERT OR REPLACE INTO signal_monitor (id, data) VALUES (?, ?)').run(id, JSON.stringify(data));
  },
  getSignal(id: string) {
    const row = db.prepare('SELECT data FROM signal_monitor WHERE id = ?').get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },
  getAllSignals() {
    return db.prepare('SELECT data FROM signal_monitor').all().map((row: any) => JSON.parse(row.data));
  },

  saveDataSnapshot(snapshot: DataSnapshot) {
    assertMarketContext(snapshot.context);
    if (!snapshot.id || !snapshot.hash) throw new Error('Invalid DataSnapshot integrity');
    db.prepare("INSERT OR REPLACE INTO data_snapshots (id, data) VALUES (?, ?)").run(snapshot.id, JSON.stringify(snapshot));
  },
  getDataSnapshot(id: string): DataSnapshot | null {
    const row = db.prepare("SELECT data FROM data_snapshots WHERE id = ?").get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },
  saveEvidenceBundle(bundle: EvidenceBundle) {
    assertMarketContext(bundle.context);
    if (!bundle.id || !Array.isArray(bundle.artifacts)) throw new Error('Invalid EvidenceBundle integrity');
    db.prepare("INSERT OR REPLACE INTO evidence_bundles (id, data) VALUES (?, ?)").run(bundle.id, JSON.stringify(bundle));
  },
  getEvidenceBundle(id: string): EvidenceBundle | null {
    const row = db.prepare("SELECT data FROM evidence_bundles WHERE id = ?").get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },
  saveLineageRef(lineage: LineageRef) {
    assertMarketContext(lineage.context);
    if (!lineage.id || !lineage.sourceId || !lineage.operation) throw new Error('Invalid LineageRef integrity');
    db.prepare("INSERT OR REPLACE INTO lineage_refs (id, data) VALUES (?, ?)").run(lineage.id, JSON.stringify(lineage));
  },
  getLineageRef(id: string): LineageRef | null {
    const row = db.prepare("SELECT data FROM lineage_refs WHERE id = ?").get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },
  saveAlertDelivery(delivery: AlertDelivery) {
    assertMarketContext(delivery.context);
    if (!delivery.id || !delivery.alertId) throw new Error('Invalid AlertDelivery integrity');
    db.prepare("INSERT OR REPLACE INTO alert_deliveries (id, data) VALUES (?, ?)").run(delivery.id, JSON.stringify(delivery));
  },
  getAlertDelivery(id: string): AlertDelivery | null {
    const row = db.prepare("SELECT data FROM alert_deliveries WHERE id = ?").get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },
  listAlertDeliveries(limit = 100) {
    const size = Math.max(1, Math.min(500, Number(limit) || 100));
    return db.prepare('SELECT data FROM alert_deliveries ORDER BY rowid DESC LIMIT ?').all(size).map((row: any) => JSON.parse(row.data));
  },
  updateAlertDeliveryStatus(id: string, status: string, deliveredAt?: string) {
    const delivery = this.getAlertDelivery(id);
    if (!delivery) return null;
    const next = { ...delivery, status, ...(deliveredAt ? { deliveredAt } : {}) };
    this.saveAlertDelivery(next);
    return next;
  },
  retryAlertDelivery(id: string) {
    const delivery = this.getAlertDelivery(id);
    if (!delivery) return null;
    if (!['failed', 'queued'].includes(String(delivery.status))) throw new Error('只有失败或排队中的投递可以重试');
    const next = {
      ...delivery,
      status: 'queued',
      attempts: Number(delivery.attempts || 0) + 1,
      lastAttemptAt: new Date().toISOString(),
      lastError: undefined,
      deliveredAt: undefined,
    };
    this.saveAlertDelivery(next);
    return next;
  },
  saveSourceHealth(id: string, data: any) {
    db.prepare('INSERT OR REPLACE INTO data_source_health (id, data) VALUES (?, ?)').run(id, JSON.stringify(data));
  },
  getSourceHealth(id: string) {
    const row = db.prepare('SELECT data FROM data_source_health WHERE id = ?').get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },
  appendSourceHealthEvents(events: any[]) {
    const insert = db.prepare('INSERT OR IGNORE INTO source_health_events (id, market, at, data) VALUES (?, ?, ?, ?)');
    db.transaction((items: any[]) => items.forEach(item => insert.run(item.id, item.market, item.at, JSON.stringify(item))))(events);
    return events;
  },
  listSourceHealthEvents(market: string, limit = 100) {
    return (db.prepare('SELECT data FROM source_health_events WHERE market = ? ORDER BY at DESC LIMIT ?').all(market, Math.max(1, Math.min(500, limit))) as any[]).map(row => JSON.parse(row.data));
  },
  appendSourceHealthSamples(samples: any[], retentionDays = 30) {
    const insert = db.prepare('INSERT OR IGNORE INTO source_health_samples (id, market, source_id, checked_at, data) VALUES (?, ?, ?, ?, ?)');
    const cutoff = new Date(Date.now() - Math.max(7, Math.min(90, retentionDays)) * 86_400_000).toISOString();
    db.transaction((items: any[]) => {
      for (const sample of items) {
        const minute = String(sample.checkedAt || '').slice(0, 16);
        const id = `${sample.market}:${sample.sourceId}:${minute}`;
        insert.run(id, sample.market, sample.sourceId, sample.checkedAt, JSON.stringify(sample));
      }
      db.prepare('DELETE FROM source_health_samples WHERE checked_at < ?').run(cutoff);
    })(samples);
    return samples.length;
  },
  listSourceHealthSamples(market: string, from: string, to: string, limit = 100_000) {
    const boundedLimit = Math.max(1, Math.min(100_000, limit));
    return (db.prepare('SELECT data FROM source_health_samples WHERE market = ? AND checked_at >= ? AND checked_at <= ? ORDER BY checked_at DESC LIMIT ?').all(market, from, to, boundedLimit) as any[]).map(row => JSON.parse(row.data));
  },
  recordSignalHistory(event: { id: string; signalId: string; market: string; instrument: string; at: string; status: string; previousStatus?: string; reason: string; evidenceRefs: string[] }) {
    assertMarketContext({ market: event.market as MarketId, workspace: 'signal-history', instrument: event.instrument });
    if (!event.id?.trim() || !event.signalId?.trim() || !event.reason?.trim() || !Number.isFinite(Date.parse(event.at))) throw new Error('Signal history event is incomplete');
    db.prepare('INSERT OR IGNORE INTO signal_status_history (id, signal_id, market, instrument, at, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(event.id, event.signalId, event.market, event.instrument, event.at, JSON.stringify({ ...event, evidenceRefs: [...new Set(event.evidenceRefs || [])] }));
    return event;
  },
  listSignalHistory(market: string, signalId: string, limit = 500) {
    const boundedLimit = Math.max(1, Math.min(2_000, limit));
    return (db.prepare('SELECT data FROM signal_status_history WHERE market = ? AND signal_id = ? ORDER BY at ASC, rowid ASC LIMIT ?').all(market, signalId, boundedLimit) as any[]).map(row => JSON.parse(row.data));
  }
};
