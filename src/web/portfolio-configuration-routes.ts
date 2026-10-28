import express from 'express';
import type {PortfolioConfigurationStore} from '../features/portfolio-configurations';

export function createPortfolioConfigurationRouter(store:PortfolioConfigurationStore,csrfValid:(req:express.Request)=>boolean){
  const router=express.Router();
  router.use((req,res,next)=>{
    res.setHeader('Cache-Control','private, no-store');
    if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'组合配置接口仅限管理员'});return;}
    if(req.method!=='GET'&&!csrfValid(req)){res.status(403).json({success:false,dataStatus:'failed',reason:'CSRF 校验失败'});return;}
    next();
  });
  const fail=(res:express.Response,error:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'组合配置请求失败'});
  router.get('/',(req,res)=>{
    try{
      if(Object.keys(req.query).some(key=>key!=='market'))throw Error('查询字段无效');
      const market=String(req.query.market||'');
      const data=store.list(market);
      res.json({success:true,market,dataStatus:data.length?'historical':'empty',source:'独立组合配置目录',data,ordersCreated:0});
    }catch(error){fail(res,error);}
  });
  router.post('/',(req,res)=>{
    try{const data=store.save(req.body);res.status(201).json({success:true,market:data.market,dataStatus:'historical',source:'独立组合配置目录',data,ordersCreated:0});}
    catch(error){fail(res,error);}
  });
  router.post('/compare',(req,res)=>{
    try{
      if(!req.body||Object.keys(req.body).some(key=>key!=='ids')||!Array.isArray(req.body.ids))throw Error('对比只接受2–5份配置引用');
      const data=store.compare(req.body.ids);
      res.json({success:true,market:data.market,dataStatus:'historical',source:'独立组合配置目录',data,ordersCreated:0});
    }catch(error){fail(res,error);}
  });
  return router;
}
