const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
function fixture(){const runner={id:'r',venue:'Stocks',accountId:'ai-runner:r',status:'STOPPED',manualPaused:true,circuitBreakerReason:'user pause',stoppedAt:'2026-10-01T00:00:00Z',executionState:'ready',budgetUsd:1000,cashUsd:1000,positions:[],trades:[],policy:{maxTradeUsd:100,maxBudgetUsd:1000,maxDailyLossUsd:100,maxDrawdownPct:20,minFreshnessMs:120000},universe:{market:'stocks',hash:'fixed',kind:'single',instruments:[{venue:'Stocks',symbolOrMarketId:'AAPL'}]},lastDataStatus:'stale'};
 const account={accountId:runner.accountId,runnerId:'r',startingCash:1000,cash:1000,positions:[],orders:[],realizedPnl:0,peakEquity:1000,maxDrawdownPct:0};return {runner,account};}
test('recovery requires explicit confirmation and unchanged reviewed ledger/configuration; retries do not resume again',()=>{
 const {AiRunnerRecovery}=require('../src/features/ai-runner-recovery');assert.equal(typeof AiRunnerRecovery,'function');
 const {runner,account}=fixture(),map=new Map();let resumes=0,audits=0;
 const service=new AiRunnerRecovery({transaction:f=>f(),getIdempotent:k=>map.get(k)||null,setIdempotent:(k,v)=>map.set(k,v),appendAudit:()=>audits++},{runner:()=>runner,account:()=>account,enabled:()=>true,resume:()=>{resumes++;runner.status='RUNNING';return runner;}});
 const now='2026-10-01T01:00:00Z',preview=service.preview('r',now),config=JSON.stringify(runner.policy);
 assert.equal(preview.canResume,true);assert.match(preview.warnings.join(' '),/过期|新鲜/);assert.equal(resumes,0);
 const body={expectedHash:preview.reviewHash,reviewedAt:now,confirmed:true};
 assert.throws(()=>service.confirm('r',{...body,confirmed:false},now),/确认/);assert.equal(resumes,0);
 account.cash=999;assert.throws(()=>service.confirm('r',body,now),/变化|不一致/);account.cash=1000;
 const saved=service.confirm('r',body,now);assert.equal(saved.status,'resumed');assert.equal(resumes,1);assert.equal(audits,1);assert.equal(JSON.stringify(runner.policy),config);
 assert.equal(service.confirm('r',body,now).status,'duplicate');assert.equal(resumes,1);
});
test('legacy, circuit breaks, foreign accounts, controlled groups and expired reviews fail closed',()=>{
 const {AiRunnerRecovery}=require('../src/features/ai-runner-recovery');assert.equal(typeof AiRunnerRecovery,'function');
 for(const change of [{executionState:'legacy-readonly'},{manualPaused:false,circuitBreakerReason:'drawdown'},{comparisonControl:{groupId:'g'}},{cashUsd:900}]){
  const {runner,account}=fixture();Object.assign(runner,change);const service=new AiRunnerRecovery({transaction:f=>f(),getIdempotent:()=>null,setIdempotent:()=>{},appendAudit:()=>{}},{runner:()=>runner,account:()=>account,enabled:()=>true,resume:()=>{throw Error('must not resume');}});
  assert.equal(service.preview('r','2026-10-01T01:00:00Z').canResume,false);
 }
 const {runner,account}=fixture(),service=new AiRunnerRecovery({transaction:f=>f(),getIdempotent:()=>null,setIdempotent:()=>{},appendAudit:()=>{}},{runner:()=>runner,account:()=>account,enabled:()=>true,resume:()=>{throw Error('must not resume');}});
 const p=service.preview('r','2026-10-01T01:00:00Z');assert.throws(()=>service.confirm('r',{expectedHash:p.reviewHash,reviewedAt:p.reviewedAt,confirmed:true},'2026-10-01T01:06:00Z'),/过期/);
 account.runnerId='other';assert.equal(service.preview('r','2026-10-01T01:00:00Z').canResume,false);
});
test('matching quantities from another market cannot pass reconciliation',()=>{
 const {AiRunnerRecovery}=require('../src/features/ai-runner-recovery'),{runner,account}=fixture();
 runner.positions=[{id:'p',instrumentId:'crypto:binance:BTCUSDT',quantity:1,status:'OPEN'}];account.positions=[{instrumentId:'crypto:binance:BTCUSDT',quantity:1,instrumentType:'crypto'}];
 const service=new AiRunnerRecovery({transaction:f=>f(),getIdempotent:()=>null,setIdempotent:()=>{},appendAudit:()=>{}},{runner:()=>runner,account:()=>account,enabled:()=>true,resume:()=>null});
 assert.equal(service.preview('r','2026-10-01T01:00:00Z').canResume,false);
});
test('matching quantities cannot conceal an unsupported short or contradictory position type',()=>{
 const {AiRunnerRecovery}=require('../src/features/ai-runner-recovery'),{runner,account}=fixture();
 runner.positions=[{id:'p',instrumentId:'stock:us:AAPL',quantity:1,status:'OPEN',side:'SHORT'}];account.positions=[{instrumentId:'stock:us:AAPL',quantity:1,instrumentType:'stock'}];
 const service=new AiRunnerRecovery({transaction:f=>f(),getIdempotent:()=>null,setIdempotent:()=>{},appendAudit:()=>{}},{runner:()=>runner,account:()=>account,enabled:()=>true,resume:()=>null});
 assert.equal(service.preview('r','2026-10-01T01:00:00Z').canResume,false);
 runner.positions[0].side='LONG';account.positions[0].instrumentType='crypto';assert.equal(service.preview('r','2026-10-01T01:00:00Z').canResume,false);
});
test('recovery HTTP endpoints require private owner access and explicit confirmation',async()=>{
 const express=require('express'),{createAiRunnerRecoveryRouter}=require('../src/web/ai-runner-recovery-routes');assert.equal(typeof createAiRunnerRecoveryRouter,'function');
 let confirmed=0;const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={role:req.headers['x-role']==='admin'?'admin':'guest'};next();});
 app.use('/api/ai-runners',createAiRunnerRecoveryRouter({preview:()=>({canResume:true}),confirm:(_id,body)=>{if(body.confirmed!==true)throw Error('必须确认');confirmed++;return {status:'resumed'};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/ai-runners/r/recovery';
 try{
  assert.equal((await fetch(base)).status,403);assert.equal((await fetch(base,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
  const response=await fetch(base,{headers:{'x-role':'admin'}});assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.status,200);assert.equal(confirmed,0);
  assert.equal((await fetch(base,{method:'POST',headers:{'x-role':'admin','content-type':'application/json'},body:'{}'})).status,409);assert.equal(confirmed,0);
 }finally{await new Promise(r=>server.close(r));}
});
