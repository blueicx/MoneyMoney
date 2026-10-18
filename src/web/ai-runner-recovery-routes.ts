import express from 'express';
import type { AiRunnerRecovery } from '../features/ai-runner-recovery';
export function createAiRunnerRecoveryRouter(service:Pick<AiRunnerRecovery,'preview'|'confirm'>) {
  const router=express.Router();
  router.use('/:id/recovery',(req,res,next)=>{
    res.setHeader('Cache-Control','private, no-store');
    if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'仅管理员可对账和人工恢复私人模拟账户'});return;}next();
  });
  router.get('/:id/recovery',(req,res)=>{
    try{const data=service.preview(String(req.params.id));res.json({success:true,market:data.market,runnerId:data.runnerId,data,dataStatus:data.canResume?'historical':'partial',source:'统一模拟账本与当前配置，只读复核',updatedAt:new Date().toISOString(),reason:'不自动调平余额、放宽风控或执行订单',evidenceRefs:[]});}
    catch(error){res.status(400).json({success:false,reason:error instanceof Error?error.message:'账户无法复核'});}
  });
  router.post('/:id/recovery',(req,res)=>{
    try{const data=service.confirm(String(req.params.id),req.body);res.json({success:true,data,dataStatus:'historical',source:'管理员确认与审计',updatedAt:new Date().toISOString(),reason:'仅恢复原调度状态；下一轮重新校验报价、风险和额度，本请求不执行订单',evidenceRefs:[]});}
    catch(error){res.status(409).json({success:false,reason:error instanceof Error?error.message:'账户恢复未获确认'});}
  });
  return router;
}
