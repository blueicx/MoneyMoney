import express from 'express';
import type { AiRunnerDecisionRecord, AiRunnerPosition } from '../features/ai-paper-runner';
import { reviewAiRunnerDecisions, buildSavedDecisionComparison, buildDecisionEvidenceGraph, reviewRejectedIntentPath } from '../features/ai-runner-diagnostics';
import type { VerifiedExecutionEvidence, RunnerDecisionObservation } from '../features/runner-execution-evidence';
import type { AiRunnerSandboxStore } from '../features/ai-runner-sandbox';
interface Dependencies {
  runner(id:string):{id:string;market:string}|null;
  history(id:string,cursor:string|undefined,limit:number):{data:AiRunnerDecisionRecord[];nextCursor?:string|null};
  signal(id:string):{runnerId:string;decision:AiRunnerDecisionRecord;snapshotIds:string[]}|null;
  snapshot(id:string):{id:string;hash:string;market:string;payload:Record<string,any>}|null;
  closedPositions?(id:string):AiRunnerPosition[];
  execution?(decision:AiRunnerDecisionRecord):VerifiedExecutionEvidence|null;
  observations?(id:string):RunnerDecisionObservation[];
  sandboxes?:Pick<AiRunnerSandboxStore,'list'|'create'>;
}
export function createAiRunnerDiagnosticsRouter(deps:Dependencies) {
  const router=express.Router();
  router.use('/:id/diagnostics',privateRead);router.use('/:id/history/:decisionId/replay',privateRead);
  router.use('/:id/sandboxes',privateRead);
  function privateRead(req:express.Request,res:express.Response,next:express.NextFunction){res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'仅管理员可读取跑单诊断及保存快照'});return;}next();}
  function history(id:string){const rows:AiRunnerDecisionRecord[]=[];let cursor:string|undefined;let pages=0;do{const page=deps.history(id,cursor,200);rows.push(...page.data);cursor=page.nextCursor||undefined;}while(cursor&&++pages<10);return {rows,truncated:Boolean(cursor)};}
  router.get('/:id/sandboxes',(req,res)=>{
    const runner=deps.runner(String(req.params.id));if(!runner){res.status(404).json({success:false,reason:'跑单不存在'});return;}
    const rows=deps.sandboxes?.list(runner.id,runner.market)||[];
    res.json({success:true,market:runner.market,runnerId:runner.id,data:rows,dataStatus:rows.length?'historical':'empty',source:'SQLite固定模型保存输出',updatedAt:new Date().toISOString(),reason:'独立只读实验，不新增模型调用或订单，不改变运行配置；空列表表示尚无可核验固定版本实验',modelCalls:0,orderChanges:0,evidenceRefs:rows.map(row=>row.id)});
  });
  router.post('/:id/sandboxes',(req,res)=>{
    const runner=deps.runner(String(req.params.id));if(!runner){res.status(404).json({success:false,reason:'跑单不存在'});return;}
    try{
      if(!deps.sandboxes||!req.body||Object.keys(req.body).some(key=>!['model','promptVersion','name','decisionIds'].includes(key)))throw Error('只能冻结已保存的模型证据，不能提交预算、订单或运行配置');
      const data=deps.sandboxes.create({...req.body,runnerId:runner.id,market:runner.market},deps.observations?.(runner.id)||[]);
      res.status(201).json({success:true,market:runner.market,runnerId:runner.id,data,dataStatus:'historical',source:'SQLite固定模型保存输出',updatedAt:new Date().toISOString(),reason:'已冻结原始输入/输出版本；没有调用模型或创建订单',evidenceRefs:[data.id]});
    }catch(error){res.status(400).json({success:false,reason:error instanceof Error?error.message:'模型证据无法冻结'});}
  });
  router.get('/:id/diagnostics',(req,res)=>{
    const runner=deps.runner(String(req.params.id));if(!runner){res.status(404).json({success:false,reason:'跑单不存在'});return;}
    const {rows,truncated}=history(runner.id);const data=reviewAiRunnerDecisions(rows,runner.id,runner.market,deps.closedPositions?.(runner.id)||[]);
    res.json({success:true,market:runner.market,runnerId:runner.id,data,dataStatus:rows.length?'historical':'empty',source:'SQLite 已保存的跑单决策',updatedAt:new Date().toISOString(),reason:truncated?'只统计当前保留的最近2000条记录':rows.length?null:'尚无逐轮决策记录',historyTruncated:truncated,evidenceRefs:rows.flatMap(row=>row.snapshotHash?['rs_'+row.snapshotHash]:[])});
  });
  router.get('/:id/history/:decisionId/replay',(req,res)=>{
    const runner=deps.runner(String(req.params.id));if(!runner){res.status(404).json({success:false,reason:'跑单不存在'});return;}
    const decision=history(runner.id).rows.find(row=>row.id===req.params.decisionId&&row.runnerId===runner.id&&row.market===runner.market);
    if(!decision){res.status(404).json({success:false,reason:'当前跑单的保留历史中没有该决策'});return;}
    const observations=(deps.observations?.(runner.id)||[]).slice(0,2000),observation=observations.find(row=>row.runnerId===runner.id&&row.accountId==='ai-runner:'+runner.id&&row.decision.id===decision.id&&row.decision.market===runner.market&&row.decision.instrument===decision.instrument&&row.decision.snapshotHash===decision.snapshotHash);
    const signal=deps.signal(decision.id)||(observation?{runnerId:observation.runnerId,decision:observation.decision,snapshotIds:[observation.snapshot.id]}:null);
    const snapshot=(decision.snapshotHash&&/^[a-f0-9]{64}$/.test(decision.snapshotHash)?deps.snapshot('rs_'+decision.snapshotHash):null)||observation?.snapshot||null;
    const linked=Boolean(signal&&snapshot&&signal.runnerId===runner.id&&signal.decision.runnerId===runner.id&&signal.decision.id===decision.id&&signal.decision.snapshotHash===decision.snapshotHash&&signal.snapshotIds.includes(snapshot.id)&&snapshot.hash===decision.snapshotHash&&snapshot.market===runner.market&&snapshot.payload.market===decision.market&&snapshot.payload.instrument===decision.instrument);
    const now=new Date().toISOString(),saved=linked?signal!.decision:decision,positions=(deps.closedPositions?.(runner.id)||[]).slice(0,2000);
    const execution=linked?deps.execution?.(saved)||null:null;
    const linkedIds=new Set(positions.filter(p=>p.entryOrderId===saved.orderId||p.exitOrderId===saved.orderId).flatMap(p=>[p.entryOrderId,p.exitOrderId]).filter(id=>id&&id!==saved.orderId));
    const exits=execution?history(runner.id).rows.filter(row=>row.runnerId===runner.id&&row.market===runner.market&&['BUY','SELL'].includes(row.action)&&linkedIds.has(row.orderId)).map(row=>deps.execution?.(row)).filter((row):row is VerifiedExecutionEvidence=>!!row):[];
    const evidenceGraph=buildDecisionEvidenceGraph(saved,linked?snapshot:null,execution,positions,now,exits);
    const rejectedPath=linked&&observation&&saved.action==='REJECTED'?reviewRejectedIntentPath(observation,observations,now):null;
    res.json({success:true,market:runner.market,instrument:decision.instrument,source:'已保存的决策及归档执行证据',updatedAt:now,dataStatus:linked?'historical':'unavailable',reason:linked?'只读回放原始记录，不调用模型、不提交订单':'未关联或归档证据无法核验；不重建未知快照',readOnly:true,modelCalls:0,evidenceGraph,rejectedPath,data:linked?{decision:saved,snapshot,comparison:buildSavedDecisionComparison(saved,snapshot!)}:null,evidenceRefs:linked?[snapshot!.id]:[]});
  });
  return router;
}
