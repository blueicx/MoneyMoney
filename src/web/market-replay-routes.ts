import express from 'express';
import type {MarketReplayStore} from '../features/market-replay';

export function createMarketReplayRouter(store:MarketReplayStore,csrfValid:(req:express.Request)=>boolean){
 const router=express.Router();
 router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'全市场回放仅限管理员'});return;}next();});
 router.use((req,res,next)=>{if(req.method!=='GET'&&!csrfValid(req)){res.status(403).json({success:false,dataStatus:'failed',reason:'CSRF 校验失败'});return;}next();});
 const fail=(res:express.Response,error:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'回放请求失败'});
 const check=(req:express.Request,keys:string[])=>{const input=req.method==='GET'?req.query:req.body;if(!['stocks','crypto','options','prediction'].includes(input?.market)||Object.keys(input||{}).some(key=>!keys.includes(key)))throw Error('市场或字段无效，不接受客户端行情、结果或订单');return String(input.market);};
 const envelope=(market:string,data:any)=>({success:true,market,instrument:data?.instrument||null,dataStatus:'historical',source:data?.source||'私人固定证据回放',updatedAt:data?.updatedAt?new Date(data.updatedAt).toISOString():null,reason:data?.reason||'只读回放，不采集、不调用模型、不创建订单',evidenceRefs:data?.current?[data.current.id]:[],data});
 router.get('/',(req,res)=>{try{const market=check(req,['market']);res.json(envelope(market,store.list(market)));}catch(error){fail(res,error);}});
 router.post('/preview',async(req,res)=>{try{const market=check(req,['market','instrument','asOf','requestId','evidenceRefs','decisions']);res.json(envelope(market,await store.preview(req.body)));}catch(error){fail(res,error);}});
 router.get('/:id',(req,res)=>{try{const market=check(req,['market']);const data=store.view(String(req.params.id));if(data.market!==market)throw Error('回放市场上下文不匹配');res.json(envelope(market,data));}catch(error){fail(res,error);}});
 router.post('/:id/confirm',(req,res)=>{try{const market=check(req,['market','revision','hash','acknowledge']);const data=store.confirm(String(req.params.id),req.body.revision,req.body.hash,req.body.acknowledge);if(data.market!==market)throw Error('回放市场上下文不匹配');res.json(envelope(market,data));}catch(error){fail(res,error);}});
 router.post('/:id/advance',(req,res)=>{try{const market=check(req,['market','revision']);const data=store.advance(String(req.params.id),req.body.revision);if(data.market!==market)throw Error('回放市场上下文不匹配');res.json(envelope(market,data));}catch(error){fail(res,error);}});
 router.post('/:id/control',(req,res)=>{try{const market=check(req,['market','revision','action']);const data=store.control(String(req.params.id),req.body.revision,req.body.action);if(data.market!==market)throw Error('回放市场上下文不匹配');res.json(envelope(market,data));}catch(error){fail(res,error);}});
 router.post('/:id/execution-check',(req,res)=>{try{const market=check(req,['market','revision','frameId','side','quantity','limitPrice']);const data=store.executionCheck(String(req.params.id),req.body.revision,{frameId:req.body.frameId,side:req.body.side,quantity:req.body.quantity,...(req.body.limitPrice===undefined?{}:{limitPrice:req.body.limitPrice})});if(data.market!==market)throw Error('回放市场上下文不匹配');res.json(envelope(market,data));}catch(error){fail(res,error);}});
 return router;
}
