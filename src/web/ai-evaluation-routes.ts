import express from 'express';
import type {AiEvaluationLab} from '../features/ai-evaluation-lab';
export function createAiEvaluationRouter(lab:AiEvaluationLab,references:(market:string)=>any[]){
 const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'AI质量实验仅限管理员'});return;}next();});
 const fail=(res:express.Response,e:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:e instanceof Error?e.message:'质量实验失败'});
 const check=(req:express.Request,keys:string[])=>{const input=req.method==='GET'?req.query:req.body;if(!['stocks','options','crypto','prediction'].includes(input?.market)||Object.keys(input||{}).some(k=>!keys.includes(k)))throw Error('市场或参数无效，不接受客户端行情、模型输出、提示词或凭据');return input.market as string;};
 const envelope=(market:string,data:any)=>({success:true,market,instrument:null,dataStatus:data?.status==='completed'?'historical':'partial',source:'Saved AI evidence / OpenRouter research',updatedAt:data?.updatedAt?new Date(data.updatedAt).toISOString():null,reason:data?.reason||'私人手动研究，不修改跑单或创建订单',evidenceRefs:data?.manifest?.sourceCaseHash?[data.manifest.sourceCaseHash]:[],data});
 const scoped=(req:express.Request)=>{const p=lab.read(String(req.params.id)),market=req.method==='GET'?req.query.market:req.body?.market;if(p.manifest.market!==market)throw Error('实验市场上下文不匹配');return p;};
 router.get('/references',(req,res)=>{try{const m=check(req,['market']);res.json(envelope(m,references(m)));}catch(e){fail(res,e);}});
 router.get('/quota',(req,res)=>{try{const m=check(req,['market']);res.json(envelope(m,lab.quota()));}catch(e){fail(res,e);}});
 router.get('/',(req,res)=>{try{const m=check(req,['market']);res.json(envelope(m,lab.list(m).map(p=>({id:p.id,status:p.status,revision:p.revision,market:p.manifest.market,models:p.manifest.models,inputHash:p.manifest.inputHash,updatedAt:p.updatedAt,reason:p.reason}))));}catch(e){fail(res,e);}});
 router.post('/compare',(req,res)=>{try{const m=check(req,['market','references']);res.json(envelope(m,lab.compare(m,req.body.references)));}catch(e){fail(res,e);}});
 router.post('/preview',(req,res)=>{try{const m=check(req,['market','reference','models','callLimit']);res.json(envelope(m,lab.preview(m,{reference:req.body.reference,models:req.body.models,callLimit:req.body.callLimit})));}catch(e){fail(res,e);}});
 router.get('/:id',(req,res)=>{try{const m=check(req,['market']);res.json(envelope(m,scoped(req)));}catch(e){fail(res,e);}});
 router.post('/:id/confirm',(req,res)=>{try{const m=check(req,['market','revision','hash','acknowledgeUnknownCost']);scoped(req);res.json(envelope(m,lab.confirm(String(req.params.id),req.body.revision,req.body.hash,req.body.acknowledgeUnknownCost)));}catch(e){fail(res,e);}});
 router.post('/:id/control',(req,res)=>{try{const m=check(req,['market','revision','action']);scoped(req);res.json(envelope(m,lab.control(String(req.params.id),req.body.revision,req.body.action)));}catch(e){fail(res,e);}});
 router.post('/:id/run',async(req,res)=>{try{const m=check(req,['market','revision']);scoped(req);res.json(envelope(m,await lab.run(String(req.params.id),req.body.revision)));}catch(e){fail(res,e);}});
 return router;
}
