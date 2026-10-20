import express from 'express';
import type {ResearchProjectStore,ResearchProject} from '../features/research-projects';

export function createResearchProjectRouter(store:ResearchProjectStore,reviewStatus?:()=>{intervalMs:number;batchLimit:number;updatedAt?:string;lastResult?:{checked:number;added:number;failed:number};nextAt?:number}){
 const router=express.Router();
 router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'研究项目及引用仅限管理员'});return;}next();});
 const fail=(res:express.Response,error:unknown)=>{const reason=error instanceof Error?error.message:'研究项目请求失败';res.status(reason.includes('版本已变化')?409:400).json({success:false,dataStatus:'failed',reason});};
 const envelope=(p:ResearchProject)=>({success:true,market:p.market,instrument:null,dataStatus:p.links.length?'historical':'empty',source:'私人研究项目与已保存的明确引用',updatedAt:p.updatedAt,reason:'项目仅保存研究元数据；引用不等于来源已核验有效，复查不会修改原结论、策略或订单',evidenceRefs:p.links.filter(r=>r.kind==='evidence').map(r=>r.id),data:p});
 const scoped=(req:express.Request)=>{const p=store.read(String(req.params.id));const market=req.method==='GET'?req.query.market:req.body?.market;if(market!==p.market)throw Error('研究项目市场上下文不匹配');return p;};
 router.get('/',(req,res)=>{try{const m=String(req.query.market||'');res.json({success:true,market:m,data:store.list(m,String(req.query.q||''))});}catch(e){fail(res,e);}});
 router.post('/',(req,res)=>{try{res.json(envelope(store.create(req.body)));}catch(e){fail(res,e);}});
 router.get('/review-status',(req,res)=>{try{const market=String(req.query.market||'');if(!['stocks','options','crypto','prediction'].includes(market))throw Error('研究项目市场无效');const data=reviewStatus?.()||null;res.json({success:true,market,instrument:null,dataStatus:!data?'unsupported':data.lastResult?.failed?'partial':data.updatedAt?'historical':'empty',source:'明确引用的本地复查调度',updatedAt:data?.updatedAt||null,reason:!data?'本地复查调度未配置':data.lastResult?.failed?'部分项目引用不可核验；保留原结论，仍可手动检查':'全局轮转，每5分钟最多5个项目；不采集、不调用模型、不创建订单',evidenceRefs:[],data});}catch(e){fail(res,e);}});
 router.get('/:id',(req,res)=>{try{res.json(envelope(scoped(req)));}catch(e){fail(res,e);}});
 router.get('/:id/references',(req,res)=>{try{const p=scoped(req),data=store.referenceStates(p.id);res.json({success:true,market:p.market,instrument:null,dataStatus:data.some(r=>r.dataStatus==='unavailable')?'partial':data.length?'historical':'empty',source:'现有记录的只读关联状态',updatedAt:new Date().toISOString(),reason:'仅检查明确 ID；不更新固定引用、不创建或执行任务',evidenceRefs:p.links.filter(r=>r.kind==='evidence').map(r=>r.id),data});}catch(e){fail(res,e);}});
 router.post('/:id/links',(req,res)=>{try{const p=scoped(req);res.json(envelope(store.link(p.id,req.body.version,req.body.reference)));}catch(e){fail(res,e);}});
 router.post('/:id/conclusions',(req,res)=>{try{const p=scoped(req);res.json(envelope(store.conclude(p.id,req.body.version,{text:req.body.text,linkIds:req.body.linkIds})));}catch(e){fail(res,e);}});
 router.post('/:id/reviews/refresh',(req,res)=>{try{const p=scoped(req);res.json(envelope(store.refresh(p.id,req.body.version)));}catch(e){fail(res,e);}});
 router.post('/:id/reviews/:reviewId/resolve',(req,res)=>{try{const p=scoped(req);res.json(envelope(store.resolveReview(p.id,req.body.version,String(req.params.reviewId),req.body.note)));}catch(e){fail(res,e);}});
 router.get('/:id/export',(req,res)=>{try{const p=scoped(req),format=String(req.query.format||'json');if(!['json','markdown'].includes(format))throw Error('导出格式无效');res.type(format==='json'?'application/json':'text/markdown').send(store.export(p.id,format as 'json'|'markdown'));}catch(e){fail(res,e);}});
 return router;
}
