import express from 'express';
import { compareSharedCapital } from '../features/shared-capital-comparison';

export function createSharedCapitalRouter(deps:{get(id:string):any}){
  const router=express.Router();
  router.post('/',(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'共享资金研究输入仅管理员可访问'});return;}
    try{
      if(!req.body||Object.keys(req.body).some(key=>key!=='ids')||!Array.isArray(req.body.ids)||req.body.ids.length<2||req.body.ids.length>6||req.body.ids.some((id:unknown)=>typeof id!=='string'||!/^[\w-]{1,200}$/.test(id))||new Set(req.body.ids).size!==req.body.ids.length)throw Error('只接受2–6个不同的保存实验ID，不接受外部价格、订单或覆盖参数');
      const rows=req.body.ids.map((id:string)=>deps.get(id));
      if(rows.some((row:unknown)=>!row)){res.status(404).json({success:false,reason:'实验不存在'});return;}
      const data=compareSharedCapital(rows);
      res.json({success:true,market:data.market,instrument:data.instrument,dataStatus:data.dataStatus,source:data.source,updatedAt:new Date().toISOString(),reason:data.reason,evidenceRefs:data.evidenceRefs,data});
    }catch(error){res.status(400).json({success:false,reason:error instanceof Error?error.message:'共同资金路径不可用'});}
  });return router;
}
