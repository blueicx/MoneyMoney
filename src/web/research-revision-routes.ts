import express from 'express';
import { buildResearchRevisionImpact, type RevisionImpactInput } from '../features/research-revision-impact';
export function createResearchRevisionRouter(deps:{load(id:string):RevisionImpactInput|null}){
  const router=express.Router();
  router.get('/:id/revision-impact',(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'修订关联含私人研究记录，仅管理员可查看'});return;}
    const id=String(req.params.id);
    if(!/^[A-Za-z0-9_.:-]{1,160}$/.test(id)){res.status(400).json({success:false,reason:'实验ID无效'});return;}
    try{
      const input=deps.load(id);
      if(!input){res.status(404).json({success:false,reason:'实验不存在或缺少明确市场身份'});return;}
      const data=buildResearchRevisionImpact(input);
      res.json({success:true,market:data.market,instrument:data.instrument,dataStatus:data.dataStatus,source:data.source,updatedAt:new Date().toISOString(),reason:data.reason+' 仅检查本实验、最近各200条同市场信号和日记，以及最多2000个同范围目录版本。',evidenceRefs:[],data});
    }catch{res.status(503).json({success:false,dataStatus:'unavailable',reason:'修订目录或明确引用暂不可核验；未按时间猜测关联、改写实验或自动重跑。'});}
  });return router;
}
