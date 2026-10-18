import express from 'express';
import { auditPredictionRelationship, type PredictionRelationshipStore, type RelationshipQuote } from '../features/prediction-relationship-audit';
interface Dependencies {store:PredictionRelationshipStore;quote(id:unknown):RelationshipQuote|null;ruleHash(id:string):string|null;now?():string}
export function createPredictionRelationshipRouter(deps:Dependencies){
  const router=express.Router();
  router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,market:'prediction',dataStatus:'unavailable',reason:'仅管理员可读取或保存私人关系声明'});return;}next();});
  router.get('/',(req,res)=>{
    const now=deps.now?.()||new Date().toISOString(),market=String(req.query.market||'prediction');
    if(market!=='prediction'){res.status(400).json({success:false,market:'prediction',dataStatus:'unsupported',reason:'关系图仅用于预测事件'});return;}
    const data=deps.store.list({market,now,ruleHash:deps.ruleHash});
    res.json({success:true,market,data,dataStatus:data.length?'historical':'empty',source:'SQLite人工规则核对记录',updatedAt:now,evidenceRefs:data.flatMap(row=>[row.record.left.evidenceRef,row.record.right.evidenceRef]),reason:'人工声明的条件关系，不是自动语义核验；历史报价不是当前概率。规则变化须人工重新确认，不创建订单。'});
  });
  router.post('/check',(req,res)=>{
    const now=deps.now?.()||new Date().toISOString(),left=deps.quote(req.body?.left),right=deps.quote(req.body?.right);
    if(!left||!right){res.json({success:true,market:'prediction',dataStatus:'unavailable',reason:'当前缓存没有两个精确匹配事件；先打开双方官方规则，不新增来源请求或猜测身份',evidenceRefs:[],data:null});return;}
    const data=auditPredictionRelationship({left,right,relationship:req.body.relationship,confirmed:req.body.confirmed,now:Date.parse(now)});
    try{
      const saved=req.body.save===true?deps.store.save({left,right,relationship:req.body.relationship,confirmed:req.body.confirmed,reason:req.body.reason},now):null;
      res.json({success:true,...data,source:'当前预测雷达缓存 + 已保存官方规则',updatedAt:left.observedAt,data,...(saved?{saved}:{})});
    }catch(error){res.status(400).json({success:false,market:'prediction',dataStatus:'unavailable',reason:error instanceof Error?error.message:'无法保存人工关系证据'});}
  });
  return router;
}
