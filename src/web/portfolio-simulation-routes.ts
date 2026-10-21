import express from 'express';
import type {PortfolioSimulationStore} from '../features/portfolio-simulations';
export function createPortfolioSimulationRouter(store:PortfolioSimulationStore,definitions:(market:string)=>unknown[]){
 const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'组合研究账户仅限管理员'});return;}next();});
 const fail=(res:express.Response,e:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:e instanceof Error?e.message:'组合实验请求失败'});
 const check=(req:express.Request,keys:string[])=>{const input=req.method==='GET'?req.query:req.body;if(!['stocks','crypto','options','prediction'].includes(input?.market)||Object.keys(input||{}).some(k=>!keys.includes(k)))throw Error('市场或字段无效，不接受客户端账本、行情或订单');return input.market as string;};
 const scope=(req:express.Request,m:string)=>{const p=store.view(String(req.params.id));if(p.market!==m)throw Error('组合研究市场不匹配');return p;};
 const envelope=(market:string,data:any)=>({success:true,market,instrument:null,dataStatus:'historical',source:data?.source||'私人组合研究目录',updatedAt:data?.updatedAt?new Date(data.updatedAt).toISOString():null,reason:data?.reason||'手动研究，不启动调度或真实交易',evidenceRefs:data?.evidenceRefs||[],data});
 router.get('/',(req,res)=>{try{const m=check(req,['market']);res.json(envelope(m,store.list(m)));}catch(e){fail(res,e);}});
 router.get('/definitions',(req,res)=>{try{const m=check(req,['market']);res.json(envelope(m,definitions(m)));}catch(e){fail(res,e);}});
 router.post('/preview',async(req,res)=>{try{const m=check(req,['market','currency','startingCash','asOf','from','count','maxPositions','maxInvestedPct','requestId','arms']);res.json(envelope(m,await store.preview(req.body)));}catch(e){fail(res,e);}});
 router.get('/:id',(req,res)=>{try{const m=check(req,['market']);res.json(envelope(m,scope(req,m)));}catch(e){fail(res,e);}});
 router.post('/:id/confirm',(req,res)=>{try{const m=check(req,['market','revision','hash','acknowledge']);scope(req,m);res.json(envelope(m,store.confirm(String(req.params.id),req.body.revision,req.body.hash,req.body.acknowledge)));}catch(e){fail(res,e);}});
 router.post('/:id/run',(req,res)=>{try{const m=check(req,['market','revision','requestId','steps']);scope(req,m);res.json(envelope(m,store.run(String(req.params.id),req.body.revision,req.body.requestId,req.body.steps)));}catch(e){fail(res,e);}});
 router.post('/:id/control',(req,res)=>{try{const m=check(req,['market','revision','action']);scope(req,m);res.json(envelope(m,store.control(String(req.params.id),req.body.revision,req.body.action)));}catch(e){fail(res,e);}});
 return router;
}
