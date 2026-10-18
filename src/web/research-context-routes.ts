import express from 'express';
import type { ResearchContextLedger } from '../features/research-context-ledger';
import type { MarketId } from '../features/research-contracts';
export function createResearchContextRouter(ledger:Pick<ResearchContextLedger,'list'|'capture'>,watchlist:()=>string[]){
  const router=express.Router();
  router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'研究股票池与试验台账仅管理员可访问'});return;}next();});
  const market=(v:unknown):MarketId=>{if(typeof v!=='string'||!['stocks','options','crypto','prediction'].includes(v))throw Error('需要明确市场');return v as MarketId;};
  const envelope=(data:unknown)=>({success:true,data,dataStatus:'historical',source:'SQLite实际观察与试验台账',updatedAt:new Date().toISOString(),reason:'不回填未知历史成员或旧试验次数；不修改任何跑单或订单',evidenceRefs:[]});
  router.get('/',(req,res)=>{try{res.json(envelope(ledger.list(market(req.query.market),req.query.asOf==null?Date.now():Number(req.query.asOf))));}catch(e){res.status(400).json({success:false,reason:e instanceof Error?e.message:'台账不可用'});}});
  router.post('/universe',(req,res)=>{try{if(!req.body||Object.keys(req.body).some(k=>k!=='market'))throw Error('只能保存服务端当前自选，不能提交历史成分');const m=market(req.body.market),prefix={stocks:'stock:',options:'option:',crypto:'crypto:',prediction:'prediction:'}[m];res.status(201).json(envelope(ledger.capture(m,[...new Set(watchlist().filter(id=>id.startsWith(prefix)))],'管理员当前自选 / 实际观察')));}catch(e){res.status(400).json({success:false,reason:e instanceof Error?e.message:'股票池保存失败'});}});
  return router;
}
