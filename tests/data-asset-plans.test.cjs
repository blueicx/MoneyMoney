const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node/register/transpile-only');
process.env.MONEYMONEY_DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(),'mm-assets-import-'));
const {DataLakeCatalog}=require('../src/storage/data-lake');
const {SQLiteStateStore}=require('../src/storage/sqlite-state');
const {DataLakeBackfillWorker}=require('../src/storage/data-lake-worker');
const scope={market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',from:'2026-01-01T00:00:00Z',to:'2026-01-04T00:00:00Z'};
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-assets-'));const catalog=new DataLakeCatalog({databasePath:path.join(dir,'catalog.sqlite'),lakeRoot:path.join(dir,'lake')});const state=new SQLiteStateStore(path.join(dir,'state.sqlite'),dir);return {dir,catalog,state,close(){state.close();catalog.close();fs.rmSync(dir,{recursive:true,force:true});}};}
function service(s,now=()=>Date.parse('2026-10-20T00:00:00Z')){let Service;try{Service=require('../src/features/data-assets').DataAssetService;}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}assert.equal(typeof Service,'function','data asset plans must use the existing catalog and worker');return new Service(s.catalog,s.state,new DataLakeBackfillWorker(s.catalog),now);}

test('preview freezes explicit identity without starting collection; confirmation is durable and idempotent',()=>{
 const s=fixture();try{const a=service(s),p=a.preview(scope);assert.equal(p.instrument,'stock:us:AAPL');assert.equal(p.provider,'yahoo-finance-history');assert.ok(p.estimates.maxRequests>0);assert.ok(p.estimates.storageBytes>0);assert.equal(s.catalog.listBackfills().length,0);
 assert.throws(()=>a.confirm(p.id,'changed-hash'),/预览|Hash/);const job=a.confirm(p.id,p.hash);assert.equal(job.instrument,'AAPL');assert.equal(job.status,'queued');s.catalog.claimNextBackfill('test');s.catalog.updateBackfill(job.id,'succeeded','done','test');
 const restarted=service(s);assert.equal(restarted.confirm(p.id,p.hash).id,job.id);assert.equal(s.catalog.listBackfills().length,1);assert.equal(restarted.control(p.id,'pause').status,'succeeded');
 }finally{s.close();}
});
test('ambiguous scope, wrong venue, unsupported markets and overlarge windows fail closed',()=>{
 const s=fixture();try{const a=service(s);for(const bad of [{instrument:'AAPL'},{instrument:'crypto:binance:BTCUSDT'},{instrument:'stock:hk:AAPL'},{timeframe:'5y'},{market:'options',instrument:'option:cboe:AAPL'},{market:'crypto',instrument:'crypto:binance:BTCUSDT',timeframe:'1m'}])assert.throws(()=>a.preview({...scope,...bad}),/身份|市场|场所|支持|范围|上限/);
 assert.equal(s.catalog.listBackfills().length,0);
 }finally{s.close();}
});
test('expired previews and capacity changes cannot start a task',()=>{
 const s=fixture();const before=process.env.MONEYMONEY_DATA_LAKE_MAX_BYTES;try{let now=Date.parse('2026-10-20T00:00:00Z');const a=service(s,()=>now),p=a.preview(scope);now+=11*60000;assert.throws(()=>a.confirm(p.id,p.hash),/过期/);now-=11*60000;const q=a.preview(scope);process.env.MONEYMONEY_DATA_LAKE_MAX_BYTES='1';assert.throws(()=>a.confirm(q.id,q.hash),/容量|预算/);assert.equal(s.catalog.listBackfills().length,0);
 }finally{if(before===undefined)delete process.env.MONEYMONEY_DATA_LAKE_MAX_BYTES;else process.env.MONEYMONEY_DATA_LAKE_MAX_BYTES=before;s.close();}
});
test('unknown free space and writes exceeding filesystem reserve block preview and confirmation',()=>{
 const s=fixture();try{const a=service(s),original=s.catalog.getDiagnostics.bind(s.catalog),p=a.preview(scope);
  s.catalog.getDiagnostics=()=>({...original(),filesystem:{state:'unknown',freeBytes:null,totalBytes:null,reserveBytes:512*1024**2}});
  assert.throws(()=>a.preview(scope),/容量|余量|预算/);assert.throws(()=>a.confirm(p.id,p.hash),/容量|余量|预算/);
  s.catalog.getDiagnostics=()=>({...original(),filesystem:{state:'warning',freeBytes:512*1024**2+1000,totalBytes:1024**3,reserveBytes:512*1024**2}});
  assert.throws(()=>a.confirm(p.id,p.hash),/容量|余量|预算/);assert.equal(s.catalog.listBackfills().length,0);
 }finally{s.close();}
});
test('manual plan history restores persisted jobs within the exact market instrument and timeframe',()=>{
 const s=fixture();try{const a=service(s);assert.equal(typeof a.list,'function','plan history must survive reload');const p=a.preview(scope),job=a.confirm(p.id,p.hash);a.control(p.id,'pause');
  const restored=service(s).list(scope);assert.equal(restored.length,1);assert.equal(restored[0].id,p.id);assert.equal(restored[0].job.id,job.id);assert.equal(restored[0].job.status,'paused');
  assert.equal(a.list({...scope,instrument:'stock:us:SNDK'}).length,0);assert.equal(a.list({...scope,timeframe:'5m'}).length,0);assert.equal(a.list({...scope,market:'crypto',instrument:'crypto:binance:BTCUSDT'}).length,0);
 }finally{s.close();}
});
test('asset projection uses real partition evidence and never exposes physical paths',async()=>{
 const s=fixture();try{const a=service(s);await s.catalog.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'isolated-history',publishedAt:'2026-01-03T00:00:00Z',rows:[{timestamp:'2026-01-02T00:00:00Z',open:10,high:12,low:9,close:11,volume:1}]});
 const result=a.assets({...scope});assert.equal(result.instrument,'stock:us:AAPL');assert.equal(result.dataStatus,'historical');assert.equal(result.data.coverage[0].rowCount,1);assert.equal(result.data.partitions[0].source,'isolated-history');assert.ok(!JSON.stringify(result).includes(s.dir));assert.equal(a.assets({...scope,instrument:'stock:us:SNDK'}).dataStatus,'empty');
 assert.equal(a.assets({...scope,instrument:'stock:hk:AAPL'}).data.coverage.length,0,'same raw symbol at another venue must not reuse US partitions');
 }finally{s.close();}
});
test('options asset coverage reads its canonical chain identity, not an ambiguous underlying ticker',()=>{
 const s=fixture();try{const fetchedAt='2026-09-27T14:00:00.000Z';s.catalog.saveOptionsChainSnapshot({market:'options',instrument:'option:cboe:AAPL',underlyingMarket:'stocks',source:'CBOE Delayed Quotes',fetchedAt,mode:'manual',snapshot:{source:'CBOE Delayed Quotes',market:'us_equity',asset:'AAPL',fetchedAt,expiries:[{expiryMs:Date.UTC(2026,8,30,20),rows:[{instrumentName:'AAPL260930C00100000',strike:100,optionType:'call'}]}]}});
 const result=service(s).assets({market:'options',instrument:'option:cboe:AAPL',timeframe:'snapshot'});assert.equal(result.dataStatus,'historical');assert.equal(result.data.coverage[0].availableRowCount,1);assert.equal(result.data.optionSnapshots[0].source,'CBOE Delayed Quotes');assert.equal(result.evidenceRefs.length,1);assert.ok(!JSON.stringify(result).includes(s.dir));assert.equal(service(s).assets({market:'options',instrument:'option:cboe:SNDK',timeframe:'snapshot'}).dataStatus,'empty');
 }finally{s.close();}
});

test('asset routes are private, no-store, scoped and never enqueue on GET or preview',async()=>{
 const s=fixture();let server;try{
  assert.ok(fs.existsSync(path.resolve('src/web/data-asset-routes.ts')),'private data assets API must be wired');
  const {createDataAssetRouter}=require('../src/web/data-asset-routes'),express=require('express'),app=express();app.use(express.json());app.use((req,res,next)=>{req.user={role:req.headers['x-role']};next();});app.use(createDataAssetRouter(service(s)));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/assets?'+new URLSearchParams(scope))).status,403);
  assert.equal((await fetch(base+'/collection-plans',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(scope)})).status,403);
  const headers={'x-role':'admin','content-type':'application/json'},read=await fetch(base+'/assets?'+new URLSearchParams(scope),{headers});assert.equal(read.status,200);assert.match(read.headers.get('cache-control'),/no-store/);assert.equal((await read.json()).market,'stocks');
  const preview=await fetch(base+'/collection-plans',{method:'POST',headers,body:JSON.stringify(scope)}).then(r=>r.json());assert.equal(s.catalog.listBackfills().length,0);assert.ok(preview.data.hash);
  const confirmed=await fetch(base+`/collection-plans/${preview.data.id}/confirm`,{method:'POST',headers,body:JSON.stringify({hash:preview.data.hash})});assert.equal(confirmed.status,200);assert.equal(s.catalog.listBackfills().length,1);
  const paused=await fetch(base+`/collection-plans/${preview.data.id}/control`,{method:'POST',headers,body:JSON.stringify({action:'pause'})}).then(r=>r.json());assert.equal(paused.data.status,'paused');
  assert.equal((await fetch(base+`/collection-plans/${preview.data.id}/control`,{method:'POST',headers,body:JSON.stringify({action:'invented'})})).status,400);
  const serverSource=fs.readFileSync('src/web/server.ts','utf8');assert.ok(serverSource.indexOf('registerApiAuthProtection(app);')<serverSource.indexOf("app.use('/api/data',createDataAssetRouter"));
 }finally{if(server)await new Promise(r=>server.close(r));s.close();}
});
