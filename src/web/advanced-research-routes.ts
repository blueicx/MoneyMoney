import express from 'express';
import type {CompanyMacroResearchStore} from '../features/company-macro-research';
import type {EvidenceResearchAssistant} from '../features/evidence-research-assistant';

export function createAdvancedResearchRouter(input:{
  company:CompanyMacroResearchStore;
  assistant:EvidenceResearchAssistant;
  csrfValid:(req:express.Request)=>boolean;
}){
  const router=express.Router();
  router.use((req,res,next)=>{
    res.setHeader('Cache-Control','private, no-store');
    if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'高级研究接口仅限管理员'});return;}
    if(req.method!=='GET'&&!input.csrfValid(req)){res.status(403).json({success:false,dataStatus:'failed',reason:'CSRF 校验失败'});return;}
    next();
  });
  const fail=(res:express.Response,error:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'高级研究请求失败'});
  router.get('/company-macro',(req,res)=>{
    try{
      if(Object.keys(req.query).some(key=>!['market'].includes(key))||req.query.market!=='stocks')throw Error('公司与宏观研究只接受股票市场');
      const data=input.company.list('stocks');
      res.json({success:true,market:'stocks',dataStatus:data.length?'historical':'empty',source:'固定证据公司与宏观研究',data,evidenceRefs:[],executionEnabled:false,modelCalls:0,ordersCreated:0});
    }catch(error){fail(res,error);}
  });
  router.post('/company-macro/preview',async(req,res)=>{
    try{
      const data=await input.company.preview(req.body);
      res.json({success:true,market:'stocks',instrument:data.instrument,dataStatus:data.coverage.calculatedScenarios?'historical':'partial',source:'固定证据公司与宏观研究',reason:data.reason,evidenceRefs:data.evidenceRefs,data});
    }catch(error){fail(res,error);}
  });
  router.get('/company-macro/:id',(req,res)=>{
    try{
      if(Object.keys(req.query).some(key=>key!=='market')||req.query.market!=='stocks')throw Error('公司与宏观研究市场无效');
      const data=input.company.view(String(req.params.id));
      res.json({success:true,market:'stocks',instrument:data.instrument,dataStatus:'historical',source:'固定证据公司与宏观研究',reason:data.reason,evidenceRefs:data.evidenceRefs,data});
    }catch(error){fail(res,error);}
  });
  router.post('/company-macro/:id/confirm',(req,res)=>{
    try{
      if(Object.keys(req.body||{}).some(key=>!['revision','hash','acknowledge'].includes(key)))throw Error('确认字段无效');
      const data=input.company.confirm(String(req.params.id),req.body.revision,req.body.hash,req.body.acknowledge);
      res.json({success:true,market:'stocks',instrument:data.instrument,dataStatus:'historical',source:'固定证据公司与宏观研究',reason:data.reason,evidenceRefs:data.evidenceRefs,data});
    }catch(error){fail(res,error);}
  });
  router.post('/company-macro/:id/stop',(req,res)=>{
    try{
      if(Object.keys(req.body||{}).some(key=>key!=='revision'))throw Error('停止字段无效');
      const data=input.company.stop(String(req.params.id),req.body.revision);
      res.json({success:true,market:'stocks',instrument:data.instrument,dataStatus:'historical',source:'固定证据公司与宏观研究',reason:data.reason,evidenceRefs:data.evidenceRefs,data});
    }catch(error){fail(res,error);}
  });
  router.post('/assistant',async(req,res)=>{
    try{
      const data=await input.assistant.run(req.body);
      res.json({success:true,market:data.market,instrument:data.instrument,dataStatus:'historical',source:data.mode==='model'?'显式模型研究助手':'证据研究助手',reason:data.reason,evidenceRefs:data.evidenceRefs,data});
    }catch(error){fail(res,error);}
  });
  return router;
}
