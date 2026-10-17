import express from 'express';
import type { AiRunnerDecisionRecord, AiRunnerPosition } from '../features/ai-paper-runner';
import { reviewAiRunnerDecisions, buildSavedDecisionComparison } from '../features/ai-runner-diagnostics';
interface Dependencies {
  runner(id:string):{id:string;market:string}|null;
  history(id:string,cursor:string|undefined,limit:number):{data:AiRunnerDecisionRecord[];nextCursor?:string|null};
  signal(id:string):{runnerId:string;decision:AiRunnerDecisionRecord;snapshotIds:string[]}|null;
  snapshot(id:string):{id:string;hash:string;market:string;payload:Record<string,any>}|null;
  closedPositions?(id:string):AiRunnerPosition[];
}
export function createAiRunnerDiagnosticsRouter(deps:Dependencies) {
  const router=express.Router();
  router.use('/:id/diagnostics',privateRead);router.use('/:id/history/:decisionId/replay',privateRead);
  function privateRead(req:express.Request,res:express.Response,next:express.NextFunction){res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'仅管理员可读取跑单诊断及保存快照'});return;}next();}
  function history(id:string){const rows:AiRunnerDecisionRecord[]=[];let cursor:string|undefined;let pages=0;do{const page=deps.history(id,cursor,200);rows.push(...page.data);cursor=page.nextCursor||undefined;}while(cursor&&++pages<10);return {rows,truncated:Boolean(cursor)};}
  router.get('/:id/diagnostics',(req,res)=>{
    const runner=deps.runner(String(req.params.id));if(!runner){res.status(404).json({success:false,reason:'跑单不存在'});return;}
    const {rows,truncated}=history(runner.id);const data=reviewAiRunnerDecisions(rows,runner.id,runner.market,deps.closedPositions?.(runner.id)||[]);
    res.json({success:true,market:runner.market,runnerId:runner.id,data,dataStatus:rows.length?'historical':'empty',source:'SQLite 已保存的跑单决策',updatedAt:new Date().toISOString(),reason:truncated?'只统计当前保留的最近2000条记录':rows.length?null:'尚无逐轮决策记录',historyTruncated:truncated,evidenceRefs:rows.flatMap(row=>row.snapshotHash?['rs_'+row.snapshotHash]:[])});
  });
  router.get('/:id/history/:decisionId/replay',(req,res)=>{
    const runner=deps.runner(String(req.params.id));if(!runner){res.status(404).json({success:false,reason:'跑单不存在'});return;}
    const decision=history(runner.id).rows.find(row=>row.id===req.params.decisionId&&row.runnerId===runner.id&&row.market===runner.market);
    if(!decision){res.status(404).json({success:false,reason:'当前跑单的保留历史中没有该决策'});return;}
    const signal=deps.signal(decision.id),snapshot=decision.snapshotHash&&/^[a-f0-9]{64}$/.test(decision.snapshotHash)?deps.snapshot('rs_'+decision.snapshotHash):null;
    const linked=Boolean(signal&&snapshot&&signal.runnerId===runner.id&&signal.decision.runnerId===runner.id&&signal.decision.id===decision.id&&signal.decision.snapshotHash===decision.snapshotHash&&signal.snapshotIds.includes(snapshot.id)&&snapshot.hash===decision.snapshotHash&&snapshot.market===runner.market&&snapshot.payload.market===decision.market&&snapshot.payload.instrument===decision.instrument);
    res.json({success:true,market:runner.market,instrument:decision.instrument,source:'已核验的归档执行证据',updatedAt:new Date().toISOString(),dataStatus:linked?'historical':'unavailable',reason:linked?'只读回放原始记录，不调用模型、不提交订单':'未关联或归档证据无法核验；不重建未知快照',readOnly:true,modelCalls:0,data:linked?{decision:signal!.decision,snapshot,comparison:buildSavedDecisionComparison(signal!.decision,snapshot!)}:null,evidenceRefs:linked?[snapshot!.id]:[]});
  });
  return router;
}
