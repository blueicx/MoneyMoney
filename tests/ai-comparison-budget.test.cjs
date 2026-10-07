const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node/register/transpile-only');
test('comparison quota atomically reserves complete rounds across two SQLite connections, persists and resets UTC',()=>{
 const {SQLiteStateStore}=require('../src/storage/sqlite-state');const {ComparisonModelBudget}=require('../src/features/ai-comparison-budget');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-comparison-budget-')),file=path.join(dir,'state.sqlite'),a=new SQLiteStateStore(file,dir),b=new SQLiteStateStore(file,dir),now=Date.parse('2026-10-08T23:59:00Z');
 try{
  const first=new ComparisonModelBudget(a),second=new ComparisonModelBudget(b);
  first.reserve('round-a',22,now);assert.throws(()=>second.reserve('round-b',4,now),/额度/);assert.equal(second.summary(now).reserved,22);
  second.reserve('round-b',2,now);assert.equal(first.summary(now).remaining,0);assert.equal(first.reserve('round-a',22,now).requests,22);
  assert.equal(first.consume('round-b','review',now),true);assert.equal(second.consume('round-b','review',now),false);assert.equal(second.consume('round-b','autonomous',now),true);assert.equal(first.consume('round-b','extra',now),false);assert.equal(second.summary(now).issued,2);
  assert.equal(new ComparisonModelBudget(b).summary(now).reserved,24);assert.equal(first.summary(now+60000).remaining,24);assert.equal(first.consume('round-b','late',now+60000),false);
  assert.throws(()=>first.reserve('invalid',25,now+60000),/1.*24/);assert.throws(()=>first.reserve('',2,now+60000),/幂等/);
 }finally{a.close();b.close();}
});
test('corrupted SQLite quota cannot be interpreted as a fresh empty allowance',()=>{
 const {SQLiteStateStore}=require('../src/storage/sqlite-state'),{ComparisonModelBudget}=require('../src/features/ai-comparison-budget'),Database=require('better-sqlite3');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-comparison-corrupt-')),file=path.join(dir,'state.sqlite'),store=new SQLiteStateStore(file,dir),now=Date.parse('2026-10-08T12:00:00Z');
 try{const budget=new ComparisonModelBudget(store);budget.reserve('round',24,now);const db=new Database(file);db.prepare('UPDATE state_documents SET payload=? WHERE key=?').run('{invalid','ai-comparison-model-budget:2026-10-08');db.close();assert.throws(()=>budget.summary(now),/存储不可用/);}finally{store.close();}
});
