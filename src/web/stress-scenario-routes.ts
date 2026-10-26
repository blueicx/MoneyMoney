import express from 'express';
import { formatStressScenarioReport } from '../features/saved-stress-scenarios';

export interface StressScenarioStore {list():any[]|Promise<any[]>;read(id:string):any|Promise<any>;saveOption(input:any,actor:string,requestId:string):any|Promise<any>;savePortfolio(input:any,actor:string,requestId:string):any|Promise<any>;}
export interface StressScenarioRouteDependencies {store:StressScenarioStore;listSavedOptionSnapshots?:(owner:string)=>unknown[]|Promise<unknown[]>;listPriceSnapshots?:(owner:string)=>unknown[]|Promise<unknown[]>;loadPaperHoldings?:(owner:string)=>unknown[]|Promise<unknown[]>;}
export function createStressScenarioRouter(deps:StressScenarioRouteDependencies){
 const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'仅管理员可访问压力情景'});return;}next();});
 const fail=(res:any,e:unknown)=>{const reason=e instanceof Error?e.message:'压力情景操作失败';res.status(/版本已变化|幂等|请求ID/.test(reason)?409:400).json({success:false,reason});};
 router.get('/',async(req,res)=>{try{res.json({success:true,data:await deps.store.list()});}catch(e){fail(res,e);}});
 const ownerOf=(req:any)=>String(req.user?.user||req.user?.id||'');
 router.get('/holdings',async(req,res)=>{try{res.json({success:true,data:await deps.loadPaperHoldings?.(ownerOf(req))||[]});}catch(e){fail(res,e);}});
 router.get('/options-snapshots',async(req,res)=>{try{const rows=await deps.listSavedOptionSnapshots?.(ownerOf(req))||[];res.json({success:true,data:rows.map((x:any)=>({id:x.id,instrument:x.instrument,fetchedAt:x.fetchedAt,contentHash:x.contentHash,source:x.source,expiries:(x.snapshot?.expiries||[]).map((e:any)=>({expiryMs:e.expiryMs,contracts:(e.rows||[]).map((r:any)=>r.instrumentName)}))}))});}catch(e){fail(res,e);}});
 router.get('/price-snapshots',async(req,res)=>{try{res.json({success:true,data:await deps.listPriceSnapshots?.(ownerOf(req))||[]});}catch(e){fail(res,e);}});
 router.get('/:id/report',async(req,res)=>{try{const record=await deps.store.read(String(req.params.id));if(!record){res.status(404).json({success:false,reason:'压力情景不存在'});return;}const format=String(req.query.format||'json');if(format!=='json'&&format!=='html')throw Error('报告格式无效');res.type(format==='html'?'text/html':'application/json').send(formatStressScenarioReport(record,format));}catch(e){fail(res,e);}});
 router.get('/:id',async(req,res)=>{try{const data=await deps.store.read(String(req.params.id));if(!data){res.status(404).json({success:false,reason:'压力情景不存在'});return;}res.json({success:true,data});}catch(e){fail(res,e);}});
 router.post('/options',async(req,res)=>{try{const body=req.body;if(!body||Object.keys(body).some(k=>!['revision','asOf','snapshotId','multiplier','legs','scenarios','requestId'].includes(k)))throw Error('请求字段无效');const actor=String((req as any).user?.user||(req as any).user?.id||''),id=String(req.get('X-Request-Id')||'');if(body.requestId&&body.requestId!==id)throw Error('请求ID不匹配');res.json({success:true,data:await deps.store.saveOption(body,actor,id)});}catch(e){fail(res,e);}});
 router.post('/portfolio',async(req,res)=>{try{const body=req.body;if(!body||Object.keys(body).some(k=>!['revision','asOf','positions','shocks','holdingSource','requestId'].includes(k)))throw Error('请求字段无效');const actor=String((req as any).user?.user||(req as any).user?.id||''),id=String(req.get('X-Request-Id')||'');if(body.requestId&&body.requestId!==id)throw Error('请求ID不匹配');res.json({success:true,data:await deps.store.savePortfolio(body,actor,id)});}catch(e){fail(res,e);}});
 return router;
}
