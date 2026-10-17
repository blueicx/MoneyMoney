const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');require('ts-node/register/transpile-only');
test('unified history is an opt-in action workspace control with preview confirmation and version-bound undo',()=>{
 const source=fs.readFileSync('src/web/public/action-research-workspace.js','utf8');assert.match(source,/data-unified-operations/);assert.match(source,/\/api\/operations\/history\/undo/);assert.match(source,/expectedUpdatedAt/);assert.match(source,/confirm\(/);assert.match(source,/JSON\.stringify\(context\(\)\)!==captured/);
});
test('action processing undo is recorded and rejects a stale tab or repeated restore instead of overwriting later changes',()=>{
 const {ActionCenterStore}=require('../src/features/action-center');let state={};const store={get:key=>structuredClone(state[key]??null),set:(key,value)=>{state[key]=structuredClone(value);},transaction:fn=>fn(),appendAudit:()=>{}};
 const s=new ActionCenterStore(store),item={id:'a',market:'stocks',instrument:'stock:us:AAPL',kind:'news',title:'saved',observedAt:'2026-10-17T00:00:00Z',source:'saved',dataStatus:'delayed',evidenceRefs:[]};
 const first=s.update('admin',item,{read:true},'2026-10-17T01:00:00Z'),id=s.history('admin')[0].id;
 assert.equal(typeof s.undo,'function');assert.throws(()=>s.undo('admin',id,'stale'),/变化|版本/);
 const undone=s.undo('admin',id,first.updatedAt);assert.equal(undone.read,false);assert.equal(s.history('admin')[0].undoOf,id);
 assert.throws(()=>s.undo('admin',id,first.updatedAt),/变化|版本|后续/);
});
test('operation history API denies guests before reads and exposes only known-market action records under a market filter',async()=>{
 assert.ok(fs.existsSync('src/web/operation-history-routes.ts'),'operation history router missing');
 const {createOperationHistoryRouter}=require('../src/web/operation-history-routes'),express=require('express');let reads=0;
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={role:req.headers['x-owner']==='yes'?'admin':'guest'};next();});
 app.use(createOperationHistoryRouter({actionHistory:()=>{reads++;return [{id:'a',market:'stocks',instrument:'stock:us:AAPL',itemId:'x',updatedAt:'2026-10-17T00:00:00Z',changes:{read:true}},{id:'b',market:'crypto',instrument:'crypto:binance:BTCUSDT',itemId:'y',updatedAt:'2026-10-17T00:00:00Z',changes:{read:true}}];},metadata:()=>({revision:1,history:[{id:'m',revision:1,at:'2026-10-17T00:00:00Z'}]}),undoAction:()=>({read:false}),undoMetadata:()=>({revision:2})}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(base+'?market=stocks')).status,403);assert.equal(reads,0);const body=await fetch(base+'?market=stocks',{headers:{'x-owner':'yes'}}).then(r=>r.json());assert.equal(body.data.length,1);assert.equal(body.data[0].market,'stocks');assert.equal(JSON.stringify(body).includes('previous'),false);
 const bad=await fetch(base+'/undo',{method:'POST',headers:{'x-owner':'yes','content-type':'application/json'},body:JSON.stringify({kind:'order',id:'a'})});assert.equal(bad.status,400);
 }finally{await new Promise(r=>server.close(r));}
});
