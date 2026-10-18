const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const diagnostics=require('../src/features/ai-runner-diagnostics');
const at='2026-10-01T00:00:00Z';
function observation(minutes,price,change={}){
 const time=new Date(Date.parse(at)+minutes*60000).toISOString(),hash=String(minutes+1).padStart(64,'0');
 return {runnerId:'r',accountId:'ai-runner:r',hash,decision:{id:'d'+minutes,runnerId:'r',market:'stocks',instrument:'AAPL',at:time,action:minutes?'NONE':'REJECTED',requestedIntent:{action:'BUY',side:'LONG'},evaluationBasis:{maxAgeMs:120000,feeRateBps:10,additionalSlippageBps:5},snapshotHash:hash},snapshot:{id:'rs_'+hash,hash,market:'stocks',instrument:'stock:us:AAPL',at:time,payload:{market:'stocks',instrument:'AAPL',source:'fixture',status:'delayed',dataAt:time,quote:{market:'stocks',dataAt:time,fetchedAt:time,dataStatus:'delayed',bestBid:price-1,bestAsk:price+1}}},...change};
}
test('rejected-intent path uses only same-source retained observations and separates hypothetical return from real fills',()=>{
 assert.equal(typeof diagnostics.reviewRejectedIntentPath,'function');
 const rows=[observation(0,100),observation(15,110),observation(60,90),observation(240,105)];
 const result=diagnostics.reviewRejectedIntentPath(rows[0],rows,'2026-10-01T04:00:00Z');
 assert.equal(result.hypothetical,true);assert.equal(result.orderChanges,0);assert.equal(result.modelCalls,0);
 assert.equal(result.horizons[0].dataStatus,'historical');assert.equal(result.horizons[0].exitBid,109);
 assert.ok(result.horizons[0].netReturnPct<result.horizons[0].grossReturnPct);
 assert.equal(result.horizons[3].dataStatus,'pending');assert.match(result.reason,/采样|成交/);
 assert.equal(result.observedPoints,3);assert.match(result.basisHash,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(diagnostics.reviewRejectedIntentPath(rows[0],rows,'2026-10-01T04:00:00Z')),JSON.stringify(result));
});
test('legacy missing proposal, option settlement and absent costs cannot become a known net hypothetical profit',()=>{
 assert.equal(typeof diagnostics.reviewRejectedIntentPath,'function');
 const start=observation(0,100),later=observation(15,110),now='2026-10-01T01:00:00Z';
 assert.equal(diagnostics.reviewRejectedIntentPath({...start,decision:{...start.decision,requestedIntent:undefined}},[start,later],now).dataStatus,'unavailable');
 assert.equal(diagnostics.reviewRejectedIntentPath({...start,decision:{...start.decision,market:'options'}},[start,later],now).dataStatus,'unsupported');
 const missing={...start,decision:{...start.decision,evaluationBasis:undefined}};
 assert.equal(diagnostics.reviewRejectedIntentPath(missing,[start,later],now).dataStatus,'unavailable');
});
test('cross market/source/runner, stale, conflicting and future prices cannot satisfy a mature horizon',()=>{
 assert.equal(typeof diagnostics.reviewRejectedIntentPath,'function');
 const start=observation(0,100),future=observation(60,120),now='2026-10-01T00:15:00Z';
 const bad=observation(15,999);bad.snapshot.payload.source='other-source';
 const other=observation(15,888);other.runnerId='other';
 const stale=observation(15,777);stale.snapshot.payload.dataAt=at;
 const result=diagnostics.reviewRejectedIntentPath(start,[start,future,bad,other,stale],now);
 assert.equal(result.observedPoints,0);assert.equal(result.horizons[0].dataStatus,'unavailable');
 const duplicate=observation(15,111),conflict=observation(15,222);
 assert.equal(diagnostics.reviewRejectedIntentPath(start,[start,duplicate,conflict],now).horizons[0].dataStatus,'unavailable');
});
test('private replay reads verified unfilled observations and returns no hypothetical result for a missing proposal',async()=>{
 const express=require('express'),{createAiRunnerDiagnosticsRouter}=require('../src/web/ai-runner-diagnostics-routes');
 const rows=[observation(0,100),observation(15,110)],app=express();let reads=0;
 app.use((req,res,next)=>{req.user={role:req.headers['x-role']==='admin'?'admin':'guest'};next();});
 app.use('/api/ai-runners',createAiRunnerDiagnosticsRouter({runner:()=>({id:'r',market:'stocks'}),history:()=>({data:rows.map(r=>r.decision)}),signal:()=>null,snapshot:()=>null,observations:()=>{reads++;return rows;}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/api/ai-runners/r/history/d0/replay';
 try{
  assert.equal((await fetch(url)).status,403);assert.equal(reads,0);
  const response=await fetch(url,{headers:{'x-role':'admin'}});assert.match(response.headers.get('cache-control'),/no-store/);const result=await response.json();
  assert.equal(result.dataStatus,'historical');assert.equal(result.data.decision.action,'REJECTED');
  assert.equal(result.rejectedPath.hypothetical,true);assert.equal(result.rejectedPath.horizons[0].exitBid,109);
  assert.equal(result.evidenceGraph.nodes.find(n=>n.kind==='order').status,'unlinked');assert.equal(reads,1);
 }finally{await new Promise(r=>server.close(r));}
});
