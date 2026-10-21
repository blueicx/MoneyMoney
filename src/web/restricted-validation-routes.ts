import express from 'express';
import type {RestrictedValidationStore} from '../features/restricted-validation';
export function createRestrictedValidationRouter(store:RestrictedValidationStore,history:Parameters<RestrictedValidationStore['retrospective']>[1]){
 const router=express.Router();
 router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'双轨验证仅限管理员'});return;}next();});
 const fail=(res:express.Response,e:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:e instanceof Error?e.message:'验证失败'});
 const check=(req:express.Request,keys:string[])=>{const input=req.method==='GET'?req.query:req.body;if(input?.market!=='stocks'||Object.keys(input||{}).some(k=>!keys.includes(k)))throw Error('仅接受明确的股票研究上下文，不接受客户端行情、指标或审批结论');};
 const pack=(plan:ReturnType<RestrictedValidationStore['read']>,result:unknown=null)=>({success:true,market:plan.market,instrument:plan.instrument,dataStatus:plan.status==='completed'?'historical':'empty',source:plan.source,updatedAt:new Date(plan.updatedAt).toISOString(),reason:plan.reason,evidenceRefs:(result as any)?.evidenceRefs||[],data:{plan,result,canEvaluate:plan.status==='registered'&&Date.now()>=plan.to}});
 router.get('/',(req,res)=>{try{check(req,['market','observationId']);const data=store.list(String(req.query.observationId||''));res.json({success:true,market:'stocks',instrument:data[0]?.instrument||null,dataStatus:data.length?'historical':'empty',source:'私人验证计划目录',updatedAt:null,reason:'仅目录读取，不运行任务',evidenceRefs:[],data});}catch(e){fail(res,e);}});
 router.post('/retrospective',async(req,res)=>{try{check(req,['market','observationId']);const data=await store.retrospective(String(req.body.observationId||''),history);res.json({success:true,market:'stocks',instrument:data.experiment.instrument,dataStatus:'historical',source:data.experiment.dataSource,updatedAt:data.experiment.createdAt,reason:data.reason,evidenceRefs:data.evidenceRefs,data});}catch(e){fail(res,e);}});
 router.post('/preview',(req,res)=>{try{check(req,['market','observationId','count','from']);res.json(pack(store.preview(String(req.body.observationId||''),{count:req.body.count,...(req.body.from===undefined?{}:{from:req.body.from})})));}catch(e){fail(res,e);}});
 router.get('/:id',(req,res)=>{try{check(req,['market']);const p=store.read(String(req.params.id));res.json(pack(p,store.resultFor(p.id)));}catch(e){fail(res,e);}});
 router.post('/:id/confirm',(req,res)=>{try{check(req,['market','revision','hash']);res.json(pack(store.confirm(String(req.params.id),req.body.revision,req.body.hash)));}catch(e){fail(res,e);}});
 router.post('/:id/control',(req,res)=>{try{check(req,['market','revision','action']);res.json(pack(store.control(String(req.params.id),req.body.revision,req.body.action)));}catch(e){fail(res,e);}});
 router.post('/:id/evaluate',async(req,res)=>{try{check(req,['market','revision']);const r=await store.evaluate(String(req.params.id),req.body.revision,history);res.json(pack(r.plan,r.result));}catch(e){fail(res,e);}});
 return router;
}
