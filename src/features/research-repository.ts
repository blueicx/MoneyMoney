import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ResearchJob, JobStatus, ArtifactManifest, MarketId } from './research-contracts';
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

    CREATE TABLE IF NOT EXISTS data_source_health (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
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
  saveSourceHealth(id: string, data: any) {
    db.prepare('INSERT OR REPLACE INTO data_source_health (id, data) VALUES (?, ?)').run(id, JSON.stringify(data));
  },
  getSourceHealth(id: string) {
    const row = db.prepare('SELECT data FROM data_source_health WHERE id = ?').get(id) as any;
    return row ? JSON.parse(row.data) : null;
  }
};
