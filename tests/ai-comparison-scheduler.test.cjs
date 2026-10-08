const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
require('ts-node/register/transpile-only');
const { SQLiteStateStore } = require('../src/storage/sqlite-state');
const modulePath = '../src/features/ai-comparison-scheduler';
const now = Date.parse('2026-10-08T10:20:00Z'), hour = 3600000;
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-auto-comparison-'));
  const file = path.join(dir, 'state.sqlite');
  const a = new SQLiteStateStore(file, dir), b = new SQLiteStateStore(file, dir);
  assert.ok(fs.existsSync(path.join(__dirname, modulePath + '.ts')), '缺少持久自动对照调度器');
  const { ComparisonScheduler } = require(modulePath);
  return { a, b, file, dir, first: new ComparisonScheduler(a), second: new ComparisonScheduler(b), close: () => { a.close(); b.close(); } };
}
function register(s, market, ids = ['A', 'B']) {
  return s.register({ market, groupId: 'group-' + market, model: 'fixed/model', instruments: ids, excluded: ['capacity-extra'] }, now);
}
test('automatic comparison defaults off and starts only at next whole hour; two connections cannot claim twice', () => {
  const f = fixture(); try {
    register(f.first, 'stocks'); assert.equal(f.first.claim('worker-a', now), null);
    f.first.setEnabled(true, now); assert.equal(f.second.claim('worker-b', now + 1), null);
    const round = f.first.claim('worker-a', now + hour); assert.equal(round.instrument, 'A');
    assert.equal(f.second.claim('worker-b', now + hour), null);
    assert.equal(f.second.list().groups[0].excluded[0], 'capacity-extra');
    f.first.finish(round, 'waiting', '报价过期；未调用模型', now + hour);
    assert.equal(f.second.claim('worker-b', now + hour + 1000), null);
    assert.equal(f.second.list().history[0].status, 'waiting');
  } finally { f.close(); }
});
test('disabled unconfigured scheduling does not create or rewrite business state on periodic checks',()=>{
 const f=fixture();try{assert.equal(f.first.claim('worker',now),null);assert.equal(f.a.get('ai-comparison-scheduler'),null);}finally{f.close();}
});
test('persistent market and instrument cursors rotate four markets without skipping or mutating frozen universes', () => {
  const f = fixture(); try {
    for (const m of ['stocks', 'options', 'crypto', 'prediction']) register(f.first, m);
    f.first.setEnabled(true, now); const observed = [];
    for (let n = 1; n <= 8; n++) {
      const s = n % 2 ? f.first : f.second, at = now + n * hour, r = s.claim('worker', at);
      observed.push([r.market, r.instrument]); s.finish(r, 'waiting', '当前来源不足', at);
    }
    assert.deepEqual(observed, ['stocks', 'options', 'crypto', 'prediction'].flatMap(m => [[m, 'A']]).concat(['stocks', 'options', 'crypto', 'prediction'].map(m => [m, 'B'])));
    assert.deepEqual(f.second.list().groups[0].instruments, ['A', 'B']);
  } finally { f.close(); }
});
test('pause and rebuild invalidate in-flight commits without changing prior accounts or history', () => {
  const f = fixture(); try {
    register(f.first, 'stocks'); f.first.setEnabled(true, now);
    const at = now + hour, r = f.first.claim('worker', at);
    f.second.pause('stocks', true, at); assert.throws(() => f.first.assertCurrent(r, at), /暂停|配置/);
    f.first.finish(r, 'cancelled', '人工暂停', at);
    f.second.register({ market: 'stocks', groupId: 'new-group', model: 'fixed/model', instruments: ['C'], excluded: [] }, at);
    assert.equal(f.second.list().archived[0].groupId, 'group-stocks');
    assert.equal(f.second.list().history[0].status, 'cancelled');
    assert.equal(f.second.list().groups[0].paused, true);
    f.second.pause('stocks', false, at); const next = f.first.claim('worker', at + hour);
    assert.equal(next.groupId, 'new-group'); assert.equal(next.instrument, 'C');
    assert.throws(() => f.first.assertCurrent(r, at + hour), /暂停|配置|租约/);
  } finally { f.close(); }
});
test('restart cannot repeat a crashed hour; lease expiration rejects late execution and records interrupted round', () => {
  const f = fixture(); try {
    register(f.first, 'crypto'); f.first.setEnabled(true, now);
    const at = now + hour, r = f.first.claim('old-worker', at);
    assert.throws(() => f.second.assertCurrent(r, at + 120001), /租约/);
    assert.equal(f.second.claim('new-worker', at + 120001), null);
    const next = f.second.claim('new-worker', at + hour);
    assert.equal(next.instrument, 'B'); assert.equal(f.first.list().history[1].status, 'cancelled');
  } finally { f.close(); }
});
test('invalid, empty or changed model configuration and corrupt state fail closed', () => {
  const f = fixture(); try {
    assert.throws(() => register(f.first, 'unknown'), /市场/);
    assert.throws(() => register(f.first, 'stocks', []), /标的/);
    assert.throws(() => f.first.register({ market: 'stocks', groupId: 'g', model: '', instruments: ['A'] }, now), /模型/);
    f.a.set('ai-comparison-scheduler', { version: 999 });
    assert.throws(() => f.first.setEnabled(true, now), /无法核验/);
  } finally { f.close(); }
});
test('independent worker processes competing for the same hour receive exactly one claim', async () => {
  const f = fixture(),workers=[]; try {
    // Claim contention targets an existing service database, not simultaneous first bootstrap.
    const bootstrap=new SQLiteStateStore(path.join(f.dir,'moneymoney.sqlite'),f.dir);bootstrap.close();
    register(f.first, 'stocks'); f.first.setEnabled(true, now);
    const { Worker } = require('node:worker_threads');
    const gate = new SharedArrayBuffer(4), source = `
      const {workerData:w,parentPort:p}=require('node:worker_threads');
      process.env.MONEYMONEY_DATA_DIR=w.dir;
      require('ts-node/register/transpile-only');
      const {SQLiteStateStore}=require(w.store),{ComparisonScheduler}=require(w.scheduler);
      const db=new SQLiteStateStore(w.file,w.dir),s=new ComparisonScheduler(db),gate=new Int32Array(w.gate);
      p.postMessage({ready:true});Atomics.wait(gate,0,0);
      try{p.postMessage({claimed:!!s.claim(w.owner,w.at)});}catch(error){p.postMessage({error:error.message});}finally{db.close();}
    `;
    let ready = 0; const outputs = await Promise.all(['one','two'].map(owner => new Promise((resolve,reject) => {
      const worker = new Worker(source, {eval:true,workerData:{owner,gate,at:now+hour,
        file:f.file,dir:f.dir,
        store:require.resolve('../src/storage/sqlite-state'),scheduler:require.resolve(modulePath)}});
      workers.push(worker);
      worker.on('message', data => { if(data.ready){if(++ready===2){Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0);}}else resolve(data); });
      worker.on('error',reject);
    })));
    assert.ok(outputs.every(r => !r.error), JSON.stringify(outputs)); assert.equal(outputs.filter(r => r.claimed).length,1);
  } finally { await Promise.all(workers.map(worker=>worker.terminate())); f.close(); }
});
test('pause during awaited preparation prevents an actual SQLite execution transaction from committing',async()=>{
 const f=fixture();try{
   const {AiRunnerTickCoordinator}=require('../src/features/ai-runner-coordinator');
   register(f.first,'stocks');f.first.setEnabled(true,Date.now()-hour);
   const round=f.first.claim('worker',Date.now());let release,ready;
   const started=new Promise(r=>ready=r),hold=new Promise(r=>release=r),executor=new AiRunnerTickCoordinator(f.a);
   const work=executor.run('comparison:'+round.groupId,round.id,async()=>{ready();await hold;return {fill:'isolated'};},data=>{
     f.first.assertCurrent(round);f.a.set('isolated-financial-commit',data);return data;
   });
   await started;f.second.pause('stocks',true);release();
   await assert.rejects(work,/暂停|配置/);assert.equal(f.b.get('isolated-financial-commit'),null);assert.equal(f.b.getIdempotent(round.id),null);
 }finally{f.close();}
});
