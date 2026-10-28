import express from 'express';
import type {ThreeStatementInput,ThreeStatementModelService} from '../features/three-statement-model';

export function createThreeStatementRouter(service:ThreeStatementModelService,deps:{adminOnly:(req:express.Request,res:express.Response)=>boolean;csrfValid:(req:express.Request)=>boolean}){
  const router=express.Router();
  router.use((req,res,next)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!deps.adminOnly(req,res))return;
    if(req.method!=='GET'&&!deps.csrfValid(req)){res.status(403).json({success:false,reason:'CSRF 校验失败'});return;}
    next();
  });
  router.post('/preview',(req,res)=>{
    try{
      const allowed=['market','instrument','asOf','evidence','assumptions'];
      if(!req.body||Object.keys(req.body).some(key=>!allowed.includes(key)))throw Error('请求包含未允许字段');
      const data=service.preview(req.body as ThreeStatementInput);
      res.json({success:true,market:data.market,instrument:data.instrument,data,dataStatus:data.status==='balanced'?'historical':'partial',source:'已保存报表证据 / 服务端三表联动',reason:data.reason,updatedAt:new Date().toISOString(),evidenceRefs:data.evidenceRefs});
    }catch(error){res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'三表模型不可用'});}
  });
  return router;
}
