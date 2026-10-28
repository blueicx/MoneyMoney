import express from 'express';
import {buildOptionVolatilitySurface,findLatestSavedOptionChain,type SavedOptionsChainEvidence} from '../features/options-volatility-surface';

export function createOptionsSurfaceRouter(deps:{list:(input:{market:'options';instrument:string})=>SavedOptionsChainEvidence[]}){
 const router=express.Router();
 router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'期权曲面研究仅限管理员'});return;}next();});
 const fail=(res:express.Response,error:unknown)=>res.status(400).json({success:false,dataStatus:'unavailable',reason:error instanceof Error?error.message:'期权曲面不可用'});
 router.get('/',(req,res)=>{try{
  if(Object.keys(req.query).some(key=>!['instrument','asOf'].includes(key)))throw Error('期权曲面只接受明确标的和截止时间');
  const instrument=String(req.query.instrument||''),asOf=String(req.query.asOf||new Date().toISOString());
  const chain=findLatestSavedOptionChain(deps.list({market:'options',instrument}),{instrument,asOf});
  if(!chain)return res.status(404).json({success:false,market:'options',instrument,dataStatus:'empty',source:'已保存期权链',updatedAt:null,reason:'截止时间前没有可核验的已保存期权链',evidenceRefs:[]});
  const data=buildOptionVolatilitySurface(chain);
  return res.json({success:true,market:'options',instrument,dataStatus:data.status==='unavailable'?'empty':'historical',source:data.source,updatedAt:data.fetchedAt,reason:data.reason,evidenceRefs:[data.snapshotId],data});
 }catch(error){return fail(res,error);}});
 return router;
}
