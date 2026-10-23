import express from 'express';
import type { DataAssetService } from '../features/data-assets';
import type { OptionSnapshotRecovery } from '../features/option-snapshot-recovery';

export function createDataAssetRouter(service:DataAssetService,recovery?:OptionSnapshotRecovery) {
  const router=express.Router();
  router.use(['/assets','/collection-plans','/recovery'],(req,res,next)=>{
    res.setHeader('Cache-Control','private, no-store');
    if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'数据资产与采集计划仅限管理员'});return;}
    next();
  });
  const fail=(res:express.Response,error:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'数据资产请求失败'});
  const envelope=(plan:ReturnType<DataAssetService['read']>,data:unknown)=>({success:true,market:plan.market,instrument:plan.instrument,dataStatus:'empty',source:'管理员采集计划 / 现有数据 Worker 队列',updatedAt:new Date().toISOString(),reason:'计划与任务状态不表示来源已返回数据；覆盖以发布后的真实分区为准',evidenceRefs:[],data});
  router.get('/recovery',(req,res)=>{try{if(!recovery)throw Error('恢复服务未配置');const market=String(req.query.market||''),instrument=String(req.query.instrument||'');res.json({success:true,market,data:recovery.health(market,instrument)});}catch{res.status(400).json({success:false,reason:'当前身份的恢复目录不可核验；仅支持已登记期权快照'});}});
  for(const action of ['preview','confirm'] as const)router.post('/recovery/operations/'+action,(req,res)=>{try{if(!recovery)throw Error('恢复服务未配置');const allowed=['market','instrument','operationId','action',...(action==='confirm'?['hash','previewedAt']:[])];if(!req.body||Object.keys(req.body).some(key=>!allowed.includes(key)))throw Error('操作输入无效');const data=action==='preview'?recovery.previewOperation(req.body):recovery.confirmOperation(req.body);res.json({success:true,market:'options',data});}catch{res.status(action==='confirm'?409:400).json({success:false,reason:'中断操作、文件、备份或审计不可核验；请重新检查并预览，未自动继续恢复'});}});
  for(const action of ['preview','confirm'] as const)router.post('/recovery/'+action,(req,res)=>{try{if(!recovery)throw Error('恢复服务未配置');const allowed=['market','instrument','snapshotId','backupId',...(action==='confirm'?['hash','previewedAt']:[])];if(!req.body||Object.keys(req.body).some(k=>!allowed.includes(k)))throw Error('恢复输入无效');const data=action==='preview'?recovery.preview(req.body):recovery.confirm(req.body);res.json({success:true,market:'options',data});}catch{res.status(action==='confirm'?409:400).json({success:false,reason:'恢复预览、文件或备份证据已变化或不可用；请重新核验，未发布不可靠副本'});}});
  router.get('/assets',(req,res)=>{try{res.json(service.assets({market:String(req.query.market||''),instrument:String(req.query.instrument||''),timeframe:String(req.query.timeframe||'')}));}catch(error){fail(res,error);}});
  router.get('/collection-plans',(req,res)=>{try{res.json({success:true,data:service.list({market:String(req.query.market||''),instrument:String(req.query.instrument||''),timeframe:String(req.query.timeframe||'')})});}catch(error){fail(res,error);}});
  router.post('/collection-plans',(req,res)=>{try{const plan=service.preview(req.body||{});res.json(envelope(plan,plan));}catch(error){fail(res,error);}});
  router.get('/collection-plans/:id',(req,res)=>{try{const plan=service.status(String(req.params.id));res.json(envelope(plan,plan));}catch(error){fail(res,error);}});
  router.post('/collection-plans/:id/confirm',(req,res)=>{try{const id=String(req.params.id),job=service.confirm(id,String(req.body?.hash||''));res.json(envelope(service.read(id),job));}catch(error){fail(res,error);}});
  router.post('/collection-plans/:id/control',(req,res)=>{try{const action=req.body?.action;if(!['pause','resume','cancel'].includes(action))throw Error('无效任务操作');const id=String(req.params.id),job=service.control(id,action);res.json(envelope(service.read(id),job));}catch(error){fail(res,error);}});
  return router;
}
