const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');require('ts-node/register/transpile-only');
const scope={market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d'},hash='a'.repeat(64);
function setup(){assert.ok(fs.existsSync('src/features/research-basis.ts'),'research basis service missing');const {ResearchBasisStore}=require('../src/features/research-basis'),{SQLiteStateStore}=require('../src/storage/sqlite-state'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-basis-')),file=path.join(dir,'state.sqlite'),a=new SQLiteStateStore(file,dir),b=new SQLiteStateStore(file,dir);const options=[{...scope,id:'part-1',contentHash:hash,source:'provider-a',publishedAt:'2026-10-01',fetchedAt:'2026-10-02',timezone:'America/New_York',adjustment:'source',fieldVersion:'bars-v1',units:{close:'USD'},status:'committed',qualityValid:true},{...scope,id:'quarantined',contentHash:hash,source:'provider-b',status:'rejected',qualityValid:true}];return {a,b,dir,options,left:new ResearchBasisStore(a,()=>options),right:new ResearchBasisStore(b,()=>options)};}
test('basis selections are explicit, revision-checked, immutable audit records across connections and restarts',()=>{
 const s=setup();try{assert.equal(s.left.read(scope).revision,0);const chosen=s.left.select({...scope,revision:0,partitionId:'part-1',reason:'核对币种、来源与复权口径后用于本次研究',asOf:'2026-10-10'});assert.equal(chosen.revision,1);assert.equal(chosen.records[0].contentHash,hash);assert.equal(chosen.records[0].source,'provider-a');assert.equal(chosen.records[0].instrument,scope.instrument);assert.equal(s.right.read(scope).records.length,1);assert.throws(()=>s.right.select({...scope,revision:0,partitionId:'part-1',reason:'stale',asOf:'2026-10-10'}),/版本/);assert.equal(s.a.listAudits().length,1);assert.equal(s.left.read({...scope,instrument:'stock:us:SNDK'}).records.length,0);
 }finally{s.a.close();s.b.close();fs.rmSync(s.dir,{recursive:true,force:true});}
});
test('basis cannot publish quarantined data, accept an invented provider, cross market, future publication or missing reason',()=>{
 const s=setup();try{const input={...scope,revision:0,partitionId:'part-1',reason:'explicit',asOf:'2026-10-10'};
 for(const value of [{partitionId:'quarantined'},{partitionId:'invented'},{reason:''},{asOf:'2026-09-01'},{market:'crypto'},{source:'override-provider'}])assert.throws(()=>s.left.select({...input,...value}));
 assert.equal(s.left.read(scope).revision,0);assert.equal(s.a.listAudits().length,0);assert.equal(s.options[1].status,'rejected');
 }finally{s.a.close();s.b.close();fs.rmSync(s.dir,{recursive:true,force:true});}
});

test('catalog basis evidence is real persisted partition metadata without filesystem paths and keeps unit/adjustment/time identity',async()=>{
 const {DataLakeCatalog}=require('../src/storage/data-lake'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-basis-catalog-')),catalog=new DataLakeCatalog({databasePath:path.join(dir,'catalog.sqlite'),lakeRoot:path.join(dir,'lake')});
 try{assert.equal(typeof catalog.listPartitionEvidence,'function');await catalog.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'isolated-source',publishedAt:'2026-10-02T00:00:00Z',timezone:'America/New_York',adjustment:'source',units:{close:'USD'},rows:[{timestamp:'2026-10-01T00:00:00Z',open:1,high:2,low:.5,close:1,volume:2}]});
 const rows=catalog.listPartitionEvidence('stocks','AAPL','1d');assert.equal(rows.length,1);assert.equal(rows[0].source,'isolated-source');assert.equal(rows[0].timezone,'America/New_York');assert.equal(rows[0].adjustment,'source');assert.equal(rows[0].qualityValid,true);assert.equal('path' in rows[0],false);assert.equal(catalog.listPartitionEvidence('crypto','AAPL','1d').length,0);
 }finally{catalog.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('basis router protects private history and does not silently accept cross-market or stale selections',async()=>{
 assert.ok(fs.existsSync('src/web/research-basis-routes.ts'),'basis API missing');const {createResearchBasisRouter}=require('../src/web/research-basis-routes'),express=require('express'),s=setup();
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={role:req.headers['x-role']};next();});app.use(createResearchBasisRouter(s.left,()=>[]));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(base+'?'+new URLSearchParams(scope))).status,403);const r=await fetch(base+'?'+new URLSearchParams(scope),{headers:{'x-role':'admin'}});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal((await r.json()).data.revision,0);
 const body={...scope,revision:0,partitionId:'part-1',reason:'explicit chosen basis',asOf:'2026-10-10'};const post=()=>fetch(base,{method:'POST',headers:{'x-role':'admin','content-type':'application/json'},body:JSON.stringify(body)});assert.equal((await post()).status,200);assert.equal((await post()).status,409);assert.equal((await fetch(base+'?market=crypto&instrument=stock:us:AAPL&timeframe=1d',{headers:{'x-role':'admin'}})).status,400);
 }finally{await new Promise(r=>server.close(r));s.a.close();s.b.close();fs.rmSync(s.dir,{recursive:true,force:true});}
});
test('basis API distinguishes an empty catalog from a recorded source conflict',async()=>{
 const {createResearchBasisRouter}=require('../src/web/research-basis-routes'),express=require('express');let conflicts=[];const app=express();app.use((req,res,next)=>{req.user={role:'admin'};next();});app.use(createResearchBasisRouter({read:()=>({records:[],options:[],reason:'暂无分区'})},()=>conflicts));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{const url='http://127.0.0.1:'+server.address().port+'?'+new URLSearchParams(scope);assert.equal((await fetch(url).then(r=>r.json())).dataStatus,'empty');conflicts=[{id:'c',reason:'原始收盘冲突'}];assert.equal((await fetch(url).then(r=>r.json())).dataStatus,'partial');}finally{await new Promise(r=>server.close(r));}
});
