const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SQLiteStateStore } = require('../dist/storage/sqlite-state');

test('stores JSON documents, audits, and idempotency results transactionally', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-sqlite-'));
  const store = new SQLiteStateStore(path.join(dir, 'state.sqlite'));
  store.transaction(() => {
    store.set('demo', { ok: true }, 3);
    store.appendAudit({ id: 'audit-1', action: 'test', detail: 'created' });
    store.setIdempotent('request-1', { success: true });
  });
  assert.deepEqual(store.get('demo'), { ok: true });
  assert.equal(store.listAudits(1)[0].id, 'audit-1');
  assert.deepEqual(store.getIdempotent('request-1'), { success: true });
  store.close();
});

test('migrates a legacy JSON document and keeps a timestamped backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-migrate-'));
  fs.writeFileSync(path.join(dir, 'paper-portfolio.json'), JSON.stringify({ cashBalance: 123 }), 'utf8');
  const store = new SQLiteStateStore(path.join(dir, 'state.sqlite'), dir);
  assert.deepEqual(store.get('paper-portfolio'), { cashBalance: 123 });
  assert.equal(fs.readdirSync(path.join(dir, 'migration-backups')).length, 1);
  assert.equal(store.health.migratedDocuments, 1);
  store.close();
});
