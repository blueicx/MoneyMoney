import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT, ensureDir } from '../utils/paths';

export interface StorageHealth {
  ok: boolean;
  databasePath: string;
  migratedDocuments: number;
  migrationErrors: string[];
  lastMigrationAt?: string;
}

const DATABASE_FILE = path.join(DATA_ROOT, 'moneymoney.sqlite');
const MIGRATIONS = [
  { key: 'telegram-command-center', file: 'telegram-command-center.json', version: 2 },
  { key: 'paper-portfolio', file: 'paper-portfolio.json', version: 1 },
  { key: 'ai-paper-runners', file: 'ai-paper-runners.json', version: 1 },
  { key: 'assistant-journal', file: 'assistant-journal.json', version: 1 },
  { key: 'research-workspace', file: 'research-workspace.json', version: 1 },
  { key: 'automation-ops', file: 'automation-ops.json', version: 1 },
  { key: 'settings', file: 'settings.json', version: 1 },
];

function backupJson(source: string, key: string, backupDir: string): void {
  ensureDir(backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(source, path.join(backupDir, `${key}-${stamp}.json`), fs.constants.COPYFILE_EXCL);
}

export class SQLiteStateStore {
  private readonly db: Database.Database;
  private readonly migrationRoot: string;
  private readonly backupDir: string;
  private readonly healthState: StorageHealth = { ok: true, databasePath: DATABASE_FILE, migratedDocuments: 0, migrationErrors: [] };

  constructor(databasePath = DATABASE_FILE, migrationRoot = DATA_ROOT) {
    ensureDir(DATA_ROOT);
    this.migrationRoot = migrationRoot;
    this.backupDir = path.join(migrationRoot, 'migration-backups');
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS state_documents (key TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, chat_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency_keys (key TEXT PRIMARY KEY, result TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS migration_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.migrateJsonFiles();
  }

  get health(): StorageHealth { return { ...this.healthState, migrationErrors: [...this.healthState.migrationErrors] }; }

  get<T>(key: string): T | null {
    const row = this.db.prepare('SELECT payload FROM state_documents WHERE key = ?').get(key) as { payload?: string } | undefined;
    if (!row?.payload) return null;
    try { return JSON.parse(row.payload) as T; } catch { this.healthState.ok = false; return null; }
  }

  set<T>(key: string, value: T, version = 1): void {
    this.db.prepare(`INSERT INTO state_documents (key, version, updated_at, payload) VALUES (@key, @version, @updatedAt, @payload) ON CONFLICT(key) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, payload = excluded.payload`).run({ key, version, updatedAt: new Date().toISOString(), payload: JSON.stringify(value) });
  }

  transaction<T>(work: () => T): T { return this.db.transaction(work)(); }
  close(): void { this.db.close(); }

  appendAudit(input: { id: string; chatId?: string; action: string; detail: string; at?: string }): void {
    this.db.prepare(`INSERT OR IGNORE INTO audit_log (id, chat_id, action, detail, at) VALUES (@id, @chatId, @action, @detail, @at)`).run({ ...input, chatId: input.chatId ?? null, at: input.at ?? new Date().toISOString() });
  }

  listAudits(limit = 200): Array<{ id: string; chatId?: string; action: string; detail: string; at: string }> {
    return this.db.prepare('SELECT id, chat_id AS chatId, action, detail, at FROM audit_log ORDER BY at DESC LIMIT ?').all(Math.max(1, Math.min(limit, 1000))) as Array<{ id: string; chatId?: string; action: string; detail: string; at: string }>;
  }

  getIdempotent<T>(key: string): T | null {
    const row = this.db.prepare('SELECT result FROM idempotency_keys WHERE key = ?').get(key) as { result?: string } | undefined;
    if (!row?.result) return null;
    try { return JSON.parse(row.result) as T; } catch { return null; }
  }

  setIdempotent<T>(key: string, result: T): void {
    this.db.prepare('INSERT OR IGNORE INTO idempotency_keys (key, result, created_at) VALUES (?, ?, ?)').run(key, JSON.stringify(result), new Date().toISOString());
  }

  private migrateJsonFiles(): void {
    const migrationAt = new Date().toISOString();
    for (const item of MIGRATIONS) {
      if (this.db.prepare('SELECT key FROM state_documents WHERE key = ?').get(item.key)) continue;
      const source = path.join(this.migrationRoot, item.file);
      if (!fs.existsSync(source)) continue;
      try {
        const payload = JSON.parse(fs.readFileSync(source, 'utf8'));
        backupJson(source, item.key, this.backupDir);
        this.set(item.key, payload, item.version);
        this.healthState.migratedDocuments += 1;
      } catch (error) {
        this.healthState.ok = false;
        this.healthState.migrationErrors.push(`${item.file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.db.prepare(`INSERT INTO migration_meta (key, value) VALUES ('last_migration_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(migrationAt);
    this.healthState.lastMigrationAt = migrationAt;
  }
}

export const stateStore = new SQLiteStateStore();
export function getStorageHealth(): StorageHealth { return stateStore.health; }
