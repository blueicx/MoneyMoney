import express from 'express';
import type {ResearchStatisticsAuditInput} from '../features/research-statistics-audit';

export function createResearchStatisticsRouter(deps:{
  adminOnly:(req:express.Request,res:express.Response)=>boolean;
  csrfValid:(req:express.Request)=>boolean;
  load:(market:string,id:string,asOf:string)=>Omit<ResearchStatisticsAuditInput,'market'|'experimentId'|'asOf'>|null;
}){
  const router=express.Router();
  router.use((req,res,next)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!deps.adminOnly(req,res))return;
    if(req.method!=='GET'&&!deps.csrfValid(req)){res.status(403).json({success:false,reason:'CSRF 校验失败'});return;}
    next();
  });
  router.post('/audit-preview',(req,res)=>{
    try{
      const allowed=['market','experimentId','asOf'];
      if(!req.body||Object.keys(req.body).some(key=>!allowed.includes(key)))throw Error('请求包含未允许字段');
      const market=String(req.body.market||''),experimentId=String(req.body.experimentId||''),asOf=String(req.body.asOf||new Date().toISOString());
      if(!['stocks','options','crypto','prediction'].includes(market))throw Error('统计审计市场无效');
      if(!experimentId.trim()||experimentId.length>200||!Number.isFinite(Date.parse(asOf)))throw Error('实验引用或截止时间无效');
      const loaded=deps.load(market,experimentId,asOf);
      if(!loaded)throw Error('未找到已保存研究实验');
      const {auditResearchStatistics}=require('../features/research-statistics-audit') as typeof import('../features/research-statistics-audit');
      const data=auditResearchStatistics({market:market as ResearchStatisticsAuditInput['market'],experimentId,asOf:new Date(asOf).toISOString(),...loaded});
      res.json({success:true,market,instrument:loaded.saved.experiment.instrument||null,data,dataStatus:data.dataStatus,source:'已保存实验 / 追加式研究尝试台账',reason:data.reason,updatedAt:new Date().toISOString(),evidenceRefs:[experimentId]});
    }catch(error){res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'统计审计不可用'});}
  });
  return router;
}
