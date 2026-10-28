import express from 'express';
import type {PortfolioImportLedgerStore} from '../features/portfolio-import-ledger';

export function createPortfolioImportLedgerRouter(store:PortfolioImportLedgerStore,csrfValid:(req:express.Request)=>boolean){
 const router=express.Router();
 router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'持仓导入账本仅限管理员'});return;}next();});
 router.use((req,res,next)=>{if(req.method!=='GET'&&!csrfValid(req)){res.status(403).json({success:false,dataStatus:'failed',reason:'CSRF 校验失败'});return;}next();});
 const fail=(res:express.Response,error:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'持仓导入失败'});
 const query=(req:express.Request,keys:string[])=>{if(Object.keys(req.query).some(key=>!keys.includes(key)))throw Error('查询字段无效');};
 router.get('/current',(req,res)=>{try{query(req,['accountSource','accountId']);res.json({success:true,data:store.current(String(req.query.accountSource||''),String(req.query.accountId||'')),dataStatus:'historical',source:'独立版本化导入账本',ordersCreated:0});}catch(error){fail(res,error);}});
 router.get('/versions',(req,res)=>{try{query(req,['accountSource','accountId']);const data=store.versions(String(req.query.accountSource||''),String(req.query.accountId||''));res.json({success:true,data,dataStatus:data.length?'historical':'empty',source:'独立版本化导入账本'});}catch(error){fail(res,error);}});
 router.post('/preview',async(req,res)=>{try{const data=await store.preview(req.body);res.json({success:true,data,dataStatus:data.rejected.length?'partial':'cached',source:'用户主动提供的文件预览',reason:data.reason,ordersCreated:0});}catch(error){fail(res,error);}});
 router.post('/commit',(req,res)=>{try{const data=store.commit(req.body);res.status(201).json({success:true,data,dataStatus:'historical',source:'已确认独立导入账本',ordersCreated:0});}catch(error){fail(res,error);}});
 router.post('/rollback',(req,res)=>{try{const data=store.rollback(req.body);res.status(201).json({success:true,data,dataStatus:'historical',source:'独立导入账本新回滚版本',ordersCreated:0});}catch(error){fail(res,error);}});
 return router;
}
