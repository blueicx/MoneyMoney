import express from 'express';
import type {createSavedEvidenceProofService} from '../features/research-evidence-governance';

type Service=ReturnType<typeof createSavedEvidenceProofService>;
const fail=(res:express.Response,error:unknown,status=400)=>res.status(status).json({success:false,reason:error instanceof Error?error.message:'历史证明请求失败'});
const versionStatus=(error:unknown)=>error instanceof Error&&/版本已变化|幂等键已绑定/.test(error.message)?409:400;
export function createResearchEvidenceGovernanceRouter(deps:{service:Service;adminOnly:(req:express.Request,res:express.Response)=>boolean;csrfValid:(req:express.Request)=>boolean}){
 const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if(!deps.adminOnly(req,res))return;next();});
 router.get('/snapshots',(req,res)=>{try{if(Object.keys(req.query).some(k=>!['market','instrument','timeframe'].includes(k)))throw Error('快照清单只接受明确的市场、标的和周期');const input={market:String(req.query.market||''),instrument:String(req.query.instrument||''),timeframe:String(req.query.timeframe||'')};res.json({success:true,market:input.market,instrument:input.instrument,data:deps.service.listSnapshots(input),reason:'只列出当前数据湖中已保存快照；不发起采集'});}catch(e){fail(res,e);}});
 router.get('/proof',(req,res)=>{void (async()=>{try{if(Object.keys(req.query).some(k=>!['market','instrument','timeframe','snapshotId'].includes(k)))throw Error('证明查询只接受明确的快照范围和 ID');const data=await deps.service.proof({market:String(req.query.market||''),instrument:String(req.query.instrument||''),timeframe:String(req.query.timeframe||''),snapshotId:String(req.query.snapshotId||'')});res.json({success:true,market:data.market,instrument:data.instrument,dataStatus:data.dataStatus,readOnly:true,reason:data.reason,evidenceRefs:data.evidenceRefs,data});}catch(e){fail(res,e);}})();});
 router.get('/recaptures',(req,res)=>{try{if(Object.keys(req.query).some(k=>k!=='projectId'))throw Error('重采集关联查询只接受项目 ID');const data=deps.service.recaptures(String(req.query.projectId||''));res.json({success:true,market:data.market,data});}catch(e){fail(res,e);}});
 router.post('/recaptures',(req,res)=>{void (async()=>{try{if(!deps.csrfValid(req))return fail(res,Error('CSRF 校验失败'),403);if(!req.body||Object.keys(req.body).some(k=>!['projectId','market','instrument','timeframe','originalSnapshotId','recapturedSnapshotId','reason','expectedVersion','idempotencyKey'].includes(k)))throw Error('重采集关联不接受客户端结果、Hash 或其他字段');const data=await deps.service.associateRecapture(req.body);res.status(201).json({success:true,market:data.market,data});}catch(e){fail(res,e,versionStatus(e));}})();});
 return router;
}
