import express from 'express';
import { evaluateResearchRobustness } from '../features/research-robustness';
import { assertMarketContext } from '../features/research-contracts';

export function createResearchRobustnessRouter(deps:{get(id:string):any;save(id:string,result:any):unknown}) {
  const router=express.Router();
  router.post('/:id/robustness',(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'仅管理员可读取私人实验输入'});return;}
    if(req.body && Object.keys(req.body).length){res.status(400).json({success:false,reason:'仅分析已保存输入，不接受覆盖参数、代码或订单'});return;}
    const id=String(req.params.id),saved=deps.get(id);
    if(!saved){res.status(404).json({success:false,reason:'实验不存在'});return;}
    if(!saved.input?.context || saved.input.context.market!==saved.experiment?.market || saved.input.context.instrument!==saved.experiment?.instrument){res.status(409).json({success:false,reason:'实验输入缺失或市场/标的关联不一致，未猜测旧记录'});return;}
    try{
      assertMarketContext(saved.input.context);
      const data=evaluateResearchRobustness(saved.input);
      deps.save(id,{...saved,robustness:data});
      res.json({success:true,market:saved.experiment.market,instrument:saved.experiment.instrument,dataStatus:data.dataStatus,
        source:saved.input.context.dataSource||'保存的实验输入',updatedAt:new Date().toISOString(),reason:data.reason,
        evidenceRefs:saved.input.context.dataSnapshotHash?[saved.input.context.dataSnapshotHash]:[],data});
    }catch(error){res.status(400).json({success:false,reason:error instanceof Error?error.message:'稳健性研究失败'});}
  });
  return router;
}
