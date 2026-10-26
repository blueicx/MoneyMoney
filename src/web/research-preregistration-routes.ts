import express from 'express';
import type {createResearchPreregistrationStore} from '../features/research-preregistration';
type Service=ReturnType<typeof createResearchPreregistrationStore>;
const fail=(res:express.Response,error:unknown,status=400)=>res.status(status).json({success:false,reason:error instanceof Error?error.message:'预注册请求失败'});
const conflict=(error:unknown)=>error instanceof Error&&/版本已变化|幂等键已绑定/.test(error.message)?409:400;
const registrationFields=['market','expectedVersion','idempotencyKey','hypothesis','primaryMetric','sampleDefinition','stopCondition','parameterBudget','fixedReferenceLinkIds'];
export function createResearchPreregistrationRouter(deps:{service:Service;adminOnly:(req:express.Request,res:express.Response)=>boolean;csrfValid:(req:express.Request)=>boolean}){
 const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if(!deps.adminOnly(req,res))return;next();});
 router.get('/:id',(req,res)=>{try{if(Object.keys(req.query).some(k=>k!=='market'))throw Error('预注册查询只接受明确市场');const data=deps.service.list(String(req.params.id),String(req.query.market||''));res.json({success:true,market:data.market,data});}catch(e){fail(res,e);}});
 router.post('/:id',(req,res)=>{try{if(!deps.csrfValid(req))return fail(res,Error('CSRF 校验失败'),403);if(!req.body||Object.keys(req.body).some(k=>!registrationFields.includes(k)))throw Error('预注册只接受冻结字段，不接受客户端结果或计算输出');const data=deps.service.register({...req.body,projectId:String(req.params.id)});res.status(201).json({success:true,market:data.market,data});}catch(e){fail(res,e,conflict(e));}});
 router.post('/:id/experiments',(req,res)=>{try{if(!deps.csrfValid(req))return fail(res,Error('CSRF 校验失败'),403);const allowed=['registrationId','expectedVersion','idempotencyKey','experimentIds'];if(!req.body||Object.keys(req.body).some(k=>!allowed.includes(k)))throw Error('实验关联只接受已保存实验 ID，不接受客户端结果或参数');const data=deps.service.associateSavedExperiments({...req.body,projectId:String(req.params.id)});res.status(201).json({success:true,market:data?.market,data});}catch(e){fail(res,e,conflict(e));}});
 return router;
}
