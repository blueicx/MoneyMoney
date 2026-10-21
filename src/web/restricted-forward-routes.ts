import express from 'express';
import type {RestrictedForwardStore} from '../features/restricted-forward';
export function createRestrictedForwardRouter(store:RestrictedForwardStore,history:Parameters<RestrictedForwardStore['capture']>[2]){
 const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'前向观察仅限管理员'});return;}next();});
 const fail=(res:express.Response,e:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:e instanceof Error?e.message:'前向观察失败'});
 const envelope=(row:ReturnType<RestrictedForwardStore['read']>)=>({success:true,market:row.market,instrument:row.instrument,dataStatus:row.dataStatus,source:row.source,updatedAt:new Date(row.updatedAt).toISOString(),reason:row.reason,evidenceRefs:row.captures?.flatMap(c=>c.snapshotId?[c.snapshotId]:[])||[],data:{session:row,signals:store.signals(row.id),executionEnabled:false,warning:'仅记录启动后手动看到的条件与后续标的涨跌；没有持续扫描，不创建订单，不补记错过的信号。'}});
 const check=(req:express.Request,keys:string[])=>{if(Object.keys(req.body||{}).some(key=>!keys.includes(key)))throw Error('不接受客户端行情、信号、预算或其他执行参数');};
 const scoped=(req:express.Request)=>{const row=store.read(String(req.params.id));if(row.market!==(req.method==='GET'?req.query.market:req.body?.market))throw Error('前向观察市场上下文不匹配');return row;};
 router.get('/',(req,res)=>{try{const market=String(req.query.market||'');res.json({success:true,market,data:store.list(market),dataStatus:'historical',source:'私人手动前向观察目录',updatedAt:null,reason:'读取目录不采集行情、不调用模型或创建订单',evidenceRefs:[]});}catch(e){fail(res,e);}});
 router.post('/',(req,res)=>{try{check(req,['strategyId','market','instrument','hash','experimentId','requestId']);const {strategyId,...input}=req.body||{};res.json(envelope(store.start(String(strategyId||''),input)));}catch(e){fail(res,e);}});
 router.get('/:id',(req,res)=>{try{res.json(envelope(scoped(req)));}catch(e){fail(res,e);}});
 router.get('/:id/readiness',(req,res)=>{try{if(Object.keys(req.query).some(key=>!['market','validationId'].includes(key))||req.query.validationId!==undefined&&(typeof req.query.validationId!=='string'||!req.query.validationId))throw Error('证据核验只接受明确引用，不接受客户端指标或审批结论');const row=scoped(req),data=store.readiness(row.id,req.query.validationId as string|undefined);res.json({success:true,market:row.market,instrument:data.instrument,dataStatus:data.dataStatus,source:data.source,updatedAt:data.checkedAt,reason:data.reason,evidenceRefs:data.evidenceRefs,data});}catch(e){fail(res,e);}});
 router.post('/:id/control',(req,res)=>{try{check(req,['market','revision','action']);const row=scoped(req);res.json(envelope(store.control(row.id,req.body?.revision,req.body?.action)));}catch(e){fail(res,e);}});
 router.post('/:id/capture',async(req,res)=>{try{check(req,['market','revision']);const row=scoped(req);res.json(envelope(await store.capture(row.id,req.body?.revision,history)));}catch(e){fail(res,e);}});
 return router;
}
