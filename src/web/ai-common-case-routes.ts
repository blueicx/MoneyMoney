import express from 'express';
import {createHash} from 'node:crypto';
import {requireCsrf} from './auth';
import type {AiCommonCases} from '../features/ai-common-cases';
import type {CohortReference} from '../features/ai-evaluation-cohorts';
export interface AiCommonCaseOption {reference:string;title:string;status:string;model?:string|null;updatedAt?:string;}
/** Loader contract: return only already-persisted server evidence for (market, reference), with source Hashes verified; never call a model. When a stored manifest hash includes model/prompt fields, expose a model-neutral canonicalInputHash derived from verified market/instrument/asOf/target/horizon/input evidence. */
export type AiCommonCaseOptionLoader=(market:string)=>AiCommonCaseOption[];
export function createAiCommonCasesRouter(cases:AiCommonCases,caseOptions:AiCommonCaseOptionLoader=()=>[]){
 const r=express.Router();r.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin')return res.status(403).json({success:false,reason:'仅限管理员'});next();});
 const market=(v:any)=>{if(!['stocks','crypto','options','prediction'].includes(v))throw Error('市场无效');return String(v);};
 r.get('/',(req,res)=>{try{const m=market(req.query.market);return res.json({success:true,market:m,data:cases.list(m)});}catch(e){return res.status(400).json({success:false,reason:e instanceof Error?e.message:'读取共用案例失败'});}});
 r.get('/cases',(req,res)=>{try{const m=market(req.query.market);return res.json({success:true,market:m,data:caseOptions(m).slice(0,500)});}catch(e){return res.status(400).json({success:false,reason:e instanceof Error?e.message:'读取已保存案例失败'});}});
 r.post('/',requireCsrf,(req,res)=>{try{const b=req.body||{},m=market(b.market);if(JSON.stringify(b).length>64000||Object.keys(b).some(k=>!['market','references','idempotencyKey','contentHash'].includes(k))||!Array.isArray(b.references)||!b.references.length||b.references.length>500||b.references.some((x:any)=>!x||Object.keys(x).some(k=>!['reference','slot'].includes(k))||typeof x.reference!=='string'||!Number.isSafeInteger(x.slot))||typeof b.contentHash!=='string'||b.contentHash!==createHash('sha256').update(JSON.stringify([...b.references].sort((a:any,c:any)=>a.slot-c.slot))).digest('hex'))throw Error('案例请求字段无效或清单Hash不匹配；不接受客户端结果');return res.json({success:true,market:m,data:cases.freeze(m,b.references as CohortReference[],{idempotencyKey:b.idempotencyKey})});}catch(e){return res.status(400).json({success:false,reason:e instanceof Error?e.message:'冻结共用案例失败'});}});
 r.get('/:id/report',(req,res)=>{try{const m=market(req.query.market);return res.json({success:true,market:m,data:cases.report(String(req.params.id),m)});}catch(e){return res.status(400).json({success:false,reason:e instanceof Error?e.message:'案例报告失败'});}});
 r.get('/:id',(req,res)=>{try{const m=market(req.query.market);return res.json({success:true,market:m,data:cases.read(String(req.params.id),m)});}catch(e){return res.status(400).json({success:false,reason:e instanceof Error?e.message:'读取共用案例失败'});}});
 return r;
}
