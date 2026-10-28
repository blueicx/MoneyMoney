import express from 'express';
import type {CompanyGraphConcentrationInput,CompanyIndustryGraphInput,CompanyIndustryGraphStore} from '../features/company-industry-graph';

function requestFields(input:Record<string,unknown>,allowed:string[]){
  if(Object.keys(input||{}).some(key=>!allowed.includes(key)))throw Error('请求包含未允许字段');
}
function idempotencyKey(req:express.Request){
  const value=String(req.get('idempotency-key')||'').trim();
  if(!/^[A-Za-z0-9._:-]{8,128}$/.test(value))throw Error('写请求需要有效 Idempotency-Key');
  return value;
}
function expectedVersion(req:express.Request,body:Record<string,unknown>){
  const header=String(req.get('if-match')||'').trim().replace(/^W\//,'').replace(/^"|"$/g,'');
  if(!/^\d+$/.test(header))throw Error('写请求需要有效 If-Match 版本');
  const version=Number(header);
  if(body.expectedVersion!==undefined&&Number(body.expectedVersion)!==version)throw Error('If-Match 与请求版本不一致');
  return version;
}
function statusFor(error:unknown){
  const message=error instanceof Error?error.message:'';
  if(/未找到/.test(message))return 404;
  if(/版本冲突|幂等键已用于/.test(message))return 409;
  return 400;
}

export function createCompanyIndustryGraphRouter(store:CompanyIndustryGraphStore,deps:{adminOnly:(req:express.Request,res:express.Response)=>boolean;csrfValid:(req:express.Request)=>boolean}){
  const router=express.Router();
  router.use((req,res,next)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!deps.adminOnly(req,res))return;
    if(req.method!=='GET'&&!deps.csrfValid(req)){
      res.status(403).json({success:false,dataStatus:'failed',reason:'CSRF 校验失败'});
      return;
    }
    next();
  });
  const fail=(res:express.Response,error:unknown)=>res.status(statusFor(error)).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'公司与产业关系图不可用'});
  const envelope=(instrument:string|null,data:unknown,dataStatus:string,reason:string|null,evidenceRefs:string[]=[])=>({
    success:true,
    market:'stocks',
    instrument,
    data,
    dataStatus,
    reason,
    source:'公司与产业关系图 / 已保存证据与管理员确认',
    updatedAt:new Date().toISOString(),
    evidenceRefs,
  });
  router.get('/',(req,res)=>{
    try{
      requestFields(req.query as Record<string,unknown>,['instrument','asOf']);
      const instrument=req.query.instrument===undefined?undefined:String(req.query.instrument);
      const asOf=req.query.asOf===undefined?undefined:String(req.query.asOf);
      const data=store.list(instrument,asOf);
      res.json(envelope(instrument||null,data,data.length?'historical':'empty',data.length?null:'没有截止时点内的关系图记录',data.map(row=>row.id)));
    }catch(error){fail(res,error);}
  });
  router.get('/:id',(req,res)=>{
    try{
      requestFields(req.query as Record<string,unknown>,[]);
      const data=store.get(String(req.params.id));
      res.json(envelope(data.manifest.nodes.find(node=>node.instrument)?.instrument||null,data,'historical',null,[data.id]));
    }catch(error){fail(res,error);}
  });
  router.post('/preview',(req,res)=>{
    try{
      requestFields(req.body||{},['market','asOf','nodes','edges','note']);
      const requestId=idempotencyKey(req);
      const data=store.preview({...(req.body||{}),requestId});
      res.status(201).json(envelope(data.manifest.nodes.find(node=>node.instrument)?.instrument||null,data,'historical',null,[data.id]));
    }catch(error){fail(res,error);}
  });
  router.post('/:id/confirm',(req,res)=>{
    try{
      requestFields(req.body||{},['expectedVersion','contentHash','acknowledge']);
      const version=expectedVersion(req,req.body||{}),key=idempotencyKey(req),body=req.body||{};
      const user=(req as any).user||{},actor=String(user.username||user.user||user.name||'admin').slice(0,120);
      const data=store.confirm(String(req.params.id),{
        expectedVersion:version,
        contentHash:String(body.contentHash||''),
        acknowledge:body.acknowledge===true,
        confirmationKey:key,
        actor,
      });
      res.json(envelope(data.manifest.nodes.find(node=>node.instrument)?.instrument||null,data,'historical',null,[data.id]));
    }catch(error){fail(res,error);}
  });
  router.post('/concentration',(req,res)=>{
    try{
      requestFields(req.body||{},['asOf','maxHops','positions']);
      const input=req.body as CompanyGraphConcentrationInput,data=store.concentration(input);
      res.json(envelope(null,data,data.status==='calculated'?'historical':'partial',data.reason,data.coverage.exclusions.map(row=>row.edgeId)));
    }catch(error){fail(res,error);}
  });
  return router;
}
