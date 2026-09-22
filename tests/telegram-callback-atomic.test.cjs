const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync('src/web/server.ts', 'utf8');

test('signed callbacks are issued and consumed within transactions and cannot be replayed', () => {
  let records = [];
  let inTransaction = false;
  const stateStore = {
    transaction(work) { inTransaction = true; try { return work(); } finally { inTransaction = false; } },
    get() { assert.equal(inTransaction, true, 'callback read must be atomic'); return structuredClone(records); },
    set(key, next) { assert.equal(inTransaction, true, 'callback write must be atomic'); records = structuredClone(next); },
  };
  const start = source.indexOf('interface TelegramCallbackRecord');
  const end = source.indexOf('/**', source.indexOf('function consumeTelegramCallback', start));
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const ctx = vm.createContext({ stateStore, crypto: require('node:crypto'), config: { jwtSecret: 'test-only-signing-key' }, Buffer, Date });
  vm.runInContext(js, ctx);
  const data = ctx.issueTelegramCallback('pending:confirm', { scope: 'stocks', id: 'nonce', workspace: 'paper', chatId: '123' });
  assert.equal(ctx.consumeTelegramCallback(data, 'pending:confirm', '456'), null);
  assert.equal(ctx.consumeTelegramCallback(data, 'pending:confirm', '123').id, 'nonce');
  assert.equal(ctx.consumeTelegramCallback(data, 'pending:confirm', '123'), null);
});
