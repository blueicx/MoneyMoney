import express from 'express';
import type { DataAssetService } from '../features/data-assets';

export function createDataAssetRouter(service:DataAssetService) {
  const router=express.Router();
  router.use(['/assets','/collection-plans'],(req,res,next)=>{
    res.setHeader('Cache-Control','private, no-store');
    if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'数据资产与采集计划仅限管理员'});return;}
    next();
  });
  const fail=(res:express.Response,error:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'数据资产请求失败'});
  const envelope=(plan:ReturnType<DataAssetService['read']>,data:unknown)=>({success:true,market:plan.market,instrument:plan.instrument,dataStatus:'empty',source:'管理员采集计划 / 现有数据 Worker 队列',updatedAt:new Date().toISOString(),reason:'计划与任务状态不表示来源已返回数据；覆盖以发布后的真实分区为准',evidenceRefs:[],data});
  router.get('/assets',(req,res)=>{try{res.json(service.assets({market:String(req.query.market||''),instrument:String(req.query.instrument||''),timeframe:String(req.query.timeframe||'')}));}catch(error){fail(res,error);}});
  router.get('/collection-plans',(req,res)=>{try{res.json({success:true,data:service.list({market:String(req.query.market||''),instrument:String(req.query.instrument||''),timeframe:String(req.query.timeframe||'')})});}catch(error){fail(res,error);}});
  router.post('/collection-plans',(req,res)=>{try{const plan=service.preview(req.body||{});res.json(envelope(plan,plan));}catch(error){fail(res,error);}});
  router.get('/collection-plans/:id',(req,res)=>{try{const plan=service.status(String(req.params.id));res.json(envelope(plan,plan));}catch(error){fail(res,error);}});
  router.post('/collection-plans/:id/confirm',(req,res)=>{try{const id=String(req.params.id),job=service.confirm(id,String(req.body?.hash||''));res.json(envelope(service.read(id),job));}catch(error){fail(res,error);}});
  router.post('/collection-plans/:id/control',(req,res)=>{try{const action=req.body?.action;if(!['pause','resume','cancel'].includes(action))throw Error('无效任务操作');const id=String(req.params.id),job=service.control(id,action);res.json(envelope(service.read(id),job));}catch(error){fail(res,error);}});
  return router;
}
