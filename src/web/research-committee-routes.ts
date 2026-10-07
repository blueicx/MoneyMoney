import express from 'express';
import { assertMarketContext, type MarketId } from '../features/research-contracts';
import type { ResearchCommittee } from '../features/research-committee';
export function createResearchCommitteeRouter(service: Pick<ResearchCommittee,'list'|'run'>) {
  const router=express.Router();
  router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'仅管理员可读取私人研究审议'});return;}next();});
  router.get('/',(req,res)=>{try{const market=String(req.query.market) as MarketId,instrument=String(req.query.instrument || '');assertMarketContext({market,instrument,workspace:'evidence'});const data=service.list(market,instrument);res.json({success:true,market,instrument,data,dataStatus:data.length?'historical':'empty',source:'本地审议记录',updatedAt:new Date().toISOString(),reason:data.length?null:'当前标的暂无手动审议',evidenceRefs:[]});}catch{res.status(400).json({success:false,dataStatus:'failed',reason:'市场或标的身份无效'});}});
  router.post('/',async(req,res)=>{
    try{const body=req.body || {};if(Object.keys(body).some(field=>!['market','instrument','evidenceRefs','idempotencyKey'].includes(field)))throw new Error('只接受市场、标的、存档证据 ID 和幂等键；不能提交模型、订单或风控参数');
      const data=await service.run(body);
      res.json({success:true,market:data.market,instrument:data.instrument,data,dataStatus:data.status==='completed'?'historical':data.status==='failed'?'failed':'unavailable',reason:data.reason,source:'OpenRouter 三角色只读审议 / 本地证据',updatedAt:data.createdAt,evidenceRefs:data.evidence.map(row=>row.id)});
    }catch(error){res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'审议不可用'});}
  });
  return router;
}
