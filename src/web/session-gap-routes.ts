import express from 'express';
import { auditStockSessionGaps } from '../features/exchange-session-context';

export function createSessionGapRouter(){
  const router=express.Router();
  router.get('/',(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'逐标的日历审计仅管理员可查看'});return;}
    try{
      const raw=req.query.gaps;
      if(typeof raw!=='string'||raw.length>6000)throw Error('间隔参数无效或超出长度限制');
      const asOf=req.query.asOf==null?null:Number(req.query.asOf);
      const data=auditStockSessionGaps({market:String(req.query.market||''),instrument:String(req.query.instrument||''),timeframe:String(req.query.timeframe||''),asOf,gaps:JSON.parse(raw)});
      res.json({success:true,market:data.market,instrument:data.instrument,data,dataStatus:data.dataStatus,source:data.source,updatedAt:new Date().toISOString(),reason:data.reason,evidenceRefs:[...new Set(data.gaps.map(row=>row.sourceUrl).filter(Boolean))]});
    }catch(error){res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'日历审计输入无效'});}
  });
  return router;
}
