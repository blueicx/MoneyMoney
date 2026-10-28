import express from 'express';
import type {HistoricalUniverseStore} from '../features/historical-universe';
import {analyzeCrossSection,runRollingFactorValidation} from '../features/factor-cross-section';

export function createHistoricalUniverseRouter(store:Pick<HistoricalUniverseStore,'capture'|'list'|'read'>,csrfValid:(req:express.Request)=>boolean){
 const router=express.Router();
 router.use((req,res,next)=>{
  res.setHeader('Cache-Control','private, no-store');
  if((req as any).user?.role!=='admin')return res.status(403).json({success:false,reason:'历史标的池仅限管理员'});
  if(req.method!=='GET'&&!csrfValid(req))return res.status(403).json({success:false,reason:'CSRF 校验失败'});
  next();
 });
 const fail=(res:express.Response,error:unknown)=>res.status(400).json({success:false,dataStatus:'unavailable',reason:error instanceof Error?error.message:'历史标的池不可用'});
 router.get('/',(req,res)=>{try{
  if(Object.keys(req.query).some(k=>k!=='asOf')||typeof req.query.asOf!=='string')throw Error('查询需要明确时点');
  const data=store.list(req.query.asOf);return res.json({success:true,market:'stocks',dataStatus:data.length?'historical':'empty',data,reason:'只显示该时点已保存的观察，不回填当前成员'});
 }catch(e){return fail(res,e);}});
 router.get('/:id',(req,res)=>{try{return res.json({success:true,market:'stocks',dataStatus:'historical',data:store.read(String(req.params.id))});}catch(e){return fail(res,e);}});
 router.post('/:id/factors/preview',(req,res)=>{try{
  const body=req.body;
  if(!body||Object.keys(body).some(k=>!['observations','quantiles'].includes(k))||!Array.isArray(body.observations))throw Error('横截面预演仅接受观测数组与分位组数');
  const universe=store.read(String(req.params.id));
  return res.json({success:true,market:'stocks',...analyzeCrossSection({universe:{id:universe.id,contentHash:universe.contentHash,members:universe.members},observations:body.observations,quantiles:body.quantiles})});
 }catch(e){return fail(res,e);}});
 router.post('/:id/factors/rolling',(req,res)=>{try{
  const body=req.body;
  if(!body||Object.keys(body).some(k=>!['periods','trainPeriods','testPeriods','minSamples'].includes(k))||!Array.isArray(body.periods))throw Error('滚动检验仅接受观测期、训练期、检验期与最小样本');
  store.read(String(req.params.id));
  return res.json({success:true,market:'stocks',...runRollingFactorValidation(body)});
 }catch(e){return fail(res,e);}});
 router.post('/',(req,res)=>{try{
  if(!req.body||Object.keys(req.body).some(k=>!['market','evidenceId','asOf','requestId'].includes(k))||!['market','evidenceId','asOf','requestId'].every(k=>typeof req.body[k]==='string'))throw Error('仅接受市场、证据引用、时点和请求ID');
  return res.status(201).json({success:true,market:'stocks',dataStatus:'historical',data:store.capture(req.body)});
 }catch(e){return fail(res,e);}});
 return router;
}
