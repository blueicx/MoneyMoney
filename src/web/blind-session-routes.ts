import express from 'express';
import type {BlindSessionStore} from '../features/blind-sessions';
export function createBlindSessionRouter(store:BlindSessionStore){
 const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'历史盲测仅限管理员'});return;}next();});
 const fail=(res:express.Response,e:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:e instanceof Error?e.message:'盲测请求失败'});
 const check=(req:express.Request,allowed:string[])=>{const input=req.method==='GET'?req.query:req.body;if(!['stocks','crypto','options','prediction'].includes(input?.market)||Object.keys(input||{}).some(k=>!allowed.includes(k)))throw Error('市场或字段无效，不接收客户端行情、未来结果或执行参数');return input.market as string;};
 const envelope=(market:string,data:any)=>({success:true,market,instrument:data?.instrument||null,dataStatus:'historical',source:data?.source||'私人历史盲测目录',updatedAt:data?.updatedAt?new Date(data.updatedAt).toISOString():null,reason:data?.reason||'手动训练，不创建订单',evidenceRefs:data?.snapshotId?[data.snapshotId]:[],data});
 const scoped=(req:express.Request,market:string)=>{const row=store.view(String(req.params.id));if(row.market!==market)throw Error('盲测市场上下文不匹配');return row;};
 router.get('/',(req,res)=>{try{const m=check(req,['market']);res.json(envelope(m,store.list(m)));}catch(e){fail(res,e);}});
 router.post('/preview',async(req,res)=>{try{const m=check(req,['market','instrument','timeframe','asOf','from','count','requestId','evidenceRefs','includeCorporateActions','availability']);res.json(envelope(m,await store.preview(req.body)));}catch(e){fail(res,e);}});
 router.get('/:id',(req,res)=>{try{const m=check(req,['market']);res.json(envelope(m,scoped(req,m)));}catch(e){fail(res,e);}});
 for(const action of ['confirm','judge','correct','respond','advance','stop'])router.post('/:id/'+action,(req,res)=>{try{
  const fields=action==='confirm'?['hash','acknowledge']:action==='judge'?['direction','hypothesis','invalidation','rule']:action==='correct'?['decisionId','note']:action==='respond'?['decisionId','note','action']:[],m=check(req,['market','revision',...fields]),r=scoped(req,m),b=req.body,revision=b.revision;
  const result=action==='confirm'?store.confirm(r.id,revision,b.hash,b.acknowledge):action==='judge'?store.judge(r.id,revision,{direction:b.direction,hypothesis:b.hypothesis,invalidation:b.invalidation,...(b.rule!==undefined?{rule:b.rule}:{})}):action==='correct'?store.correct(r.id,revision,b.decisionId,b.note):action==='respond'?store.respond(r.id,revision,b.decisionId,b.action,b.note):action==='advance'?store.advance(r.id,revision):store.stop(r.id,revision);res.json(envelope(m,result));
 }catch(e){fail(res,e);}});
 return router;
}
