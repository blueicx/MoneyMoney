const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');require('ts-node/register/transpile-only');
const h=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){
 const input={market:'stocks',allowedInstruments:['AAPL'],snapshots:[{market:'stocks',instrument:'AAPL',price:100}]},output={market:'stocks',instrument:'AAPL',action:'HOLD',confidence:.5,rationale:'saved summary',counterEvidence:[],riskNotes:[]};
 return {runnerId:'r',accountId:'ai-runner:r',hash:'a'.repeat(64),snapshot:{id:'rs_'+'b'.repeat(64),hash:'b'.repeat(64),market:'stocks',instrument:'stock:us:AAPL',payload:{market:'stocks',instrument:'AAPL'}},decision:{id:'d',runnerId:'r',market:'stocks',instrument:'AAPL',at:'2026-10-01T00:00:00Z',snapshotHash:'b'.repeat(64),action:'REVIEW',modelVersion:'fixed/v1',modelCallStatus:'success',modelRequestRef:'request-1',modelEvidence:{requestedModel:'fixed/v1',returnedModel:'fixed/v1',promptVersion:'intent-v1',promptHash:h('public prompt'),inputHash:h(input),outputHash:h(output),input,output}}};
}
test('sandbox freezes original fixed-model/version output and survives restart without model calls or account changes',()=>{
 const mod=require('../src/features/ai-runner-sandbox');assert.equal(typeof mod.AiRunnerSandboxStore,'function');
 const {SQLiteStateStore}=require('../src/storage/sqlite-state'),root=fs.mkdtempSync(path.join(os.tmpdir(),'mm-runner-sandbox-')),file=path.join(root,'state.sqlite');let db=new SQLiteStateStore(file,root),store=new mod.AiRunnerSandboxStore(db),row=fixture();
 const config={runnerId:'r',market:'stocks',model:'fixed/v1',promptVersion:'intent-v1',name:'Fixed saved replay',decisionIds:['d']};
 try{
  const before=JSON.stringify(row),saved=store.create(config,[row],'2026-10-02T00:00:00Z');assert.equal(saved.modelCalls,0);assert.equal(saved.orderChanges,0);assert.equal(saved.rounds[0].modelEvidence.output.action,'HOLD');
  assert.equal(store.create(config,[row],'2026-10-03T00:00:00Z').id,saved.id,'identical frozen research is idempotent');assert.equal(JSON.stringify(row),before);
  db.close();db=new SQLiteStateStore(file,root);store=new mod.AiRunnerSandboxStore(db);assert.equal(store.list('r','stocks')[0].id,saved.id);assert.equal(store.list('other','stocks').length,0);
 }finally{db.close();}
});
test('sandbox refuses dynamic model routes, mismatched versions, missing outputs and future decisions',()=>{
 const {AiRunnerSandboxStore}=require('../src/features/ai-runner-sandbox');assert.equal(typeof AiRunnerSandboxStore,'function');
 const map=new Map(),store=new AiRunnerSandboxStore({get:k=>map.get(k)||null,set:(k,v)=>map.set(k,v),transaction:f=>f()}),row=fixture(),config={runnerId:'r',market:'stocks',model:'fixed/v1',promptVersion:'intent-v1',name:'test',decisionIds:['d']};
 for(const model of ['openrouter/free','openrouter/auto'])assert.throws(()=>store.create({...config,model},[row],'2026-10-02T00:00:00Z'),/固定|动态/);
 for(const mutate of [r=>r.decision.modelEvidence.output.action='BUY',r=>r.decision.modelEvidence.promptVersion='other',r=>r.decision.modelEvidence=undefined,r=>r.runnerId='other',r=>r.decision.at='2027-01-01T00:00:00Z']){
  const copy=structuredClone(row);mutate(copy);assert.throws(()=>store.create(config,[copy],'2026-10-02T00:00:00Z'),/证据|版本|时点|关联/);
 }
 assert.equal(map.size,0);
});
test('sandbox routes are private, reject runtime configuration fields and scope saved outputs to the URL runner',async()=>{
 const express=require('express'),{AiRunnerSandboxStore}=require('../src/features/ai-runner-sandbox'),{createAiRunnerDiagnosticsRouter}=require('../src/web/ai-runner-diagnostics-routes');
 const map=new Map(),store=new AiRunnerSandboxStore({get:k=>map.get(k)||null,set:(k,v)=>map.set(k,v),transaction:f=>f()}),app=express();app.use(express.json());app.use((req,res,next)=>{req.user={role:req.headers['x-role']==='admin'?'admin':'guest'};next();});
 app.use('/api/ai-runners',createAiRunnerDiagnosticsRouter({runner:id=>id==='r'?{id,market:'stocks'}:null,history:()=>({data:[]}),signal:()=>null,snapshot:()=>null,observations:()=>[fixture()],sandboxes:store}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/ai-runners/r/sandboxes',headers={'x-role':'admin','content-type':'application/json'},config={model:'fixed/v1',promptVersion:'intent-v1',name:'saved replay',decisionIds:['d']};
 try{
  assert.equal((await fetch(base)).status,403);assert.equal((await fetch(base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(config)})).status,403);
  assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify({...config,budget:9999})})).status,400);
  const response=await fetch(base,{method:'POST',headers,body:JSON.stringify(config)});assert.equal(response.status,201);assert.equal((await response.json()).data.modelCalls,0);
  const list=await fetch(base,{headers});assert.match(list.headers.get('cache-control'),/no-store/);assert.equal((await list.json()).data.length,1);
 }finally{await new Promise(r=>server.close(r));}
});
