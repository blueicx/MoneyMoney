import express from 'express';
import type {StrategyPipelineStore} from '../features/strategy-pipeline';

export function createStrategyPipelineRouter(store:StrategyPipelineStore,csrfValid:(req:express.Request)=>boolean){
 const router=express.Router();
 router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'策略流水线仅限管理员'});return;}next();});
 router.use((req,res,next)=>{if(req.method!=='GET'&&!csrfValid(req)){res.status(403).json({success:false,dataStatus:'failed',reason:'CSRF 校验失败'});return;}next();});
 const fail=(res:express.Response,error:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'策略流水线请求失败'});
 const check=(req:express.Request,keys:string[])=>{const input=req.method==='GET'?req.query:req.body;if(!['stocks','crypto','options','prediction'].includes(input?.market)||Object.keys(input||{}).some(key=>!keys.includes(key)))throw Error('市场或字段无效，不接受客户端行情、评分或订单');return String(input.market);};
 const envelope=(market:string,data:any)=>({success:true,market,instrument:data?.instrument||null,dataStatus:'historical',source:'固定 observed 快照',updatedAt:data?.updatedAt?new Date(data.updatedAt).toISOString():null,reason:data?.reason||'研究验证，不自动运行、不调用模型或下单',evidenceRefs:data?.result?[data.manifestHash]:[],data});
 router.get('/',(req,res)=>{try{const market=check(req,['market']);res.json(envelope(market,store.list(market)));}catch(error){fail(res,error);}});
 router.post('/preview',async(req,res)=>{try{const market=check(req,['market','instrument','timeframe','asOf','requestId','candidateVersions','parameterBudget','trainBars','validationBars','sealedBars','folds','forwardObservationId']);res.json(envelope(market,await store.preview(req.body)));}catch(error){fail(res,error);}});
 router.get('/:id',(req,res)=>{try{const market=check(req,['market']);const data=store.view(String(req.params.id));if(data.market!==market)throw Error('策略流水线市场不匹配');res.json(envelope(market,data));}catch(error){fail(res,error);}});
 router.post('/:id/confirm',(req,res)=>{try{const market=check(req,['market','revision','hash','acknowledge']);const data=store.confirm(String(req.params.id),req.body.revision,req.body.hash,req.body.acknowledge);if(data.market!==market)throw Error('策略流水线市场不匹配');res.json(envelope(market,data));}catch(error){fail(res,error);}});
 router.post('/:id/stop',(req,res)=>{try{const market=check(req,['market','revision']);const data=store.stop(String(req.params.id),req.body.revision);if(data.market!==market)throw Error('策略流水线市场不匹配');res.json(envelope(market,data));}catch(error){fail(res,error);}});
 return router;
}
