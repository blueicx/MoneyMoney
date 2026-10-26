const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),http=require('node:http');require('ts-node/register/transpile-only');
async function serverFor(router){const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={role:req.headers['x-role']};next();});app.use(router);const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {base:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};}
const adminOnly=(req,res)=>{if(req.user?.role==='admin')return true;res.status(403).json({success:false,reason:'admin required'});return false;};

test('proof and recapture routes enforce admin, CSRF, and server-owned evidence fields',async()=>{
 const {createResearchEvidenceGovernanceRouter}=require('../src/web/research-evidence-governance-routes');let associates=0;
 const service={listSnapshots:()=>[],proof:async input=>({market:input.market,instrument:input.instrument,dataStatus:'unavailable',reason:'unknown',evidenceRefs:[],snapshot:{id:input.snapshotId}}),recaptures:()=>({market:'stocks',spaceVersion:0,records:[]}),associateRecapture:async input=>{associates++;return {...input,contentHash:'a'.repeat(64)};}};
 const server=await serverFor(createResearchEvidenceGovernanceRouter({service,adminOnly,csrfValid:req=>req.headers['x-csrf']==='ok'}));
 try{assert.equal((await fetch(server.base+'/proof?market=stocks&instrument=stock:us:AAPL&timeframe=1d&snapshotId=s1')).status,403);
  const valid={projectId:'project_x',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',originalSnapshotId:'s1',recapturedSnapshotId:'s2',reason:'explicit link',expectedVersion:0,idempotencyKey:'recapture-key-0001'};
  assert.equal((await fetch(server.base+'/recaptures',{method:'POST',headers:{'Content-Type':'application/json','x-role':'admin','x-csrf':'bad'},body:JSON.stringify(valid)})).status,403);
  const forged=await fetch(server.base+'/recaptures',{method:'POST',headers:{'Content-Type':'application/json','x-role':'admin','x-csrf':'ok'},body:JSON.stringify({...valid,fileHash:'f'.repeat(64)})});assert.equal(forged.status,400);assert.equal(associates,0);
  const good=await fetch(server.base+'/recaptures',{method:'POST',headers:{'Content-Type':'application/json','x-role':'admin','x-csrf':'ok'},body:JSON.stringify(valid)});assert.equal(good.status,201);assert.equal(associates,1);
 }finally{await server.close();}
});

test('preregistration route rejects caller supplied outcomes and requires admin plus CSRF',async()=>{
 const {createResearchPreregistrationRouter}=require('../src/web/research-preregistration-routes');let registered=0;
 const service={list:()=>({projectId:'p',market:'stocks',spaceVersion:0,registrations:[]}),register:input=>{registered++;return {...input,id:'pr1',market:'stocks',contentHash:'b'.repeat(64)};},associateSavedExperiments:()=>({market:'stocks'})};
 const server=await serverFor(createResearchPreregistrationRouter({service,adminOnly,csrfValid:req=>req.headers['x-csrf']==='ok'}));const body={market:'stocks',expectedVersion:0,idempotencyKey:'prereg-key-0001',hypothesis:'h',primaryMetric:'m',sampleDefinition:'s',stopCondition:'c',parameterBudget:{feeRate:{min:0,max:.01,steps:5}},fixedReferenceLinkIds:['l1']};
 try{const url=server.base+'/p';assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-role':'admin','x-csrf':'ok'},body:JSON.stringify({...body,result:{returnPct:99}})})).status,400);assert.equal(registered,0);
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-role':'admin','x-csrf':'bad'},body:JSON.stringify(body)})).status,403);
  const good=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-role':'admin','x-csrf':'ok'},body:JSON.stringify(body)});assert.equal(good.status,201);assert.equal(registered,1);
 }finally{await server.close();}
});

test('graph SVG route has accessible title and description while preserving admin-only access',async()=>{
 const {createResearchEvidenceGraphRouter}=require('../src/web/research-evidence-graph-routes'),project={id:'p',market:'stocks',title:'<saved>',version:1,links:[],conclusions:[]};
 const server=await serverFor(createResearchEvidenceGraphRouter({projects:{read:()=>project,referenceStates:()=>[]},adminOnly}));
 try{assert.equal((await fetch(server.base+'/p/graph.svg?market=stocks')).status,403);const response=await fetch(server.base+'/p/graph.svg?market=stocks',{headers:{'x-role':'admin'}});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/svg\+xml/);const svg=await response.text();assert.match(svg,/aria-labelledby="graph-title graph-desc"/);assert.match(svg,/&lt;saved&gt;/);assert.match(svg,/<desc/);}finally{await server.close();}
});
