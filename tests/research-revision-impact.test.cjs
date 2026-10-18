const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');require('ts-node/register/transpile-only');
const scope={market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d'},h='a'.repeat(64),next='b'.repeat(64);
const revision=(id,hash,extra={})=>({...scope,id,partitionId:'p-'+id,contentHash:hash,dataset:'bars',publishedAt:'2026-10-01T00:00:00Z',...extra});
const revisions=[revision('old',h),revision('new',next,{supersedes:'old',publishedAt:'2026-10-10T00:00:00Z'})];
const partitions=revisions.map(r=>({...r,id:r.partitionId,periodStart:'2026-01-01',periodEnd:'2026-09-30',status:'committed'}));
const record=(id,extra={})=>({...scope,id,kind:'experiment',createdAt:'2026-10-02T00:00:00Z',snapshotHash:h,...extra});
const fixture={...scope,asOf:'2026-10-12T00:00:00Z',revisions,partitions,records:[record('exp')]};
function run(input){assert.ok(fs.existsSync('src/features/research-revision-impact.ts'),'explicit revision impact service missing');return require('../src/features/research-revision-impact').buildResearchRevisionImpact(input);}
test('revision impact requires exact lineage, market and overlapping period, excluding future revisions and independent new ranges',()=>{
 const a=run(fixture);assert.equal(a.rows[0].status,'review-required');assert.equal(a.rows[0].findings[0].revisionId,'new');assert.equal(a.orderChanges,0);
 assert.equal(run({...fixture,asOf:'2026-10-05'}).rows[0].findings.length,0);
 const p=partitions.map(r=>r.id==='p-new'?{...r,periodStart:'2026-10-01',periodEnd:'2026-10-10'}:r);
 assert.equal(run({...fixture,partitions:p}).rows[0].findings.length,0);
 for(const r of [record('legacy',{snapshotHash:null}),record('other',{market:'crypto'}),record('other',{instrument:'stock:us:SNDK'})])assert.equal(run({...fixture,records:[r]}).rows.some(x=>x.findings.length),false);
 assert.equal(run({...fixture,revisions:[revisions[0],{...revisions[1],supersedes:undefined}]}).rows[0].findings.length,0);
});
test('explicit signal and decision partition refs are supported; metadata mismatches and ambiguous refs are not repaired',()=>{
 const records=['signal','decision'].map(kind=>record(kind,{kind,snapshotHash:null,partitionRefs:[{partitionId:'p-old',hash:h}]}));
 assert.ok(run({...fixture,records}).rows.every(r=>r.status==='review-required'));
 const bad=run({...fixture,records:[record('bad',{snapshotHash:null,partitionRefs:[{partitionId:'p-old',hash:next}]})]});assert.equal(bad.rows[0].status,'unlinked');
 assert.throws(()=>run({...fixture,records:Array(501).fill(record('x'))}),/上限/);
 assert.throws(()=>run({...fixture,asOf:'invalid'}),/时点/);
 assert.equal(run({...fixture,partitions:[]}).rows[0].status,'unlinked');
 assert.equal(run({...fixture,partitions:partitions.map(p=>({...p,dataset:'news'}))}).rows[0].status,'unlinked');
 assert.equal(run({...fixture,partitions:partitions.map(p=>p.id==='p-new'?{...p,periodStart:'2026-10-01',periodEnd:'2026-01-01'}:p)}).rows[0].findings.length,0);
});

test('revision impact HTTP access is private and read-only and rejects bad IDs before catalog work',async()=>{
 assert.ok(fs.existsSync('src/web/research-revision-routes.ts'),'revision impact router missing');
 const express=require('express'),{createResearchRevisionRouter}=require('../src/web/research-revision-routes');let reads=0;
 const app=express();app.use((req,res,next)=>{req.user={role:req.headers['x-owner']};next();});app.use(createResearchRevisionRouter({load:id=>{reads++;return id==='exp'?fixture:null;}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(base+'/exp/revision-impact')).status,403);assert.equal(reads,0);
 const r=await fetch(base+'/exp/revision-impact',{headers:{'x-owner':'admin'}});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);const body=await r.json();assert.equal(body.data.rows[0].status,'review-required');
 assert.equal((await fetch(base+'/missing/revision-impact',{headers:{'x-owner':'admin'}})).status,404);
 assert.equal((await fetch(base+'/%3Cscript%3E/revision-impact',{headers:{'x-owner':'admin'}})).status,400);
 }finally{await new Promise(r=>server.close(r));}
});
