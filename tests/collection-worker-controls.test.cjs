const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node/register/transpile-only');
process.env.MONEYMONEY_DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(),'mm-collection-import-'));
const {DataLakeCatalog}=require('../src/storage/data-lake');
const {DataLakeBackfillWorker}=require('../src/storage/data-lake-worker');
const request={market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',from:'2026-01-01T00:00:00Z',to:'2026-03-01T00:00:00Z'};
const bars=[{time:Date.parse('2026-01-20'),open:10,high:12,low:9,close:11,volume:10},{time:Date.parse('2026-02-20'),open:11,high:13,low:10,close:12,volume:11}];
const snapshot=()=>({data:bars,source:'isolated-history',status:'live',fetchedAt:'2026-03-01T00:00:00Z',latencyMs:1});
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-collection-control-'));return {dir,catalog:new DataLakeCatalog({databasePath:path.join(dir,'catalog.sqlite'),lakeRoot:path.join(dir,'lake')})};}
function close(s){s.catalog.close();fs.rmSync(s.dir,{recursive:true,force:true});}

test('confirmed plan idempotency survives terminal jobs and rejects changed scope',()=>{
 const s=fixture();try{
  const a=s.catalog.createBackfill({...request,requestId:'collection-plan-1'});
  s.catalog.claimNextBackfill('worker');s.catalog.updateBackfill(a.id,'succeeded','done','worker');
  assert.equal(s.catalog.createBackfill({...request,requestId:'collection-plan-1'}).id,a.id);
  assert.throws(()=>s.catalog.createBackfill({...request,instrument:'SNDK',requestId:'collection-plan-1'}),/范围|冲突/);
 }finally{close(s);}
});

test('bounded worker sends frozen dates to the actual adapter instead of silently fetching recent bars',async()=>{
 const s=fixture();try{
  let received;const worker=new DataLakeBackfillWorker(s.catalog,{providers:[{id:'test',market:'stocks',datasets:['bars'],timeframes:['1d'],createAdapter:()=>({fetch:async input=>{received=input;return snapshot();}})}]});
  const job=s.catalog.createBackfill(request);await worker.runOnce();assert.equal(s.catalog.getBackfill(job.id).status,'succeeded');
  assert.equal(received.startTime,Date.parse(request.from));assert.equal(received.endTime,Date.parse(request.to));
 }finally{close(s);}
});
test('confirmed collection plans use an exclusive end without changing legacy backfill date semantics',async()=>{
 const s=fixture();try{const req={...request,to:'2026-02-20T00:00:00Z'},worker=new DataLakeBackfillWorker(s.catalog,()=>({fetch:async()=>snapshot()}));const job=s.catalog.createBackfill({...req,requestId:'exclusive-plan'});await worker.runOnce();assert.equal(s.catalog.getBackfill(job.id).checkpoint.rowsWritten,1,'end-date candle is outside the confirmed interval');
 const legacy=s.catalog.createBackfill(req);await worker.runOnce();assert.equal(s.catalog.getBackfill(legacy.id).checkpoint.rowsWritten,2,'existing inclusive interface remains compatible');
 }finally{close(s);}
});
test('pause and cancel stop late source responses; resume preserves one durable job',async()=>{
 const s=fixture();try{
  assert.equal(typeof s.catalog.controlBackfill,'function','durable collection controls are required');
  let release,started;const seen=new Promise(r=>started=r),wait=new Promise(r=>release=r);
  const worker=new DataLakeBackfillWorker(s.catalog,()=>({fetch:async()=>{started();await wait;return snapshot();}}));
  const job=s.catalog.createBackfill(request),pending=worker.runOnce();await seen;
  assert.equal(s.catalog.controlBackfill(job.id,'pause').status,'paused');release();await pending;
  assert.equal(s.catalog.getBackfill(job.id).status,'paused');assert.equal(s.catalog.listPartitions().length,0);
  const resumed=s.catalog.controlBackfill(job.id,'resume');assert.equal(resumed.id,job.id);assert.equal(resumed.status,'queued');
  s.catalog.controlBackfill(job.id,'cancel');assert.equal(await worker.runOnce(),null);
  assert.throws(()=>s.catalog.controlBackfill(job.id,'resume'),/状态|恢复/);
 }finally{close(s);}
});
test('a resumed job rejects the former claim even when two workers use the same configured owner',async()=>{
 const s=fixture();try{
  assert.equal(typeof s.catalog.controlBackfill,'function');let release,started;
  const wait=new Promise(r=>release=r),seen=new Promise(r=>started=r);
  const provider=fetch=>({providers:[{id:'isolated-history',market:'stocks',datasets:['bars'],timeframes:['1d'],createAdapter:()=>({fetch})}],workerId:'same-owner'});
  const old=new DataLakeBackfillWorker(s.catalog,provider(async()=>{started();await wait;return snapshot();}));
  const job=s.catalog.createBackfill(request),oldRun=old.runOnce();await seen;
  const oldOwner=s.catalog.getBackfill(job.id).leaseOwner;
  s.catalog.controlBackfill(job.id,'pause');s.catalog.controlBackfill(job.id,'resume');
  let secondRelease,secondStarted;const secondWait=new Promise(r=>secondRelease=r),secondSeen=new Promise(r=>secondStarted=r);
  const fresh=new DataLakeBackfillWorker(s.catalog,provider(async()=>{secondStarted();await secondWait;return snapshot();}));const freshRun=fresh.runOnce();await secondSeen;
  assert.notEqual(s.catalog.getBackfill(job.id).leaseOwner,oldOwner);
  release();await oldRun;assert.equal(s.catalog.getBackfill(job.id).status,'running');assert.equal(s.catalog.listPartitions().length,0);
  secondRelease();await freshRun;assert.equal(s.catalog.getBackfill(job.id).status,'succeeded');assert.equal(s.catalog.listPartitions().length,2);
 }finally{close(s);}
});
test('the catalog enforces one active backfill across connections and retains checkpoints',()=>{
 const s=fixture();let other;try{
  const a=s.catalog.createBackfill(request);s.catalog.createBackfill({...request,instrument:'SNDK'});
  s.catalog.claimNextBackfill('first',60000);other=new DataLakeCatalog({databasePath:path.join(s.dir,'catalog.sqlite'),lakeRoot:path.join(s.dir,'lake')});
  assert.equal(other.claimNextBackfill('second'),null,'global backfill concurrency is one');
  s.catalog.heartbeatBackfill(a.id,'first',{cursor:'2026-01-20T00:00:00Z',rowsWritten:1,partitionsCommitted:1});
  s.catalog.controlBackfill(a.id,'pause');const resume=s.catalog.controlBackfill(a.id,'resume');assert.equal(resume.checkpoint.rowsWritten,1);
 }finally{other?.close();close(s);}
});
test('publication guard is checked after parquet creation, before visible metadata is committed',async()=>{
 const s=fixture();try{
  let allowed=true,calls=0;const guard=()=>{calls++;return calls<2&&allowed;};
  await assert.rejects(s.catalog.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'isolated',publishedAt:'2026-03-01T00:00:00Z',rows:[{timestamp:'2026-01-20T00:00:00Z',open:10,high:12,low:9,close:11}]},guard),/暂停|取消|租约|发布/);
  assert.equal(s.catalog.listPartitions().length,0);
 }finally{close(s);}
});
test('expired workers cannot renew their lease or change terminal status',()=>{
 const s=fixture(),clock=Date.now;try{
  const job=s.catalog.createBackfill(request);s.catalog.claimNextBackfill('expired',1000);
  const after=clock()+5000;Date.now=()=>after;
  assert.equal(s.catalog.heartbeatBackfill(job.id,'expired'),null);
  assert.equal(s.catalog.updateBackfill(job.id,'succeeded','late','expired').status,'running');
 }finally{Date.now=clock;close(s);}
});
test('checkpoint failure cannot expose a committed partition, and retry repairs the orphan atomically',async()=>{
 const s=fixture();try{const job=s.catalog.createBackfill(request);const original=s.catalog.heartbeatBackfill.bind(s.catalog);let once=true;
 s.catalog.heartbeatBackfill=(id,owner,checkpoint,...rest)=>{if(checkpoint&&once){once=false;throw Error('isolated checkpoint failure');}return original(id,owner,checkpoint,...rest);};
 const worker=new DataLakeBackfillWorker(s.catalog,()=>({fetch:async()=>snapshot()}));await worker.runOnce();assert.equal(s.catalog.getBackfill(job.id).status,'failed');assert.equal(s.catalog.listPartitions().length,0,'publication and checkpoint must commit in one catalog transaction');
 const retry=s.catalog.createBackfill(request);await worker.runOnce();assert.equal(s.catalog.getBackfill(retry.id).status,'succeeded');assert.equal(s.catalog.listPartitions().length,2);assert.equal(s.catalog.getBackfill(retry.id).checkpoint.rowsWritten,2);
 }finally{close(s);}
});
test('heartbeat storage failure stops publication without throwing from the timer callback',async()=>{
 const s=fixture(),schedule=global.setInterval,cancel=global.clearInterval;let release;try{let callback,started;const wait=new Promise(r=>release=r),seen=new Promise(r=>started=r);global.setInterval=fn=>{callback=fn;return {unref(){}};};global.clearInterval=()=>{};
 const worker=new DataLakeBackfillWorker(s.catalog,()=>({fetch:async()=>{started();await wait;return snapshot();}})),job=s.catalog.createBackfill(request),pending=worker.runOnce();await seen;s.catalog.heartbeatBackfill=()=>{throw Error('isolated heartbeat database error');};assert.doesNotThrow(()=>callback());release();await pending;assert.equal(s.catalog.getBackfill(job.id).status,'failed');assert.equal(s.catalog.listPartitions().length,0);
 }finally{release?.();global.setInterval=schedule;global.clearInterval=cancel;close(s);}
});
