import express from 'express';
import { ResearchBasisStore, type ResearchBasisScope } from '../features/research-basis';
export function createResearchBasisRouter(store:ResearchBasisStore,conflicts:(scope:ResearchBasisScope)=>unknown[]){
  const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'仅管理员可读取或记录研究口径'});return;}next();});
  const result=(scope:ResearchBasisScope,data:ReturnType<ResearchBasisStore['read']>)=>{const differences=conflicts(scope);return {success:true,market:scope.market,instrument:scope.instrument,dataStatus:differences.length?'partial':data.options.length?'historical':'empty',source:'本地分区与来源差异目录 / 管理员选择记录',updatedAt:new Date().toISOString(),reason:data.reason,evidenceRefs:data.records.map(r=>r.id),data:{...data,conflicts:differences}};};
  router.get('/',(req,res)=>{try{const scope={market:String(req.query.market||''),instrument:String(req.query.instrument||''),timeframe:String(req.query.timeframe||'')};res.json(result(scope,store.read(scope)));}catch(error){res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'研究口径不可读'});}});
  router.post('/',(req,res)=>{try{const data=store.select(req.body);res.json(result(data,data));}catch(error){const reason=error instanceof Error?error.message:'保存失败';res.status(/版本已变化/.test(reason)?409:400).json({success:false,dataStatus:'failed',reason});}});
  return router;
}
