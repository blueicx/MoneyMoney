import express from 'express';
import type { DataLakeCatalog, PointInTimeSnapshot } from '../storage/data-lake';
import { compareSavedSnapshots, type SnapshotChoice } from '../features/snapshot-comparison';

const fail=(res:express.Response,error:unknown,status=400)=>res.status(status).json({success:false,reason:error instanceof Error?error.message:'快照比较失败'});
function scope(catalog:DataLakeCatalog,market:string,instrument:string,timeframe:string){
  if(!['stocks','crypto','options','prediction'].includes(market)||!instrument||instrument.length>200||!timeframe||timeframe.length>40)throw Error('比较范围必须提供有效市场、规范标的和周期');
  const ref=catalog.resolveInstrument(market as any,instrument);if(!ref||ref.id!==instrument)throw Error('instrument 必须是唯一且已登记的规范身份');
  return {market,instrument:ref.id,symbol:ref.symbol,timeframe};
}
export function createSnapshotComparisonRouter(deps:{catalog:DataLakeCatalog;choices:{listChoices:(scope:{market:string;instrument:string})=>SnapshotChoice[];saveChoice:(input:any)=>SnapshotChoice};adminOnly:(req:express.Request,res:express.Response)=>boolean;csrfValid:(req:express.Request)=>boolean}) {
  const router=express.Router();
  router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if(!deps.adminOnly(req,res))return;next();});
  router.get('/snapshots',(req,res)=>{try{const current=scope(deps.catalog,String(req.query.market||''),String(req.query.instrument||''),String(req.query.timeframe||''));const data=deps.catalog.listSnapshots({market:current.market as any,instrument:current.symbol,timeframe:current.timeframe,limit:100}).map(ref=>({id:ref.id,market:ref.market,instrument:current.instrument,timeframe:ref.timeframe,asOf:ref.asOf,source:ref.source,capturedAt:ref.createdAt,contentHash:ref.contentHash}));res.json({success:true,market:current.market,instrument:current.instrument,timeframe:current.timeframe,data});}catch(error){fail(res,error);}});
  router.get('/choices',(req,res)=>{try{const market=String(req.query.market||''),instrument=String(req.query.instrument||'');const current=scope(deps.catalog,market,instrument,String(req.query.timeframe||'1d'));res.json({success:true,market:current.market,instrument:current.instrument,data:deps.choices.listChoices({market:current.market,instrument:current.instrument})});}catch(error){fail(res,error);}});
  router.post('/compare',async(req,res)=>{try{
    if(!deps.csrfValid(req))return fail(res,Error('CSRF 校验失败'),403);
    const body=req.body;if(!body||Object.keys(body).some(k=>!['market','instrument','timeframe','references'].includes(k)))throw Error('比较请求包含未支持字段');
    const current=scope(deps.catalog,body.market,body.instrument,body.timeframe);
    if(!Array.isArray(body.references)||body.references.length<2||body.references.length>4||body.references.some((id:unknown)=>typeof id!=='string'||!id.trim()||id.length>240))throw Error('必须明确提供 2 到 4 个已保存快照 ID');
    const refs: Array<PointInTimeSnapshot|null>=body.references.map((id:string)=>deps.catalog.getSnapshot(id));if(refs.some(ref=>!ref))throw Error('快照不存在或已不可用');
    const canonicalRefs=refs.map(ref=>{const resolved=deps.catalog.resolveInstrument(current.market as any,ref!.instrument);if(!resolved||resolved.id!==current.instrument||ref!.market!==current.market||ref!.timeframe!==current.timeframe||ref!.dataset!=='bars')throw Error('快照与请求的规范市场、标的或周期不一致');return {...ref!,instrument:current.instrument};});
    const observations=await Promise.all(refs.map(async(ref,index)=>{try{return {...await deps.catalog.readSnapshotBarsExact(ref!),snapshot:canonicalRefs[index]};}catch(error){return {snapshot:canonicalRefs[index],rows:[],dataStatus:'unavailable' as const,updatedAt:null,publishedAt:null,sourceCapturedAt:null,serverFetchedAt:null,adjustment:'unknown',currency:null,session:null,coverage:null,source:ref!.source,unavailableReason:error instanceof Error?error.message:'saved snapshot evidence could not be verified'};}}));
    res.json({success:true,data:compareSavedSnapshots({market:current.market,instrument:current.instrument,timeframe:current.timeframe,references:canonicalRefs,observations})});
  }catch(error){fail(res,error);}});
  router.post('/choices',(req,res)=>{try{
    if(!deps.csrfValid(req))return fail(res,Error('CSRF 校验失败'),403);
    const body=req.body;if(!body||Object.keys(body).some(k=>!['requestId','idempotencyKey','market','instrument','timeframe','references','choice','reason'].includes(k)))throw Error('选择记录不接受其他字段');
    const current=scope(deps.catalog,body.market,body.instrument,body.timeframe);const data=deps.choices.saveChoice({...body,market:current.market,instrument:current.instrument});res.status(201).json({success:true,data});
  }catch(error){fail(res,error);}});
  return router;
}
