import express from 'express';
import {createHash} from 'node:crypto';
import { requireCsrf } from './auth';
import type { AiEvaluationCohorts, CohortReference } from '../features/ai-evaluation-cohorts';
export function createAiEvaluationCohortRouter(cohorts:AiEvaluationCohorts,caseOptions:(market:string)=>Array<{reference:string;title:string;status:string;model?:string|null;updatedAt?:string}> = ()=>[]){
 const r=express.Router();r.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin')return res.status(403).json({success:false,reason:'仅限管理员'});next();});
 const market=(v:any)=>{if(!['stocks','crypto','options','prediction'].includes(v))throw Error('市场无效');return v as string;};
 r.get('/',(req,res)=>{try{return res.json({success:true,market:market(req.query.market),data:cohorts.list(market(req.query.market))});}catch(e){return res.status(400).json({success:false,reason:e instanceof Error?e.message:'读取测试集失败'});}});
 r.get('/cases',(req,res)=>{try{const m=market(req.query.market),data=caseOptions(m).slice(0,500);return res.json({success:true,market:m,data});}catch(e){return res.status(400).json({success:false,reason:e instanceof Error?e.message:'读取已保存案例失败'});}});
 r.post('/',requireCsrf,(req,res)=>{try{if(JSON.stringify(req.body||{}).length>64000)throw Error('测试集请求超过容量');const b=req.body||{},m=market(b.market);if(Object.keys(b).some(k=>!['market','references','idempotencyKey','contentHash'].includes(k))||!Array.isArray(b.references)||b.references.length>500||b.references.some((x:any)=>!x||Object.keys(x).some(k=>!['reference','slot'].includes(k))||typeof x.reference!=='string'||!Number.isSafeInteger(x.slot))||typeof b.contentHash!=='string'||b.contentHash!==createHash('sha256').update(JSON.stringify([...b.references].sort((a:any,c:any)=>a.slot-c.slot))).digest('hex'))throw Error('不接受模型调用或客户端结果，清单Hash不匹配');return res.json({success:true,market:m,data:cohorts.freeze(m,b.references as CohortReference[],{idempotencyKey:b.idempotencyKey})});}catch(e){return res.status(400).json({success:false,reason:e instanceof Error?e.message:'冻结测试集失败'});}});
 r.get('/:id/report',(req,res)=>{try{const m=market(req.query.market);return res.json({success:true,market:m,data:cohorts.report(String(req.params.id),m)});}catch(e){return res.status(400).json({success:false,reason:e instanceof Error?e.message:'测试集报告失败'});}});
 return r;
}
